import { describe, expect, it } from 'vitest';
import { isNewTabUrl } from '../src/shared/browser-urls';

describe('isNewTabUrl', () => {
  it('recognises Chrome and Firefox new-tab pages', () => {
    for (const u of ['chrome://newtab/', 'chrome://newtab', 'about:newtab', 'about:home'])
      expect(isNewTabUrl(u)).toBe(true);
  });
  it('rejects other pages', () => {
    for (const u of ['https://example.com/', 'about:blank', 'chrome://newtabx', '', undefined])
      expect(isNewTabUrl(u)).toBe(false);
  });
});
