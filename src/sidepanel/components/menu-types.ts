import type { GroupColor } from '../../shared/types';

export type MenuItem =
  | {
      type: 'item';
      label: string;
      onselect: () => void;
      disabled?: boolean;
      danger?: boolean;
      /** CSS colour for a leading dot (group entries). */
      dot?: string;
    }
  | { type: 'separator' }
  | { type: 'submenu'; label: string; items: MenuItem[] }
  | { type: 'colors'; label: string; value: GroupColor; onpick: (color: GroupColor) => void };
