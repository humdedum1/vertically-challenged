// Starts a headless Chromium with one or two builds of the extension and a 1,500-tab
// fixture (two windows, 30 tab groups, Essentials and folders for each build), then stays
// running for the other bench scripts until Ctrl+C.
//   node bench/fixture.mjs [--tabs 1500] [build dir] [second build dir]
// Defaults to the production build. Builds are copied to bench/.out with timing probes
// added; the repo's own build output is never modified.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  browserCDP,
  chromeBinary,
  FIXTURE_SRC,
  fixtureFor,
  jget,
  lit,
  OUT,
  PORT,
  ROOT,
  SRV,
  STATE,
  sleep,
  waitSW,
} from './lib.mjs';

const argv = process.argv.slice(2);
const tabsAt = argv.indexOf('--tabs');
const N = tabsAt === -1 ? 1500 : Number(argv.splice(tabsAt, 2)[1]);
const sources = (argv.length ? argv : [path.join(ROOT, '.output', 'chrome-mv3')]).map((d) =>
  path.resolve(d),
);
if (!(N >= 1200)) {
  // Window A holds N - 100 tabs: 28 groups need about 1,000, and the probes look for a
  // snapshot of more than 1,000 tabs.
  console.error('--tabs must be at least 1200');
  process.exit(2);
}
if (sources.length > 2) {
  console.error('At most two builds');
  process.exit(2);
}
for (const s of sources) {
  if (!fs.existsSync(path.join(s, 'manifest.json'))) {
    console.error(`No built extension at ${s}. Run "npm run build" first.`);
    process.exit(2);
  }
}

// Side-panel probe: connect, first big snapshot and first row times, in panel time.
// measure.mjs injects a fuller probe first in tab mode; this one then stands aside.
const PROBE = `(() => {
  if (window.__p) return;
  const P = (window.__p = { firstRow: null });
  const now = () => performance.now();
  const connect = chrome.runtime.connect.bind(chrome.runtime);
  chrome.runtime.connect = (...a) => {
    if (P.connectAt === undefined) P.connectAt = now();
    const port = connect(...a);
    port.onMessage.addListener((m) => {
      if (m.type === 'snapshot' && P.snapAt === undefined && m.tabs.length > 1000) P.snapAt = now();
    });
    return port;
  };
  new MutationObserver(() => {
    if (P.firstRow === null && document.querySelector('[role=treeitem]')) P.firstRow = now();
  }).observe(document, { childList: true, subtree: true });
})();`;

/**
 * Copies a build and adds timing marks to its worker (globalThis.__m). Marks hang off
 * string literals that survive minification (API names, message types), so they keep
 * working across builds; a mark whose anchor is missing is reported and skipped.
 */
function prepareBuild(src, key) {
  const dst = path.join(OUT, `ext-${key}`);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
  // A second build needs its own name: the fixture tells the two apart by it.
  const mf = JSON.parse(fs.readFileSync(path.join(dst, 'manifest.json'), 'utf8'));
  if (key !== 'a') mf.name = `${mf.name} (${key})`;
  fs.writeFileSync(path.join(dst, 'manifest.json'), JSON.stringify(mf));
  fs.writeFileSync(path.join(dst, 'bench-probe.js'), PROBE);
  const htmlFile = path.join(dst, 'sidepanel.html');
  const html = fs.readFileSync(htmlFile, 'utf8');
  fs.writeFileSync(
    htmlFile,
    html.replace('<title>', '<script src="/bench-probe.js"></script><title>'),
  );

  const bg = path.join(dst, 'background.js');
  let s = fs.readFileSync(bg, 'utf8');
  const mark = (name, re, to) => {
    if (!re.test(s))
      return console.log(`  (${key}: worker mark ${name} skipped, anchor not found)`);
    s = s.replace(re, to);
  };
  const now = 'performance.now()';
  mark(
    'tQ0/tQ1',
    /(\w+)\.tabs\.query\(\{\}\)/,
    `(__m.tQ0=${now},$1.tabs.query({}).then(r=>(__m.tQ1=${now},r)))`,
  );
  mark(
    'tG',
    /(\w+)\.tabGroups\.query\(\{\}\)/,
    `$1.tabGroups.query({}).then(r=>(__m.tG=${now},r))`,
  );
  mark(
    'tPost0',
    /(\w+)\.postMessage\(\{type:([`"'])windows\2/g,
    `(__m.tPost0=${now},$1).postMessage({type:$2windows$2`,
  );
  mark(
    'tSnap',
    /(\w+)\.postMessage\(\{type:([`"'])snapshot\2/g,
    `(__m.tSnap=${now},$1).postMessage({type:$2snapshot$2`,
  );
  // Real discards drop the CDP connection in headless, so they are stubbed.
  s = `globalThis.__m={tStart:${now},origin:performance.timeOrigin,build:'${key}'};try{chrome.tabs.discard=async()=>({})}catch{}\n${s}`;
  fs.writeFileSync(bg, s);
  return { key, src, dir: dst, name: mf.name };
}

function startServer() {
  const srv = http.createServer((req, res) => {
    const m = /-(\d+)$/.exec(req.url.split('?')[0]);
    const { title } = fixtureFor(m ? Number(m[1]) : 0);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>${title}</title><body>x</body>`);
  });
  srv.listen(SRV, '127.0.0.1');
  return srv;
}

if (
  await jget('/json/version').then(
    () => true,
    () => false,
  )
) {
  console.error(`Port ${PORT} is in use: is another fixture running? Stop it first (Ctrl+C).`);
  process.exit(2);
}
const builds = sources.map((src, i) => prepareBuild(src, 'ab'[i]));
const profile = path.join(OUT, 'profile');
fs.rmSync(profile, { recursive: true, force: true });
fs.rmSync(STATE, { force: true });
const srv = startServer();
const dirs = builds.map((b) => b.dir).join(',');
const args = [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  `--load-extension=${dirs}`,
  `--disable-extensions-except=${dirs}`,
  '--renderer-process-limit=8',
  // Every fixture host resolves to the local page server, so nothing leaves the machine.
  `--host-resolver-rules=MAP * 127.0.0.1:${SRV}`,
  '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,1000',
  'about:blank',
];
if (process.getuid?.() === 0) args.splice(1, 0, '--no-sandbox');
const proc = spawn(chromeBinary(), args, { stdio: 'ignore' });
const stop = () => {
  proc.kill();
  srv.close();
  fs.rmSync(STATE, { force: true });
};
proc.on('exit', (c) => {
  console.log('chrome exited', c);
  fs.rmSync(STATE, { force: true });
  process.exit(1);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stop();
    process.exit(0);
  });
}
// A failed setup must not leave a headless Chrome running in the background.
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (err) => {
    console.error(err);
    proc.removeAllListeners('exit');
    stop();
    process.exit(1);
  });
}
for (let i = 0; i < 60; i++) {
  try {
    await jget('/json/version');
    break;
  } catch {
    await sleep(500);
  }
}

const cdp = await browserCDP();
// Extension ids depend on the copy's path; find each build's worker by its manifest name.
for (let i = 0; i < 60 && builds.some((b) => !b.extId); i++) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  for (const t of targetInfos.filter(
    (x) => x.type === 'service_worker' && x.url.endsWith('/background.js'),
  )) {
    const sess = await cdp.attach(t.targetId);
    const name = await cdp
      .evalIn(sess, 'chrome.runtime.getManifest().name', { timeout: 10000 })
      .catch(() => null);
    await cdp.send('Target.detachFromTarget', { sessionId: sess }).catch(() => {});
    const b = builds.find((x) => x.name === name);
    if (b) b.extId = new URL(t.url).host;
  }
  if (builds.some((b) => !b.extId)) await sleep(500);
}
if (builds.some((b) => !b.extId)) throw new Error('a build did not start');
const sw = await waitSW(cdp, builds[0].extId);
const ev = (x, o) => cdp.evalIn(sw.sessionId, x, o);
console.log(
  'Chrome',
  (await jget('/json/version')).Browser,
  '| builds',
  builds.map((b) => `${b.key}=${b.src}`).join(', '),
);

// --- Tabs: N - 100 in window A, 100 in window B, deterministic URLs from the page server.
const nA = N - 100;
const create = async (windowId, from, to) => {
  for (let b = from; b < to; b += 40) {
    await ev(
      `(async()=>{${FIXTURE_SRC}const ps=[];for(let n=${Number(b)};n<Math.min(${Number(to)},${Number(b) + 40});n++){ps.push(chrome.tabs.create({windowId:${Number(windowId)},url:fixtureFor(n).url,active:false}))}await Promise.all(ps);return 1})()`,
    );
    if (b % 400 === 0) console.log('created', b, 'in', windowId);
  }
};
const wins = JSON.parse(
  await ev('chrome.windows.getAll().then(w=>JSON.stringify(w.map(x=>x.id)))'),
);
const A = wins[0];
await create(A, 0, nA - 1);
const B = await ev(
  `(async()=>{${FIXTURE_SRC}const w=await chrome.windows.create({url:fixtureFor(${Number(nA)}).url,focused:false,width:1000,height:800});return w.id})()`,
);
await create(B, nA + 1, nA + 100);
for (let i = 0; i < 120; i++) {
  const left = await ev("chrome.tabs.query({status:'loading'}).then(t=>t.length)");
  if (left === 0) break;
  console.log('loading', left);
  await sleep(2000);
}

// --- Groups: 28 in A, 2 in B.
const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
await ev(`(async()=>{
  const colors=${lit(colors)};
  for (const [w,count,startAt] of [[${A},28,40],[${B},2,5]]) {
    const tabs=(await chrome.tabs.query({windowId:w})).sort((a,b)=>a.index-b.index);
    let pos=startAt;
    for (let g=0;g<count;g++){
      const size=10+((g*7)%21);
      const ids=tabs.slice(pos,pos+size).map(t=>t.id);
      pos+=size+8;
      const gid=await chrome.tabs.group({tabIds:ids,createProperties:{windowId:w}});
      await chrome.tabGroups.update(gid,{title:'Group '+(w===${A}?'A':'B')+g,color:colors[g%9]});
    }
  }
  return 1;
})()`);

// --- Per build: 8 Essentials, 12 pinned tabs in two folders, through the panel protocol.
for (const b of builds) {
  const tgt = await cdp.send('Target.createTarget', {
    url: `chrome-extension://${b.extId}/manifest.json`,
  });
  const tsess = await cdp.attach(tgt.targetId);
  await sleep(1000);
  const res = await cdp.evalIn(
    tsess,
    `(async()=>{
    const A=${A};
    const port=chrome.runtime.connect({name:'vc-panel'});
    let layout=null, tabsA=null; const waiters=[];
    port.onMessage.addListener(m=>{ if(m.type==='layout'&&m.windowId===A){layout=m.layout;waiters.splice(0).forEach(f=>f())} if(m.type==='snapshot'&&m.windowId===A)tabsA=m.tabs; });
    const nextLayout=()=>new Promise(r=>waiters.push(r));
    let p=nextLayout(); port.postMessage({type:'subscribe',windowId:A}); await p;
    const free=tabsA.filter(t=>!t.pinned&&t.groupId===-1).slice(0,20).map(t=>t.id);
    p=nextLayout(); port.postMessage({type:'pinTabs',tabIds:free.slice(0,8),windowId:A,dest:{zone:'essentials',index:0}}); await p;
    p=nextLayout(); port.postMessage({type:'pinTabs',tabIds:free.slice(8,20),windowId:A,dest:{zone:'pinned',folderId:null,index:0}}); await p;
    await new Promise(r=>setTimeout(r,500));
    const own=new Set(free);
    const items=()=>layout.pinned.filter(n=>n.kind==='item'&&own.has(n.tabId)).map(n=>n.id);
    p=nextLayout(); port.postMessage({type:'folderCreate',windowId:A,name:'Work',dest:{zone:'pinned',folderId:null,index:0},itemIds:items().slice(0,6)}); await p;
    await new Promise(r=>setTimeout(r,300));
    p=nextLayout(); port.postMessage({type:'folderCreate',windowId:A,name:'Reading',dest:{zone:'pinned',folderId:null,index:1},itemIds:items().slice(0,6)}); await p;
    await new Promise(r=>setTimeout(r,500));
    port.disconnect();
    return JSON.stringify({essentials:layout.essentials.length,folders:layout.pinned.filter(n=>n.kind==='folder').map(f=>f.children.length)});
  })()`,
  );
  console.log(`layout ${b.key}`, res);
  await cdp.send('Target.closeTarget', { targetId: tgt.targetId });
  await sleep(2000);
}

const summary = JSON.parse(
  await ev(
    '(async()=>{const t=await chrome.tabs.query({});const g=await chrome.tabGroups.query({});const byW={};t.forEach(x=>byW[x.windowId]=(byW[x.windowId]||0)+1);return JSON.stringify({total:t.length,byW,groups:g.length,pinned:t.filter(x=>x.pinned).length})})()',
  ),
);
console.log('fixture', summary);
fs.writeFileSync(
  STATE,
  JSON.stringify({
    A,
    B,
    builds: builds.map(({ key, src, dir, extId }) => ({ key, src, dir, extId })),
    summary,
    chromePid: proc.pid,
    browser: (await jget('/json/version')).Browser,
  }),
);
cdp.close();
console.log('READY (Ctrl+C to stop)');
await new Promise(() => {});
