/**
 * Key combos are stored as normalized strings like "Ctrl+Shift+K", "Alt+ArrowUp", "/".
 * Modifier order is fixed (Ctrl, Alt, Shift, Meta) so equal combos compare as equal
 * strings, which keeps storage, conflict detection and matching trivial.
 */
const MODS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
type Mod = (typeof MODS)[number];

const ALIASES: Record<string, string> = {
  control: 'Ctrl',
  ctrl: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  meta: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  win: 'Meta',
  ' ': 'Space',
  space: 'Space',
  spacebar: 'Space',
  esc: 'Escape',
  del: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

const NAMED_KEYS = new Set([
  'Space',
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ContextMenu',
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
]);

/** Pressing only these never forms a combo on its own. */
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'OS']);

function normalizeKey(raw: string): string | null {
  const alias = ALIASES[raw.toLowerCase()] ?? ALIASES[raw];
  if (alias && !MODS.includes(alias as Mod)) return alias;
  const named = [...NAMED_KEYS].find((k) => k.toLowerCase() === raw.toLowerCase());
  if (named) return named;
  // Single printable character; letters are stored uppercase so "k" and "K" are one key.
  if ([...raw].length === 1 && raw.trim() !== '') return raw.toUpperCase();
  return null;
}

/** Parses user/stored text ("ctrl + shift + k") into normal form, or null if invalid. */
export function normalizeCombo(text: string): string | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > 40) return null;
  // "+" itself is a valid key: "Ctrl++" → Ctrl and "+".
  const parts =
    text === '+'
      ? ['+']
      : text
          .replace(/\+\+$/, '+plus')
          .split('+')
          .map((p) => p.trim());
  const mods = new Set<Mod>();
  let key: string | null = null;
  for (const part of parts) {
    if (part === '') return null;
    const p = part === 'plus' ? '+' : part;
    const mod = ALIASES[p.toLowerCase()];
    if (mod && MODS.includes(mod as Mod)) {
      mods.add(mod as Mod);
      continue;
    }
    if (key !== null) return null;
    key = normalizeKey(p);
    if (key === null) return null;
  }
  if (key === null) return null;
  return [...MODS.filter((m) => mods.has(m)), key].join('+');
}

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * The combo an event represents, or null for a bare modifier. Shift is dropped for
 * single punctuation characters, because the character already encodes it ("?" is
 * Shift+/ on US layouts and something else elsewhere); it is kept for letters.
 */
export function comboFromEvent(e: KeyLike): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const key = normalizeKey(e.key);
  if (key === null) return null;
  const isPunct = key.length === 1 && !/[A-Z0-9]/.test(key);
  const mods: Mod[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey && !isPunct) mods.push('Shift');
  if (e.metaKey) mods.push('Meta');
  return [...mods, key].join('+');
}

/** Finds the action bound to an event, if any. */
export function actionFor<A extends string>(
  map: Readonly<Record<A, readonly string[]>>,
  e: KeyLike,
): A | null {
  const combo = comboFromEvent(e);
  if (combo === null) return null;
  for (const action of Object.keys(map) as A[]) if (map[action].includes(combo)) return action;
  return null;
}

/** Combos bound to more than one action, with the actions that share them. */
export function findConflicts<A extends string>(
  map: Readonly<Record<A, readonly string[]>>,
): Map<string, A[]> {
  const byCombo = new Map<string, A[]>();
  for (const action of Object.keys(map) as A[]) {
    for (const c of map[action]) byCombo.set(c, [...(byCombo.get(c) ?? []), action]);
  }
  return new Map([...byCombo].filter(([, actions]) => actions.length > 1));
}

/** Text for display: "Ctrl+Shift+K" → "Ctrl + Shift + K"; arrows as glyphs. */
export function formatCombo(combo: string): string {
  const glyph: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  };
  return combo
    .split(/\+(?!$)/)
    .map((p) => glyph[p] ?? p)
    .join(' + ');
}
