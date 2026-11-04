import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(firefox: boolean) {
  vi.resetModules();
  vi.stubEnv('FIREFOX', firefox ? 'true' : '');
  return (await import('../src/sidepanel/remote-css')).fetchesRemote;
}
afterEach(() => vi.unstubAllEnvs());

describe('fetchesRemote (Firefox only)', () => {
  it('flags every way CSS can fetch', async () => {
    const f = await load(true);
    for (const css of [
      'a{background:url(https://x/a)}',
      'a{background:URL( "//x/a" )}',
      '@import "https://x/a.css";',
      'a{background:image-set("https://x/a" 1x)}',
      'a{background:src("https://x/a")}',
      'a{background:\\75rl(https://x/a)}',
    ])
      expect(f(css), css).toBe(true);
  });
  it('allows ordinary CSS, data: urls and comments', async () => {
    const f = await load(true);
    for (const css of [
      '[role="treeitem"]{font-weight:500}',
      'a{background:url(data:image/png;base64,AAAA)}',
      "a{background:url('data:image/svg+xml,<svg/>')}",
      '/* url(https://x) */ a{color:red}',
    ])
      expect(f(css), css).toBe(false);
  });
  it('is off on Chrome, whose CSP already blocks it', async () => {
    expect((await load(false))('a{background:url(https://x/a)}')).toBe(false);
  });
});
