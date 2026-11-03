/**
 * Whether a list is being scrolled right now, for "Load icons after scrolling": rows mounted
 * mid-fling show the placeholder glyph and fetch their favicon once scrolling pauses, so a
 * fast scroll through 1,000 tabs doesn't decode 1,000 images.
 */
export const scrollIdle = $state({ lazy: true, scrolling: false });

let timer: ReturnType<typeof setTimeout> | undefined;

export function noteScroll(): void {
  if (!scrollIdle.lazy) return;
  if (!scrollIdle.scrolling) scrollIdle.scrolling = true;
  clearTimeout(timer);
  timer = setTimeout(() => (scrollIdle.scrolling = false), 120);
}
