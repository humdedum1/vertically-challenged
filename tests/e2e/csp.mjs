// The extension-page CSP lets images load only from the extension and data: URIs, so
// hostile or hand-typed CSS cannot fetch remote images, while favicons still work.
import assert from 'node:assert/strict';
import { extensionDir, launch } from './harness.mjs';

const { ctx, extId, close } = await launch(extensionDir(), { width: 360, height: 800 });
try {
  const page = await ctx.newPage();
  const violations = [];
  await page.exposeFunction('vcViolation', (d) => violations.push(d));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      window.vcViolation(e.violatedDirective),
    );
  });
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  await page.getByRole('searchbox', { name: 'Search tabs' }).waitFor();
  await page.waitForTimeout(800);
  assert.deepEqual(violations, [], 'the normal panel loads nothing the policy forbids');

  await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = 'body{background-image:url(https://example.invalid/leak.png)}';
    document.head.append(s);
  });
  await page.waitForTimeout(500);
  assert.ok(
    violations.some((v) => v.startsWith('img-src')),
    'a remote CSS image is blocked',
  );
  console.log('PASS panel images are limited to the extension and data: URIs');
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = String.raw`@\69mport "https://example.invalid/leak.css";
      @font-face { font-family: Leak; src: u\72l("https://example.invalid/leak.woff2"); }
      #vc-csp-probe { font-family: Leak; color: rgb(1, 2, 3); }`;
    const probe = document.createElement('span');
    probe.id = 'vc-csp-probe';
    probe.textContent = 'Private tab title';
    document.head.append(s);
    document.body.append(probe);
  });
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await page.waitForTimeout(500);
  assert.ok(
    violations.some((v) => v.startsWith('style-src')),
    'escaped remote imports are blocked',
  );
  assert.ok(
    violations.some((v) => v.startsWith('font-src')),
    'escaped remote fonts are blocked',
  );
  assert.equal(
    await page.locator('#vc-csp-probe').evaluate((e) => getComputedStyle(e).color),
    'rgb(1, 2, 3)',
    'inline custom styles still work',
  );
  console.log('PASS remote styles and fonts are blocked while inline styles work');
} finally {
  await close();
}
