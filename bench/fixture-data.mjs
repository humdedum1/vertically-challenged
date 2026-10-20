// The fixture's synthetic sites: deterministic URLs and titles for tab n, shared by the
// Chrome fixture and the pure-function benchmarks. siteFor and fixtureFor are also sent
// into pages as source text, so they must stay self-contained.
export const SITES = [
  ['github.com', 'GitHub', 0.1],
  ['docs.google.com', 'Docs', 0.1],
  ['stackoverflow.com', 'Stack Overflow', 0.08],
  ['developer.mozilla.org', 'MDN Web Docs', 0.08],
  ['news.ycombinator.com', 'Hacker News', 0.06],
  ['www.reddit.com', 'Reddit', 0.06],
  ['www.youtube.com', 'YouTube', 0.08],
  ['en.wikipedia.org', 'Wikipedia', 0.08],
  ['mail.google.com', 'Inbox', 0.03],
  ['www.npmjs.com', 'npm', 0.05],
  ['medium.com', 'Medium', 0.05],
  ['linear.app', 'Linear', 0.04],
  ['figma.com', 'Figma', 0.04],
  ['notion.so', 'Notion', 0.04],
  ['example.org', 'Example Domain', 0.01],
];
export const WORDS = [
  'pull request',
  'issue tracker',
  'design review',
  'release notes',
  'api reference',
  'how to',
  'getting started',
  'architecture',
  'changelog',
  'benchmark',
  'roadmap',
  'meeting notes',
];
export function siteFor(n) {
  const x = ((n * 2654435761) >>> 0) / 4294967296;
  let acc = 0;
  for (const s of SITES) {
    acc += s[2];
    if (x < acc) return s;
  }
  return SITES[SITES.length - 1];
}
export function fixtureFor(n) {
  const [host, name] = siteFor(n);
  const w = WORDS[n % WORDS.length];
  return { url: `http://${host}/${w.replace(/ /g, '-')}-${n}`, title: `${name} - ${w} #${n}` };
}
