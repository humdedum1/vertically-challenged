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
  palette:
    'M8 2a6 6 0 1 0 0 12c1 0 1.5-.7 1.5-1.4 0-.9-.7-1.1-.7-1.9 0-.7.6-1.2 1.4-1.2h1.3A2.5 2.5 0 0 0 14 7.1C14 4.2 11.3 2 8 2zM5 8h.01M7 5.2h.01M10.2 5.5h.01',
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
