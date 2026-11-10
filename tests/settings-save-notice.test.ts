import { describe, expect, it } from 'vitest';
import type { Notice } from '../src/sidepanel/notify';
import { NEWER_SETTINGS_NOTICE, saveNoticeOnce } from '../src/sidepanel/settings-save-notice';

describe('saveNoticeOnce', () => {
  it('shows the notice when a save is skipped, once per panel', () => {
    const shown: Notice[] = [];
    const report = saveNoticeOnce((n) => shown.push(n));
    report(true);
    expect(shown).toEqual([]);
    report(false);
    report(false);
    expect(shown).toEqual([NEWER_SETTINGS_NOTICE]);
    expect(NEWER_SETTINGS_NOTICE.text).toMatch(/not saved.*update/i);
  });
});
