import { browser } from 'wxt/browser';
import type { BackupTarget } from '../../backup/targets';

const FOLDER = 'Vertically Challenged Backups';

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Saves into the browser's Downloads folder (optional `downloads` permission). No pruning. */
export const downloadsTarget = (): BackupTarget => ({
  async put(name, bytes) {
    if (!(await browser.permissions.contains({ permissions: ['downloads'] })))
      throw new Error('Downloads permission was not granted');
    await browser.downloads.download({
      url: `data:application/octet-stream;base64,${base64(bytes)}`,
      filename: `${FOLDER}/${name}`,
      conflictAction: 'uniquify',
      saveAs: false,
    });
  },
});
