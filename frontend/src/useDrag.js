import { useCallback, useEffect, useMemo, useRef } from 'react';

// Pointer movement (CSS pixels) after which a press counts as a drag rather than a click.
export const DRAG_THRESHOLD = 4;

/**
 * Pointer gestures that follow the pointer over the whole window, so that they carry on when it leaves the
 * element they began on. A gesture ends when the button is released; Escape (or a cancelled pointer, or the
 * component going away) cancels it.
 *
 * `start(event, {threshold, onDrag, onEnd, onCancel})`:
 *  - `onDrag(event)` is called for every move once the pointer has travelled `threshold` pixels;
 *  - `onEnd(event, moved)` when the button is released, `moved` telling whether it was a drag or a click;
 *  - `onCancel()` otherwise.
 * Starting a gesture cancels the one that is running.
 */
export default function useDrag() {
  const current = useRef(null);

  const cancel = useCallback(() => {
    const gesture = current.current;
    if (gesture) {
      current.current = null;
      gesture.dispose();
      if (gesture.onCancel) {
        gesture.onCancel();
      }
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const start = useCallback((event, { threshold = DRAG_THRESHOLD, onDrag, onEnd, onCancel } = {}) => {
    cancel();
    const id = event.pointerId;
    const from = { x: event.clientX, y: event.clientY };
    let moved = false;

    const onMove = (move) => {
      if (move.pointerId !== id) {
        return;
      }
      if (!moved) {
        if (Math.hypot(move.clientX - from.x, move.clientY - from.y) < threshold) {
          return;
        }
        moved = true;
      }
      if (onDrag) {
        onDrag(move);
      }
    };
    const onUp = (up) => {
      if (up.pointerId !== id) {
        return;
      }
      current.current = null;
      dispose();
      if (onEnd) {
        onEnd(up, moved);
      }
    };
    const onAbort = (abort) => {
      if (abort.pointerId === id) {
        cancel();
      }
    };
    // Escape ends the gesture and nothing else: it must not also close the editor or the selection.
    const onKey = (key) => {
      if (key.key === 'Escape') {
        key.preventDefault();
        key.stopPropagation();
        cancel();
      }
    };
    function dispose() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onAbort);
      window.removeEventListener('keydown', onKey, true);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onAbort);
    window.addEventListener('keydown', onKey, true);
    current.current = { dispose, onCancel };
  }, [cancel]);

  return useMemo(() => ({ start, cancel }), [start, cancel]);
}
