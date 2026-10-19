import { describe, expect, it } from 'vitest';
import { isCustomId, newCustomId } from '../src/sidepanel/theme-registry.svelte';

describe('newCustomId', () => {
  it('has the form custom- + 12 [a-z0-9]', () => {
    for (let i = 0; i < 50; i++) expect(newCustomId()).toMatch(/^custom-[a-z0-9]{12}$/);
  });
  it('produces ids that pass isCustomId', () => {
    for (let i = 0; i < 50; i++) expect(isCustomId(newCustomId())).toBe(true);
  });
  it('generates 1,000 unique ids', () => {
    expect(new Set(Array.from({ length: 1000 }, newCustomId)).size).toBe(1000);
  });
});

describe('isCustomId', () => {
  it.each(['custom-abcdef', 'custom-abc123def456', `custom-${'a'.repeat(32)}`, 'custom-000000'])(
    'accepts %s',
    (id) => {
      expect(isCustomId(id)).toBe(true);
    },
  );
  it.each([
    'abyss',
    'nord',
    '',
    'custom-',
    'custom-abcde',
    `custom-${'a'.repeat(33)}`,
    'custom-ABCDEF123456',
    'Custom-abcdef123456',
    'theme-abcdef123456',
    'xcustom-abcdef123456',
    'custom-abcdef123456x-',
    'custom-abc def 1234',
    'custom-abcdef12345\n',
    'custom_abcdef123456',
  ])('rejects %j', (id) => {
    expect(isCustomId(id)).toBe(false);
  });
});
