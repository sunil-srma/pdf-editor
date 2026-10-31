// Geometry of rotated frames, shared by hit-testing, the selection frame and the editors. Everything is pure.
//
// Angles are clockwise degrees on the page, whose y axis points down: this is the `rotation` of an edit and
// what the backend applies. A frame is a rotated rectangle {cx, cy, width, height, rotation}.

export const toRadians = (degrees) => (degrees * Math.PI) / 180;

/** The angle as a value in [0, 360). */
export function normalizeDegrees(degrees) {
  if (degrees >= 0 && degrees < 360) {
    return degrees;
  }
  const value = ((degrees % 360) + 360) % 360;
  // -1e-14 % 360 + 360 rounds up to exactly 360.
  return value >= 360 ? 0 : value;
}

/** The angle as a value in (-180, 180]. */
export function signedDegrees(degrees) {
  const value = normalizeDegrees(degrees);
  return value > 180 ? value - 360 : value;
}

/** A vector turned clockwise by `degrees`. Quarter turns are exact, so stored coordinates stay clean. */
export function rotateVector(x, y, degrees) {
  const angle = normalizeDegrees(degrees);
  if (angle === 0) {
    return { x, y };
  }
  if (angle === 90) {
    return { x: -y, y: x };
  }
  if (angle === 180) {
    return { x: -x, y: -y };
  }
  if (angle === 270) {
    return { x: y, y: -x };
  }
  const radians = toRadians(angle);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/** A point turned clockwise around `centre`. */
export function rotateAbout(point, centre, degrees) {
  const turned = rotateVector(point.x - centre.x, point.y - centre.y, degrees);
  return { x: centre.x + turned.x, y: centre.y + turned.y };
}

/** A point given in the frame's own axes (origin at its centre) as a point on the page. */
export function toPage(frame, localX, localY) {
  const turned = rotateVector(localX, localY, frame.rotation || 0);
  return { x: frame.cx + turned.x, y: frame.cy + turned.y };
}

/** A point on the page in the frame's own axes (origin at its centre, x along the frame's top edge). */
export function toLocal(frame, x, y) {
  return rotateVector(x - frame.cx, y - frame.cy, -(frame.rotation || 0));
}

/** The corners of the frame, clockwise from the top left one. */
export function frameCorners(frame) {
  const halfWidth = frame.width / 2;
  const halfHeight = frame.height / 2;
  return [
    toPage(frame, -halfWidth, -halfHeight),
    toPage(frame, halfWidth, -halfHeight),
    toPage(frame, halfWidth, halfHeight),
    toPage(frame, -halfWidth, halfHeight),
  ];
}

/** The smallest unrotated rectangle {x, y, width, height} that contains the frame. */
export function frameBounds(frame) {
  const corners = frameCorners(frame);
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Whether the point is inside the frame, or within `tolerance` of it. Works for any rotation. */
export function frameContains(frame, x, y, tolerance = 0) {
  const local = toLocal(frame, x, y);
  return Math.abs(local.x) <= frame.width / 2 + tolerance && Math.abs(local.y) <= frame.height / 2 + tolerance;
}

/** A frame for an unrotated rectangle {x, y, width, height}. */
export function frameOfRect({ x, y, width, height }) {
  return { cx: x + width / 2, cy: y + height / 2, width, height, rotation: 0 };
}

/** Moves a frame. */
export function moveFrame(frame, dx, dy) {
  return { ...frame, cx: frame.cx + dx, cy: frame.cy + dy };
}

/**
 * Moves a frame by the least amount that keeps at least `margin` units of its bounding box on the page, so
 * that nothing can be dragged out of reach.
 */
export function keepOnPage(frame, pageWidth, pageHeight, margin = 10) {
  const bounds = frameBounds(frame);
  const keep = (start, size, limit) => {
    const grip = Math.min(margin, size);
    if (start + size < grip) {
      return grip - (start + size);
    }
    if (start > limit - grip) {
      return limit - grip - start;
    }
    return 0;
  };
  return {
    dx: keep(bounds.x, bounds.width, pageWidth),
    dy: keep(bounds.y, bounds.height, pageHeight),
  };
}

// --- Handles --------------------------------------------------------------------------------------------

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

// Where each handle sits on the frame, as a direction in the frame's own axes.
const DIRECTIONS = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};

export const handleDirection = (handle) => DIRECTIONS[handle];
export const isCornerHandle = (handle) => DIRECTIONS[handle][0] !== 0 && DIRECTIONS[handle][1] !== 0;

/** The CSS cursor for a resize handle of a frame turned by `rotation` degrees. */
export function resizeCursor(handle, rotation = 0) {
  const [dx, dy] = DIRECTIONS[handle];
  const angle = normalizeDegrees((Math.atan2(dx, -dy) * 180) / Math.PI + rotation);
  return ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'][Math.round(angle / 45) % 4];
}

/**
 * Resizes the frame by dragging one of its handles to `point` (page coordinates). The side or corner opposite
 * to the handle stays where it is. With `keepAspect` a corner keeps the proportions of the frame; sides
 * always move on their own axis only.
 *
 * @param {{minWidth?: number, minHeight?: number, keepAspect?: boolean}} options
 */
export function resizeFrame(frame, handle, point, { minWidth = 1, minHeight = 1, keepAspect = false } = {}) {
  const [dx, dy] = DIRECTIONS[handle];
  const local = toLocal(frame, point.x, point.y);
  const anchorX = (-dx * frame.width) / 2;
  const anchorY = (-dy * frame.height) / 2;

  let width = dx === 0 ? frame.width : dx * (local.x - anchorX);
  let height = dy === 0 ? frame.height : dy * (local.y - anchorY);
  if (keepAspect && dx !== 0 && dy !== 0) {
    // The factor that fits the pointer best along the diagonal, so that the frame follows it smoothly.
    const factor = (width * frame.width + height * frame.height) / (frame.width ** 2 + frame.height ** 2);
    const least = Math.max(minWidth / frame.width, minHeight / frame.height);
    const scale = Math.max(least, factor);
    width = frame.width * scale;
    height = frame.height * scale;
  } else {
    width = Math.max(minWidth, width);
    height = Math.max(minHeight, height);
  }

  const centre = toPage(
    frame,
    dx === 0 ? 0 : anchorX + (dx * width) / 2,
    dy === 0 ? 0 : anchorY + (dy * height) / 2,
  );
  return { cx: centre.x, cy: centre.y, width, height, rotation: frame.rotation || 0 };
}

// --- Rotation -------------------------------------------------------------------------------------------

/** The direction from `centre` to `point` in degrees, clockwise from straight up. */
export function angleOf(centre, point) {
  return (Math.atan2(point.x - centre.x, centre.y - point.y) * 180) / Math.PI;
}

/**
 * The rotation after the pointer went from `from` to `to` while turning a frame around `centre`. Grabbing the
 * handle slightly off its axis therefore does not make the frame jump.
 */
export function rotationAfterDrag(centre, from, to, startRotation) {
  return normalizeDegrees(startRotation + angleOf(centre, to) - angleOf(centre, from));
}

/**
 * Snaps a rotation. With `step` (Shift) it goes to the closest multiple of it. Otherwise it sticks to the
 * multiples of 45° that are closer than `threshold` degrees, so upright and diagonal are easy to get.
 */
export function snapRotation(degrees, { step = 0, threshold = 3 } = {}) {
  const angle = normalizeDegrees(degrees);
  if (step > 0) {
    return normalizeDegrees(Math.round(angle / step) * step);
  }
  const nearest = Math.round(angle / 45) * 45;
  return Math.abs(angle - nearest) <= threshold ? normalizeDegrees(nearest) : angle;
}

// --- Guides ---------------------------------------------------------------------------------------------

/**
 * Finds the closest of the guide lines `targets` (page coordinates on one axis) to any of the `positions` of a
 * moving frame on that axis.
 *
 * @returns {{shift: number, target: number}|null} how far to move to hit the guide, and the guide itself
 */
export function snapToGuides(positions, targets, threshold) {
  let best = null;
  positions.forEach((position) => {
    targets.forEach((target) => {
      const shift = target - position;
      if (Math.abs(shift) <= threshold && (best === null || Math.abs(shift) < Math.abs(best.shift))) {
        best = { shift, target };
      }
    });
  });
  return best;
}
