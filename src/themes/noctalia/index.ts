import ayu from './ayu.json';
import catppuccin from './catppuccin.json';
import dracula from './dracula.json';
import eldritch from './eldritch.json';
import gruvbox from './gruvbox.json';
import kanagawa from './kanagawa.json';
import noctalia from './noctalia.json';
import nord from './nord.json';
import rosePine from './rose-pine.json';
import tokyoNight from './tokyo-night.json';

/**
 * Noctalia shell's built-in palettes, copied verbatim (MIT, see THIRD_PARTY_NOTICES.md)
 * from src/theme/builtin_palettes.cpp in github.com/noctalia-dev/noctalia.
 * Community palettes are unlicensed and therefore not bundled; they load via import.
 */
export const NOCTALIA_THEMES: readonly { id: string; name: string; raw: unknown }[] = [
  { id: 'noctalia', name: 'Noctalia', raw: noctalia },
  { id: 'ayu', name: 'Ayu', raw: ayu },
  { id: 'catppuccin', name: 'Catppuccin', raw: catppuccin },
  { id: 'dracula', name: 'Dracula', raw: dracula },
  { id: 'eldritch', name: 'Eldritch', raw: eldritch },
  { id: 'gruvbox', name: 'Gruvbox', raw: gruvbox },
  { id: 'kanagawa', name: 'Kanagawa', raw: kanagawa },
  { id: 'nord', name: 'Nord', raw: nord },
  { id: 'rose-pine', name: 'Rosé Pine', raw: rosePine },
  { id: 'tokyo-night', name: 'Tokyo Night', raw: tokyoNight },
];
