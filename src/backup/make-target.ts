import type { BackupConfig } from '../background/backup/scheduler';
import { dropboxTarget } from './dropbox';
import { type BackupTarget, s3Target, webdavTarget } from './targets';

/** The one place a config becomes a target; `local` is the Downloads target (needs browser APIs). */
export function makeTarget(cfg: BackupConfig, local: () => BackupTarget): BackupTarget {
  switch (cfg.target) {
    case 'webdav':
      return webdavTarget(cfg.webdav);
    case 's3':
      return s3Target(cfg.s3);
    case 'dropbox':
      return dropboxTarget(cfg.dropbox);
    default:
      return local();
  }
}
