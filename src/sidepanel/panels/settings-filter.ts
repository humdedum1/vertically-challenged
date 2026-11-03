/**
 * Filters the settings screen by what you type. Works on the page itself: each setting is a
 * direct child of its card's content, so a row (plus the hint lines right under it) stays when
 * its text holds every word, and a card or section with nothing left is hidden. Everything it
 * hides is marked, so clearing the search restores the page exactly.
 */
const HIDDEN = 'data-sf';

/** The element whose children are a card's settings: the card body, through single wrappers. */
function rowsOf(card: Element): Row[] {
  let el: Element | null = card.querySelector(':scope > .body');
  while (el && el.children.length === 1 && el.firstElementChild?.tagName === 'DIV')
    el = el.firstElementChild;
  return el ? flatten([...el.children], null) : [];
}

interface Row {
  el: Element;
  /** The data-sf-group this row sits in, so its headings can stay while anything below matches. */
  group: Element | null;
}

/** Rows inside an element marked data-sf-group count as rows of their own. */
function flatten(children: Element[], group: Element | null): Row[] {
  return children.flatMap((el) =>
    el.hasAttribute('data-sf-group') ? flatten([...el.children], el) : [{ el, group }],
  );
}

const isHint = (el: Element): boolean =>
  el.tagName === 'P' && (el.classList.contains('hint') || el.classList.contains('muted'));

const hide = (el: Element, on: boolean): void => {
  if (on) {
    el.setAttribute(HIDDEN, '');
    (el as HTMLElement).hidden = true;
  } else if (el.hasAttribute(HIDDEN)) {
    el.removeAttribute(HIDDEN);
    (el as HTMLElement).hidden = false;
  }
};

/** Returns how many settings match; an empty query restores everything. */
export function applySettingsFilter(root: HTMLElement, query: string): number {
  const ws = query.toLowerCase().split(/\s+/).filter(Boolean);
  for (const el of root.querySelectorAll(`[${HIDDEN}]`)) hide(el, false);
  if (!ws.length) return 0;
  let total = 0;
  for (const details of root.querySelectorAll('details')) {
    let any = false;
    for (const card of details.querySelectorAll('section.card')) {
      const rows = rowsOf(card);
      const keep = new Set<Element>();
      const hintAt = (j: number): boolean => !!rows[j] && isHint((rows[j] as Row).el);
      rows.forEach(({ el }, i) => {
        // A hint or heading never matches on its own; hints belong to the row above.
        if (isHint(el) || el.tagName === 'H3') return;
        let text = el.textContent ?? '';
        for (let j = i + 1; hintAt(j); j++) text += ` ${rows[j]?.el.textContent ?? ''}`;
        const hay = `${card.querySelector('h2')?.textContent ?? ''} ${text}`.toLowerCase();
        if (!ws.every((w) => hay.includes(w))) return;
        keep.add(el);
        for (let j = i + 1; hintAt(j); j++) keep.add((rows[j] as Row).el);
        total++;
      });
      // Headings stay while anything in their group does.
      for (const { el, group } of rows)
        if (el.tagName === 'H3' && rows.some((r) => r.group === group && keep.has(r.el)))
          keep.add(el);
      for (const { el } of rows) hide(el, !keep.has(el));
      hide(card, keep.size === 0);
      any ||= keep.size > 0;
    }
    hide(details, !any);
    details.open = any;
  }
  return total;
}
