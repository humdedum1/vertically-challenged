import type { Notice } from './notify';

export const NEWER_SETTINGS_NOTICE: Notice = {
  level: 'error',
  text: 'Settings changes are not saved: a newer version of the extension saved them. Update it to save changes.',
};

/** Reports skipped settings saves; once per panel, so a slider drag doesn't stack toasts. */
export function saveNoticeOnce(show: (n: Notice) => void): (wrote: boolean) => void {
  let shown = false;
  return (wrote) => {
    if (wrote || shown) return;
    shown = true;
    show(NEWER_SETTINGS_NOTICE);
  };
}
