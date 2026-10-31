import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Closes a popover: calls `onDismiss(reason)` when the pointer goes down outside `rootRef` ("outside") or Escape is
 * pressed ("escape") while `open`. Escape is kept from reaching anything else, so that it does not also close the
 * text editor or drop the selection.
 */
export default function useDismiss(open, rootRef, onDismiss) {
  const latest = useRef(onDismiss);
  useLayoutEffect(() => {
    latest.current = onDismiss;
  });

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        latest.current('outside');
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        latest.current('escape');
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, rootRef]);
}
