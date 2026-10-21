<script lang="ts" module>
// 16px viewBox stroke paths. Labels carry the meaning, so icons are always aria-hidden.
const PATHS = {
  tabs: 'M2.5 4.5a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5zM2.5 6.5h11',
  settings: 'M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6M9.5 3v3M5.5 10v3',
  back: 'M9.5 3.5 5 8l4.5 4.5',
  system: 'M2.5 3.5h11v7h-11zM6 13h4M8 10.5V13',
  sun: 'M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9',
  moon: 'M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z',
  list: 'M2.5 4h11M2.5 8h11M2.5 12h11',
  plus: 'M8 3v10M3 8h10',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.4 10.4 13.5 13.5',
  close: 'm4 4 8 8m0-8-8 8',
  chevron: 'M6 3.5 10.5 8 6 12.5',
  bookmark: 'M4.5 2.5h7v11L8 10.5l-3.5 3z',
  history: 'M2.8 8a5.2 5.2 0 1 0 1.5-3.7M2.5 2.8v2.7h2.7M8 5v3.2l2.2 1.3',
  sessions: 'M3 4.5h10v8H3zM5 2.5h6M3 7.5h10',
  windows: 'M2.5 5.5h8v7h-8zM5.5 5.5v-2h8v7h-3',
  devices: 'M3.5 4h9v6.5h-9zM1.5 12.5h13',
  sync: 'M12.3 6.2A4.6 4.6 0 0 0 4 5.2M3.7 9.8A4.6 4.6 0 0 0 12 10.8M12.6 3.2v3h-3M3.4 12.8v-3h3',
  palette:
    'M8 2a6 6 0 1 0 0 12c1 0 1.5-.7 1.5-1.4 0-.9-.7-1.1-.7-1.9 0-.7.6-1.2 1.4-1.2h1.3A2.5 2.5 0 0 0 14 7.1C14 4.2 11.3 2 8 2zM5 8h.01M7 5.2h.01M10.2 5.5h.01',
  // Folder icons (FOLDER_ICONS in shared/layout); `home` doubles as "back to home URL".
  folder:
    'M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.5 1.5h4.9A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z',
  star: 'm8 2 1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z',
  work: 'M2.5 5.5h11v7h-11zM5.5 5.5V4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M2.5 8.5h11',
  book: 'M8 4.2C6.8 3.3 5 3 2.5 3v9c2.5 0 4.3.3 5.5 1.2 1.2-.9 3-1.2 5.5-1.2V3C11 3 9.2 3.3 8 4.2zM8 4.2v9',
  code: 'M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3l-2 10',
  music:
    'M6 12V3.5l7-1.5v8.5M6 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM13 10.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  cart: 'M1.5 2.5h2l1.6 7.5h7.4l1.5-5.5H4.3M6.5 13h.01M11.5 13h.01',
  home: 'M2.5 7.5 8 3l5.5 4.5M4 6.5V13h3V9.5h2V13h3V6.5',
  chat: 'M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z',
  game: 'M4.5 5h7a3 3 0 0 1 3 3v.5a3 3 0 0 1-5.4 1.8L8.6 10H7.4l-.5.3A3 3 0 0 1 1.5 8.5V8a3 3 0 0 1 3-3zM4.5 7v2M3.5 8h2M10.5 7.5h.01M12 9h.01',
} as const;

export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
interface Props {
  name: IconName;
  size?: number;
}

let { name, size = 16 }: Props = $props();
</script>

<svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d={PATHS[name]} />
</svg>
