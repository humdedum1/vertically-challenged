import { describe, expect, it } from 'vitest';
import { isPlainHttp } from '../src/backup/targets';

describe('isPlainHttp', () => {
  it('flags http:// however it is typed', () => {
    for (const u of [
      'http://nas.local/dav',
      'HTTP://nas.local',
      '  http://10.0.0.2:8080/',
      'Http://x.y',
    ])
      expect(isPlainHttp(u), u).toBe(true);
  });
  it('does not flag https, empty or unparsable input', () => {
    for (const u of ['https://cloud.example.com', 'HTTPS://x.y', '', '   ', 'not a url', 'http'])
      expect(isPlainHttp(u), u).toBe(false);
  });
});
