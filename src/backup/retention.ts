// Names only ever hold what backupName() writes; a listing can't smuggle in a path.
export const BACKUP_FILE = /^vc-backup-\d{8}-\d{6}(-[\p{L}\p{N}_-]+)?\.vcb$/u;

export function backupName(now: Date, device: string): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const dev = device
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  return `vc-backup-${stamp}${dev ? `-${dev}` : ''}.vcb`;
}

/** Names to delete so only the newest `keep` backups remain; other files are never touched. */
export function selectToDelete(names: readonly string[], keep: number): string[] {
  const ours = names
    .filter((n) => BACKUP_FILE.test(n))
    .sort()
    .reverse();
  return ours.slice(Math.max(1, keep));
}
