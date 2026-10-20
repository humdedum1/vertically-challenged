export type DropZone = 'before' | 'after' | 'inside';

export interface HoverTarget {
  index: number;
  zone: DropZone;
}

/**
 * Maps a y offset within the scrolled content to a row and zone. Fixed row heights make
 * this pure arithmetic, so it is safe to run on every pointermove. Positions above or
 * below the content clamp to the first/last row's outer edge.
 */
export function hitTest(
  contentY: number,
  rowHeight: number,
  rowCount: number,
  isGroup: (index: number) => boolean,
): HoverTarget | null {
  if (rowCount === 0 || rowHeight <= 0) return null;
  if (contentY < 0) return { index: 0, zone: 'before' };
  const index = Math.floor(contentY / rowHeight);
  if (index >= rowCount) return { index: rowCount - 1, zone: 'after' };
  const frac = (contentY - index * rowHeight) / rowHeight;
  if (isGroup(index)) {
    return { index, zone: frac < 0.25 ? 'before' : frac > 0.75 ? 'after' : 'inside' };
  }
  return { index, zone: frac < 0.5 ? 'before' : 'after' };
}

export interface PointerDragOptions<P> {
  scroller: () => HTMLElement | undefined;
  rowHeight: () => number;
  rowCount: () => number;
  isGroup: (index: number) => boolean;
  /** What a press on row `index` would drag, or null if that row can't start a drag. */
  begin: (index: number, e: PointerEvent) => P | null;
  /**
   * The pointer is over another drop area (the Essentials grid above the list): list
   * hover clears and edge autoscroll pauses while this returns true.
   */
  elsewhere?: (clientX: number, clientY: number) => boolean;
  onStart: (payload: P) => void;
  /** Fired only when the hovered row/zone changes. */
  onHover: (target: HoverTarget | null) => void;
  /** Every pointermove while dragging, for positioning the ghost without reactive state. */
  onMove: (clientX: number, clientY: number) => void;
  onDrop: (payload: P, target: HoverTarget | null) => void;
  onEnd: () => void;
}

const THRESHOLD = 4;
const EDGE = 32;
const MAX_SPEED = 18;

type Phase = 'pending' | 'dragging' | 'cancelled';

/**
 * Pointer-events drag controller. HTML5 DnD is unusable here because rows unmount under
 * virtualization mid-drag; capturing the pointer on the scroll container survives that.
 */
export class PointerDrag<P> {
  private phase: Phase | null = null;
  private payload: P | null = null;
  private pointerId = -1;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private top = 0;
  private bottom = 0;
  private padTop = 0;
  private hover: HoverTarget | null = null;
  private raf = 0;
  private el: HTMLElement | null = null;

  constructor(private readonly o: PointerDragOptions<P>) {}

  get active(): boolean {
    return this.phase === 'dragging';
  }

  press(e: PointerEvent): void {
    const el = this.o.scroller();
    if (!el || this.phase || !this.pressable(e)) return;
    this.remeasure();
    const index = Math.floor(
      (e.clientY - this.top - this.padTop + el.scrollTop) / this.o.rowHeight(),
    );
    const payload = this.o.begin(index, e);
    if (payload !== null) this.arm(e, el, payload);
  }

  /**
   * A press outside the list (an Essentials tile) that drags `payload`. The session is
   * the same one: the pointer is still captured by the list, so it can drop there.
   */
  pressWith(e: PointerEvent, payload: P): void {
    const el = this.o.scroller();
    if (!el || this.phase || !this.pressable(e)) return;
    this.remeasure();
    this.arm(e, el, payload);
  }

  /**
   * Re-reads the list's position. Done once per press (the move path never touches
   * layout), and again when something above the list changes height mid-drag.
   */
  remeasure(): void {
    const el = this.el ?? this.o.scroller();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    this.top = rect.top;
    this.bottom = rect.bottom;
    this.padTop = Number.parseFloat(getComputedStyle(el).paddingTop) || 0;
    this.updateHover();
  }

  private pressable(e: PointerEvent): boolean {
    return e.button === 0 && e.isPrimary && !(e.target as Element).closest('button, input');
  }

  private arm(e: PointerEvent, el: HTMLElement, payload: P): void {
    this.payload = payload;
    this.phase = 'pending';
    this.pointerId = e.pointerId;
    this.startX = this.lastX = e.clientX;
    this.startY = this.lastY = e.clientY;
    this.el = el;
    // On the document: until the pointer is captured, a press outside the list (a tile)
    // sends its moves to wherever it is; captured events bubble up here too.
    document.addEventListener('pointermove', this.move);
    document.addEventListener('pointerup', this.up);
    document.addEventListener('pointercancel', this.abort);
    el.addEventListener('scroll', this.updateHover);
    document.addEventListener('keydown', this.key, true);
  }

  /** Cancels an in-flight drag (Escape, or the component going away). */
  cancel(): void {
    if (this.phase === 'dragging') {
      this.phase = 'cancelled';
      cancelAnimationFrame(this.raf);
      this.hover = null;
      this.o.onHover(null);
      this.o.onEnd();
    } else if (this.phase === 'pending') {
      this.cleanup();
    }
  }

  dispose(): void {
    this.cancel();
    this.cleanup();
  }

  private move = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (this.phase === 'pending') {
      if (Math.hypot(e.clientX - this.startX, e.clientY - this.startY) < THRESHOLD) return;
      this.phase = 'dragging';
      this.el?.setPointerCapture(this.pointerId);
      this.o.onStart(this.payload as P);
      this.raf = requestAnimationFrame(this.tick);
    }
    if (this.phase !== 'dragging') return;
    this.o.onMove(e.clientX, e.clientY);
    this.updateHover();
  };

  private updateHover = (): void => {
    const el = this.el;
    if (this.phase !== 'dragging' || !el) return;
    const y = this.lastY - this.top - this.padTop + el.scrollTop;
    const next = this.o.elsewhere?.(this.lastX, this.lastY)
      ? null
      : hitTest(y, this.o.rowHeight(), this.o.rowCount(), this.o.isGroup);
    const prev = this.hover;
    if (prev?.index === next?.index && prev?.zone === next?.zone) return;
    this.hover = next;
    this.o.onHover(next);
  };

  private tick = (): void => {
    const el = this.el;
    if (this.phase !== 'dragging' || !el) return;
    const fromTop = this.lastY - this.top;
    const fromBottom = this.bottom - this.lastY;
    let speed = 0;
    if (this.o.elsewhere?.(this.lastX, this.lastY)) speed = 0;
    else if (fromTop < EDGE) speed = -Math.min(1, (EDGE - fromTop) / EDGE);
    else if (fromBottom < EDGE) speed = Math.min(1, (EDGE - fromBottom) / EDGE);
    if (speed !== 0) el.scrollTop += speed * MAX_SPEED;
    this.raf = requestAnimationFrame(this.tick);
  };

  private up = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const wasDragging = this.phase === 'dragging';
    const wasCancelled = this.phase === 'cancelled';
    const payload = this.payload;
    const target = this.hover;
    cancelAnimationFrame(this.raf);
    this.cleanup();
    if (wasDragging || wasCancelled) this.swallowClick();
    if (wasDragging && payload !== null) {
      this.o.onHover(null);
      this.o.onDrop(payload, target);
      this.o.onEnd();
    }
  };

  private abort = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.cancel();
    this.cleanup();
  };

  private key = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    this.cancel();
  };

  /** The pointerup after a drag would otherwise also be delivered as a click on a row or tile. */
  private swallowClick(): void {
    const stop = (ev: Event) => ev.stopPropagation();
    document.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', stop, true), 0);
  }

  private cleanup(): void {
    const el = this.el;
    document.removeEventListener('pointermove', this.move);
    document.removeEventListener('pointerup', this.up);
    document.removeEventListener('pointercancel', this.abort);
    if (el) {
      el.removeEventListener('scroll', this.updateHover);
      if (el.hasPointerCapture(this.pointerId)) el.releasePointerCapture(this.pointerId);
    }
    document.removeEventListener('keydown', this.key, true);
    cancelAnimationFrame(this.raf);
    this.el = null;
    this.phase = null;
    this.payload = null;
    this.hover = null;
  }
}
