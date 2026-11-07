// Names only ever hold what backupName() writes; a listing can't smuggle in a path.
export const BACKUP_FILE = /^vc-backup-\d{8}-\d{6}(-[\p{L}\p{N}_-]+)?\.vcb$/u;

export function backupName(now: Date, device: string): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  const dev = device
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  return `vc-backup-${stamp}${dev ? `-${dev}` : ''}.vcb`;
}

/**
 * Names to delete so each device keeps its newest `keep` backups; other files are never
 * touched. Counting per device stops a busy computer pushing out a quiet one's copies.
 */
export function selectToDelete(names: readonly string[], keep: number): string[] {
  const byDevice = new Map<string, string[]>();
  for (const n of names) {
    if (!BACKUP_FILE.test(n)) continue;
    const suffix = n.slice('vc-backup-00000000-000000'.length);
    // Newer names end in the stable device id, so a renamed device still prunes its old copies.
    const device = /-([a-z0-9]{10})\.vcb$/.exec(suffix)?.[1] ?? suffix;
    byDevice.set(device, [...(byDevice.get(device) ?? []), n]);
  }
  return [...byDevice.values()].flatMap((list) => list.sort().reverse().slice(Math.max(1, keep)));
}
