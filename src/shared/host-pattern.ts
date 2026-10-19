const PATTERN = /^(\*\.)?(localhost|[a-z0-9-]+(\.[a-z0-9-]+)+)(:\d{1,5})?$/;

/**
 * Normalizes a whitelist entry. Accepts a bare host ("example.com"), a subdomain-only
 * wildcard ("*.example.com"), or a pasted URL, from which the host is taken.
 */
export function normalizeHostPattern(input: string): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (!s || s.length > 253) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) {
    try {
      s = new URL(s).host;
    } catch {
      return null;
    }
  }
  s = s.replace(/^www\./, '').replace(/\/.*$/, '');
  return PATTERN.test(s) ? s : null;
}

/** Host of a URL with port, without a leading www.; null for non-http(s) URLs. */
export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.host.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** "example.com" matches it and its subdomains; "*.example.com" only subdomains. */
export function matchesHostPattern(url: string, patterns: readonly string[]): boolean {
  const host = hostOf(url);
  if (host === null) return false;
  return patterns.some((p) => {
    if (p.startsWith('*.')) return host.endsWith(p.slice(1));
    return host === p || host.endsWith(`.${p}`);
  });
}
