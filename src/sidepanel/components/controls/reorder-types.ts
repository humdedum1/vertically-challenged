export interface ReorderItem<T extends string> {
  id: T;
  label: string;
  visible: boolean;
  /** The visibility switch can't be changed (the item stays as it is). */
  toggleDisabled?: boolean;
  hint?: string;
}
