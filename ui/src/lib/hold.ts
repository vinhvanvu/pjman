// Holding still (decision motion-design/hold-still-while-in-the-strip): while the pointer is over a live list or focus
// is inside it, nothing in it changes place. No item is re-sorted, inserted or removed; each keeps updating what it
// says where it stands. When the pointer leaves (after a grace, so brushing the edge does not release it) or focus
// leaves, the list settles to the live order, the moves played as arrivals. A touch has no hover, so it never holds.
// The one exception is the item the person just acted on (decision decide-is-slow/acted-card-leaves-the-hold): once
// let go, it leaves as soon as it is gone, while the rest stay held.
import { useCallback, useEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react';

const GRACE_MS = 450;

export function useHold() {
  const [held, setHeld] = useState(false);
  const pointer = useRef(false);
  const list = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const hold = useCallback(() => {
    clearTimeout(timer.current);
    setHeld(true);
  }, []);
  // focus is read where it is, never remembered: a focused control that unmounts takes focus to the body without a
  // blur reaching the list, and a remembered focus would hold the list until focus came back and left again
  const settle = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!pointer.current && !list.current?.contains(document.activeElement)) setHeld(false);
    }, GRACE_MS);
  }, []);
  const props = {
    ref: (el: HTMLElement | null) => {
      list.current = el;
    },
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      pointer.current = true;
      hold();
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      pointer.current = false;
      settle();
    },
    onFocus: hold,
    onBlur: (e: FocusEvent) => {
      // focus moving between items inside the list keeps it held
      if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
      settle();
    },
  };
  /** `settle` lets the list go after the grace unless the pointer is over it or focus is inside it: the list calls it
   *  itself, and a caller calls it after a write whose control may have taken the focus away with it. */
  return { held, props, settle };
}

const NONE: ReadonlySet<string> = new Set();

/** What a held list shows: the items in the order held, each the live one when it still exists (by key, from `find`),
 *  else as it was last seen; anything new is left out until the release. An item let go (`letGo`) that has gone
 *  leaves at once instead. `pending` counts the items whose place the release will change: new, gone, or moved. */
export function heldOrder<T>(
  frozen: readonly T[],
  live: readonly T[],
  keyOf: (t: T) => string,
  find: (key: string) => T | undefined = (k) => live.find((t) => keyOf(t) === k),
  letGo: ReadonlySet<string> = NONE,
): { shown: T[]; pending: number } {
  const kept = frozen.filter((t) => !letGo.has(keyOf(t)) || find(keyOf(t)) !== undefined);
  const shown = kept.map((t) => find(keyOf(t)) ?? t);
  const was = kept.map(keyOf);
  const now = live.map(keyOf);
  const pending = new Set([...now.filter((k, i) => was[i] !== k), ...was.filter((k) => !now.includes(k))]).size;
  return { shown, pending };
}

/** A list that holds still while `held`: the order shown when the hold began, kept until it ends. `letGo(key)` marks
 *  the item the person acted on, so it leaves when it goes even while the list is held. */
export function useHeldList<T>(
  live: readonly T[],
  held: boolean,
  keyOf: (t: T) => string,
  find?: (key: string) => T | undefined,
): { shown: readonly T[]; pending: number; letGo: (key: string) => void } {
  const [frozen, setFrozen] = useState<readonly T[] | undefined>(undefined);
  const [gone, setGone] = useState<ReadonlySet<string>>(NONE);
  // set while rendering, as derived state: the hold takes the list as it stands when it begins
  if (held && !frozen) setFrozen(live);
  if (!held && frozen) {
    setFrozen(undefined);
    setGone(NONE);
  }
  const letGo = useCallback((key: string) => setGone((prev) => new Set(prev).add(key)), []);
  return held && frozen ? { ...heldOrder(frozen, live, keyOf, find, gone), letGo } : { shown: live, pending: 0, letGo };
}
