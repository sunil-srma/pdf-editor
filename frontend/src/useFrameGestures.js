import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { editFrame, isRotatable, moveEditPatch, resizeEditPatch, rotateEditPatch } from './frames';
import {
  frameBounds, handleDirection, keepOnPage, moveFrame, rotationAfterDrag, snapRotation, snapToGuides, toPage,
} from './geometry';
import useDrag, { DRAG_THRESHOLD } from './useDrag';

// How close (screen pixels) a block has to come to a guide line to snap to it.
export const SNAP_DISTANCE_PX = 6;
// Rotation snaps to steps of this many degrees while Shift is held.
export const ROTATION_STEP = 15;
// Handles follow the pointer almost at once.
const HANDLE_THRESHOLD = 1;

/** The lines a moving block snaps to: the edges and the middle of the page, and those of its other blocks. */
export function guideTargets(edits, pageSize, excludeId) {
  const x = [0, pageSize.width / 2, pageSize.width];
  const y = [0, pageSize.height / 2, pageSize.height];
  edits.forEach((edit) => {
    if (edit.id === excludeId || !isRotatable(edit)) {
      return;
    }
    const bounds = frameBounds(editFrame(edit));
    x.push(bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width);
    y.push(bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height);
  });
  return { x, y };
}

/**
 * Moving, resizing and rotating a block (or an image or region) with the pointer, with a live preview.
 *
 * `begin(event, edit, kind, handle, {onClick, onDragStart})` starts a gesture of the `kind` "move", "resize"
 * (with the `handle` that is dragged) or "rotate". While it runs, `live` is `{id, kind, patch, angle?, guides?}`:
 * the changes to preview on the edit. When the pointer is released after a drag `onCommit(edit, patch)` is called
 * once. A press that is released without a drag calls `onClick` instead. Escape cancels.
 *
 * @param pageSize   {width, height} of the page in page units
 * @param scale      screen pixels per page unit
 * @param pointFor   maps a pointer event to a point on the page, in page units
 * @param targetsFor optional: `(edit) => {x: number[], y: number[]}`, the guide lines a moving edit snaps to
 */
export default function useFrameGestures({ pageSize, scale, pointFor, targetsFor, onCommit }) {
  const drag = useDrag();
  const [live, setLive] = useState(null);
  const latest = useRef(null);

  useLayoutEffect(() => {
    latest.current = { pageSize, scale, pointFor, targetsFor, onCommit };
  });

  const begin = useCallback((event, edit, kind, handle, { onClick, onDragStart } = {}) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    const start = latest.current.pointFor(event);
    const frame = editFrame(edit);
    const targets = kind === 'move' && latest.current.targetsFor ? latest.current.targetsFor(edit) : null;
    let patch = null;
    let announced = false;
    // How far from the corner or side it stands for the handle was grabbed, so that the frame does not jump to
    // the pointer when the drag starts.
    let grab = { x: 0, y: 0 };
    if (kind === 'resize' && handleDirection(handle)) {
      const [hx, hy] = handleDirection(handle);
      const anchor = toPage(frame, (hx * frame.width) / 2, (hy * frame.height) / 2);
      grab = { x: start.x - anchor.x, y: start.y - anchor.y };
    }

    const compute = (move) => {
      const point = latest.current.pointFor(move);
      if (kind === 'resize') {
        const target = { x: point.x - grab.x, y: point.y - grab.y };
        const resized = resizeEditPatch(edit, handle, target, { free: move.shiftKey });
        return resized ? { patch: resized } : null;
      }
      if (kind === 'rotate') {
        const turned = rotationAfterDrag({ x: frame.cx, y: frame.cy }, start, point, edit.rotation || 0);
        const angle = move.shiftKey ? snapRotation(turned, { step: ROTATION_STEP }) : snapRotation(turned);
        return { patch: rotateEditPatch(edit, angle), angle };
      }

      let dx = point.x - start.x;
      let dy = point.y - start.y;
      let guides = null;
      if (targets && !move.altKey) {
        const bounds = frameBounds(moveFrame(frame, dx, dy));
        const reach = SNAP_DISTANCE_PX / latest.current.scale;
        const alongX = snapToGuides([bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width], targets.x, reach);
        const alongY = snapToGuides([bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height], targets.y, reach);
        dx += alongX ? alongX.shift : 0;
        dy += alongY ? alongY.shift : 0;
        guides = { x: alongX ? alongX.target : null, y: alongY ? alongY.target : null };
      }
      const size = latest.current.pageSize;
      const keep = keepOnPage(moveFrame(frame, dx, dy), size.width, size.height);
      return { patch: moveEditPatch(edit, dx + keep.dx, dy + keep.dy), guides };
    };

    drag.start(event, {
      threshold: kind === 'move' ? DRAG_THRESHOLD : HANDLE_THRESHOLD,
      onDrag: (move) => {
        const result = compute(move);
        if (!result) {
          return;
        }
        if (!announced) {
          announced = true;
          if (onDragStart) {
            onDragStart();
          }
        }
        patch = result.patch;
        setLive({ id: edit.id, kind, ...result });
      },
      onEnd: (up, moved) => {
        setLive(null);
        if (!moved) {
          if (onClick) {
            onClick(up);
          }
        } else if (patch) {
          latest.current.onCommit(edit, patch);
        }
      },
      onCancel: () => setLive(null),
    });
  }, [drag]);

  return { live, begin };
}
