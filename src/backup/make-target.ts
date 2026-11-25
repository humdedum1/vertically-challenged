import type { BackupConfig } from '../background/backup/scheduler';
import { dropboxTarget } from './dropbox';
import { type BackupTarget, oxicloudUrl, s3Target, webdavTarget } from './targets';

/** The one place a config becomes a target; `local` is the Downloads target (needs browser APIs). */
export function makeTarget(cfg: BackupConfig, local: () => BackupTarget): BackupTarget {
  switch (cfg.target) {
    case 'webdav':
      return webdavTarget(cfg.webdav);
    case 'oxicloud': {
      const { user, password } = cfg.oxicloud;
      return webdavTarget({ url: oxicloudUrl(cfg.oxicloud), user, password });
    }
    case 's3':
      return s3Target(cfg.s3);
    case 'dropbox':
      return dropboxTarget(cfg.dropbox);
    default:
      return local();
  }
}
