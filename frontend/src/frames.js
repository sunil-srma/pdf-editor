// The frames of edits: the rotated boxes the user points at, moves, resizes and turns. A text block is framed by the
// layout of its text, an image by its box, a region (erase, highlight) by its rectangle.
//
// The `...Patch` functions return the fields of an edit (or of an editor session, which has the same geometry
// fields) that have to change for the requested move, resize or rotation, so that history updates and live
// previews are made of the same values.

import {
  MAX_FONT_SIZE, MIN_FONT_SIZE, blockFrame, layoutText, originForFrame,
} from './textLayout';
import {
  frameContains, frameOfRect, handleDirection, isCornerHandle, normalizeDegrees, resizeFrame, rotateVector, toLocal,
} from './geometry';

// The smallest size, in page units, an image or region can be given.
export const MIN_BOX_SIZE = 10;

export const isTextType = (edit) => edit.type === 'replace' || edit.type === 'addText';
export const isRotatable = (edit) => isTextType(edit) || edit.type === 'addImage';

export function imageFrame(edit) {
  return {
    cx: edit.x + edit.width / 2,
    cy: edit.y + edit.height / 2,
    width: edit.width,
    height: edit.height,
    rotation: edit.rotation || 0,
  };
}

/** The frame an edit is selected, moved, resized and turned by. */
export function editFrame(edit) {
  if (isTextType(edit)) {
    return blockFrame(edit);
  }
  return edit.type === 'addImage' ? imageFrame(edit) : frameOfRect(edit);
}

/**
 * The topmost edit under the point. `accept` filters the edits that may be hit. Rotated blocks are hit where they
 * are drawn, not where their bounding box is.
 */
export function findEditAt(edits, x, y, accept = () => true, tolerance = 2) {
  for (let i = edits.length - 1; i >= 0; i -= 1) {
    if (accept(edits[i]) && frameContains(editFrame(edits[i]), x, y, tolerance)) {
      return edits[i];
    }
  }
  return null;
}

/** The resize handles an edit offers. Text is resized by its width, or scaled by its corners. */
export function handlesFor(edit) {
  return isTextType(edit) ? ['nw', 'ne', 'se', 'sw', 'e', 'w'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
}

export function moveEditPatch(edit, dx, dy) {
  return isTextType(edit)
    ? { textX: edit.textX + dx, baseline: edit.baseline + dy }
    : { x: edit.x + dx, y: edit.y + dy };
}

/** Turns an edit around the centre of its frame, so that it stays where it is while it turns. */
export function rotateEditPatch(edit, rotation) {
  const degrees = normalizeDegrees(rotation);
  if (!isTextType(edit)) {
    return { rotation: degrees };
  }
  const layout = layoutText(edit);
  const frame = blockFrame(edit, layout);
  return { rotation: degrees, ...originForFrame(layout, { ...frame, rotation: degrees }) };
}

const round1 = (value) => Math.round(value * 10) / 10;

function resizeTextPatch(edit, handle, point) {
  const layout = layoutText(edit);
  const frame = blockFrame(edit, layout);
  const rotation = edit.rotation || 0;
  const size = layout.fontSize;

  if (!isCornerHandle(handle)) {
    if (handle !== 'e' && handle !== 'w') {
      return null;
    }
    // The sides of a text block set its width; the text wraps to it. The side opposite to the handle stays.
    const fromLeft = toLocal(frame, point.x, point.y).x + frame.width / 2;
    if (handle === 'e') {
      return { boxWidth: Math.max(size, fromLeft) };
    }
    const boxWidth = Math.max(size, frame.width - fromLeft);
    const shift = rotateVector(frame.width - boxWidth, 0, rotation);
    return { boxWidth, textX: edit.textX + shift.x, baseline: edit.baseline + shift.y };
  }

  // The corners scale the text. Everything in the layout is proportional to the font size, so the block keeps
  // its shape and the corner opposite to the handle stays where it is.
  const least = Math.min(1, MIN_FONT_SIZE / size);
  const most = Math.max(1, MAX_FONT_SIZE / size);
  const target = resizeFrame(frame, handle, point, {
    keepAspect: true,
    minWidth: frame.width * least,
    minHeight: frame.height * least,
  });
  const fontSize = round1(Math.min(size * most, Math.max(size * least, (size * target.width) / frame.width)));
  const factor = fontSize / size;

  const [dx, dy] = handleDirection(handle);
  const fixed = rotateVector(
    dx < 0 ? frame.width : 0,
    dy < 0 ? -layout.ascent + layout.height : -layout.ascent,
    rotation,
  );
  return {
    fontSize,
    boxWidth: layout.boxWidth === null ? null : layout.boxWidth * factor,
    textX: edit.textX + (1 - factor) * fixed.x,
    baseline: edit.baseline + (1 - factor) * fixed.y,
  };
}

/**
 * The change that drags `handle` to `point` (page coordinates) makes. Corners of images keep the proportions
 * unless `free` is set. Returns null for a handle the edit does not have.
 */
export function resizeEditPatch(edit, handle, point, { free = false } = {}) {
  if (isTextType(edit)) {
    return resizeTextPatch(edit, handle, point);
  }
  const next = resizeFrame(editFrame(edit), handle, point, {
    minWidth: MIN_BOX_SIZE,
    minHeight: MIN_BOX_SIZE,
    keepAspect: edit.type === 'addImage' && !free,
  });
  return {
    x: next.cx - next.width / 2,
    y: next.cy - next.height / 2,
    width: next.width,
    height: next.height,
  };
}
