import {
  angleOf, frameBounds, frameContains, frameCorners, frameOfRect, handleDirection, HANDLES, isCornerHandle,
  keepOnPage, moveFrame, normalizeDegrees, resizeCursor, resizeFrame, rotateAbout, rotateVector,
  rotationAfterDrag, signedDegrees, snapRotation, snapToGuides, toLocal, toPage,
} from './geometry';

const close = (actual, expected, digits = 6) => expect(actual).toBeCloseTo(expected, digits);
const closePoint = (actual, expected) => {
  close(actual.x, expected.x);
  close(actual.y, expected.y);
};

describe('angles', () => {
  it('normalizes to [0, 360)', () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(360)).toBe(0);
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(725)).toBe(5);
    expect(normalizeDegrees(-1e-14)).toBe(0);
  });

  it('gives signed angles in (-180, 180]', () => {
    expect(signedDegrees(270)).toBe(-90);
    expect(signedDegrees(180)).toBe(180);
    expect(signedDegrees(-180)).toBe(180);
    expect(signedDegrees(10)).toBe(10);
  });
});

describe('rotateVector', () => {
  it('turns clockwise on a page whose y axis points down', () => {
    // right becomes down, down becomes left
    closePoint(rotateVector(1, 0, 90), { x: 0, y: 1 });
    closePoint(rotateVector(0, 1, 90), { x: -1, y: 0 });
    closePoint(rotateVector(1, 0, 45), { x: Math.SQRT1_2, y: Math.SQRT1_2 });
  });

  it('is exact for quarter turns', () => {
    expect(rotateVector(3, 4, 90)).toEqual({ x: -4, y: 3 });
    expect(rotateVector(3, 4, 180)).toEqual({ x: -3, y: -4 });
    expect(rotateVector(3, 4, 270)).toEqual({ x: 4, y: -3 });
    expect(rotateVector(3, 4, 360)).toEqual({ x: 3, y: 4 });
    expect(rotateVector(3, 4, -90)).toEqual({ x: 4, y: -3 });
  });

  it('can be undone by the opposite angle', () => {
    const turned = rotateVector(7, -3, 33);
    closePoint(rotateVector(turned.x, turned.y, -33), { x: 7, y: -3 });
  });

  it('turns a point around a centre', () => {
    closePoint(rotateAbout({ x: 20, y: 10 }, { x: 10, y: 10 }, 90), { x: 10, y: 20 });
  });
});

describe('frames', () => {
  const frame = { cx: 100, cy: 50, width: 40, height: 20, rotation: 0 };

  it('converts between page and local coordinates', () => {
    const turned = { ...frame, rotation: 30 };
    closePoint(toLocal(turned, ...Object.values(toPage(turned, 7, -4))), { x: 7, y: -4 });
    closePoint(toPage(turned, 0, 0), { x: 100, y: 50 });
  });

  it('lists the corners clockwise from the top left', () => {
    expect(frameCorners(frame)).toEqual([
      { x: 80, y: 40 }, { x: 120, y: 40 }, { x: 120, y: 60 }, { x: 80, y: 60 },
    ]);
  });

  it('puts the top left corner at the bottom left after a quarter turn', () => {
    const [topLeft, topRight] = frameCorners({ ...frame, rotation: 90 });
    // The frame's top edge now runs downwards on the right hand side.
    expect(topLeft).toEqual({ x: 110, y: 30 });
    expect(topRight).toEqual({ x: 110, y: 70 });
  });

  it('computes the bounds of a rotated frame', () => {
    expect(frameBounds({ ...frame, rotation: 90 })).toEqual({ x: 90, y: 30, width: 20, height: 40 });
    const bounds = frameBounds({ ...frame, rotation: 45 });
    close(bounds.width, (40 + 20) * Math.SQRT1_2);
    close(bounds.height, (40 + 20) * Math.SQRT1_2);
  });

  it('builds a frame from a rectangle and moves it', () => {
    expect(frameOfRect({ x: 10, y: 20, width: 30, height: 40 })).toEqual({
      cx: 25, cy: 40, width: 30, height: 40, rotation: 0,
    });
    expect(moveFrame(frame, 5, -5)).toEqual({ ...frame, cx: 105, cy: 45 });
  });
});

describe('frameContains', () => {
  const frame = { cx: 100, cy: 100, width: 100, height: 20, rotation: 0 };

  it('hits inside an unrotated frame, edges included', () => {
    expect(frameContains(frame, 100, 100)).toBe(true);
    expect(frameContains(frame, 50, 90)).toBe(true);
    expect(frameContains(frame, 150, 110)).toBe(true);
    expect(frameContains(frame, 151, 100)).toBe(false);
    expect(frameContains(frame, 100, 111)).toBe(false);
  });

  it('applies a tolerance on every side', () => {
    expect(frameContains(frame, 153, 100, 3)).toBe(true);
    expect(frameContains(frame, 154, 100, 3)).toBe(false);
    expect(frameContains(frame, 100, 113, 3)).toBe(true);
  });

  it('follows the rotation: a quarter turn makes the frame tall', () => {
    const turned = { ...frame, rotation: 90 };
    expect(frameContains(turned, 100, 145)).toBe(true);
    expect(frameContains(turned, 145, 100)).toBe(false);
    expect(frameContains(turned, 109, 100)).toBe(true);
    expect(frameContains(turned, 111, 100)).toBe(false);
  });

  it('does not hit the empty corners of the bounding box of a diagonal frame', () => {
    const diagonal = { ...frame, rotation: 45 };
    // The top left corner of the bounding box is far from the rotated rectangle...
    const { x, y } = frameBounds(diagonal);
    expect(frameContains(diagonal, x + 1, y + 1)).toBe(false);
    // ...while the middle of the long edge is inside.
    const along = rotateVector(40, 0, 45);
    expect(frameContains(diagonal, 100 + along.x, 100 + along.y)).toBe(true);
  });
});

describe('resizeFrame', () => {
  const frame = { cx: 100, cy: 100, width: 40, height: 20, rotation: 0 };

  it('moves one side and keeps the opposite one', () => {
    const resized = resizeFrame(frame, 'e', { x: 150, y: 300 });
    expect(resized).toEqual({ cx: 115, cy: 100, width: 70, height: 20, rotation: 0 });
    const west = resizeFrame(frame, 'w', { x: 60, y: 0 });
    expect(west).toEqual({ cx: 90, cy: 100, width: 60, height: 20, rotation: 0 });
  });

  it('moves a corner and keeps the opposite one', () => {
    const resized = resizeFrame(frame, 'se', { x: 150, y: 130 });
    expect(resized).toEqual({ cx: 115, cy: 110, width: 70, height: 40, rotation: 0 });
    const northWest = resizeFrame(frame, 'nw', { x: 70, y: 80 });
    expect(northWest).toEqual({ cx: 95, cy: 95, width: 50, height: 30, rotation: 0 });
  });

  it('keeps the proportions of a corner on request', () => {
    const resized = resizeFrame(frame, 'se', { x: 160, y: 200 }, { keepAspect: true });
    close(resized.width / resized.height, 2);
    // The north west corner stays at (80, 90).
    close(resized.cx - resized.width / 2, 80);
    close(resized.cy - resized.height / 2, 90);
  });

  it('does not collapse below the minimum size', () => {
    const resized = resizeFrame(frame, 'e', { x: 0, y: 100 }, { minWidth: 8 });
    expect(resized.width).toBe(8);
    expect(resized.cx - resized.width / 2).toBe(80);
    const scaled = resizeFrame(frame, 'se', { x: 0, y: 0 }, { keepAspect: true, minWidth: 8, minHeight: 4 });
    close(scaled.width, 8);
    close(scaled.height, 4);
  });

  it('works along the axes of a rotated frame', () => {
    const turned = { ...frame, rotation: 90 };
    // The east handle of a frame turned by 90 degrees is below it.
    const resized = resizeFrame(turned, 'e', { x: 100, y: 150 });
    close(resized.width, 70);
    close(resized.height, 20);
    closePoint({ x: resized.cx, y: resized.cy }, { x: 100, y: 115 });
    expect(resized.rotation).toBe(90);
  });

  it('never moves the anchor, whatever the rotation and the handle', () => {
    [0, 17, 90, 133, 270].forEach((rotation) => {
      HANDLES.forEach((handle) => {
        const turned = { cx: 120, cy: 80, width: 60, height: 30, rotation };
        const [dx, dy] = handleDirection(handle);
        const before = toPage(turned, (-dx * turned.width) / 2, (-dy * turned.height) / 2);
        const pointer = toPage(turned, dx * 70, dy * 40);
        const resized = resizeFrame(turned, handle, pointer, { keepAspect: isCornerHandle(handle) });
        const after = toPage(resized, (-dx * resized.width) / 2, (-dy * resized.height) / 2);
        closePoint(after, before);
        expect(resized.rotation).toBe(rotation);
      });
    });
  });

  it('puts the handle under the pointer when the proportions are free', () => {
    const turned = { cx: 120, cy: 80, width: 60, height: 30, rotation: 40 };
    const pointer = { x: 190, y: 150 };
    const resized = resizeFrame(turned, 'se', pointer);
    closePoint(toPage(resized, resized.width / 2, resized.height / 2), pointer);
  });
});

describe('resize cursors', () => {
  it('names the cursor along the handle', () => {
    expect(resizeCursor('n')).toBe('ns-resize');
    expect(resizeCursor('s')).toBe('ns-resize');
    expect(resizeCursor('e')).toBe('ew-resize');
    expect(resizeCursor('ne')).toBe('nesw-resize');
    expect(resizeCursor('sw')).toBe('nesw-resize');
    expect(resizeCursor('nw')).toBe('nwse-resize');
    expect(resizeCursor('se')).toBe('nwse-resize');
  });

  it('turns with the frame', () => {
    expect(resizeCursor('n', 90)).toBe('ew-resize');
    expect(resizeCursor('e', 90)).toBe('ns-resize');
    expect(resizeCursor('n', 45)).toBe('nesw-resize');
    expect(resizeCursor('ne', 45)).toBe('ew-resize');
    expect(resizeCursor('nw', 90)).toBe('nesw-resize');
    expect(resizeCursor('n', 180)).toBe('ns-resize');
  });
});

describe('rotation', () => {
  const centre = { x: 100, y: 100 };

  it('measures the direction clockwise from up', () => {
    close(angleOf(centre, { x: 100, y: 50 }), 0);
    close(angleOf(centre, { x: 150, y: 100 }), 90);
    close(angleOf(centre, { x: 100, y: 150 }), 180);
    close(angleOf(centre, { x: 50, y: 100 }), -90);
  });

  it('adds what the pointer turned to the start rotation', () => {
    // From above to the right of the centre is a quarter turn.
    close(rotationAfterDrag(centre, { x: 100, y: 50 }, { x: 150, y: 100 }, 10), 100);
    // Grabbing next to the handle axis does not make the frame jump.
    close(rotationAfterDrag(centre, { x: 110, y: 50 }, { x: 110, y: 50 }, 30), 30);
    close(rotationAfterDrag(centre, { x: 100, y: 50 }, { x: 50, y: 100 }, 0), 270);
  });

  it('snaps to multiples of a step', () => {
    expect(snapRotation(37, { step: 15 })).toBe(30);
    expect(snapRotation(38, { step: 15 })).toBe(45);
    expect(snapRotation(359, { step: 15 })).toBe(0);
  });

  it('sticks to the multiples of 45 degrees when it is close', () => {
    expect(snapRotation(2)).toBe(0);
    expect(snapRotation(358)).toBe(0);
    expect(snapRotation(92.5)).toBe(90);
    expect(snapRotation(47)).toBe(45);
    expect(snapRotation(40)).toBe(40);
    expect(snapRotation(33.3)).toBe(33.3);
  });
});

describe('keepOnPage', () => {
  const frame = { cx: 100, cy: 100, width: 50, height: 20, rotation: 0 };

  it('leaves a frame that is on the page alone', () => {
    expect(keepOnPage(frame, 600, 800)).toEqual({ dx: 0, dy: 0 });
    expect(keepOnPage({ ...frame, cx: 590 }, 600, 800, 10)).toEqual({ dx: 0, dy: 0 });
  });

  it('brings back a frame that was dragged away', () => {
    // Afterwards 10 units of the frame are left on the page.
    expect(keepOnPage({ ...frame, cx: -100 }, 600, 800, 10)).toEqual({ dx: 85, dy: 0 });
    expect(keepOnPage({ ...frame, cx: 900 }, 600, 800, 10)).toEqual({ dx: -285, dy: 0 });
    expect(keepOnPage({ ...frame, cy: -50 }, 600, 800, 10)).toEqual({ dx: 0, dy: 50 });
    expect(keepOnPage({ ...frame, cy: 1000 }, 600, 800, 10)).toEqual({ dx: 0, dy: -200 });
  });
});

describe('snapToGuides', () => {
  it('finds the closest guide within the threshold', () => {
    expect(snapToGuides([100, 150, 200], [0, 148, 300], 4)).toEqual({ shift: -2, target: 148 });
    expect(snapToGuides([100], [0, 300], 4)).toBeNull();
  });

  it('prefers the smaller shift', () => {
    expect(snapToGuides([100, 110], [103, 108], 5)).toEqual({ shift: -2, target: 108 });
  });
});
