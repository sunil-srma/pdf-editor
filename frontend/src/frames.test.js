import {
  MIN_BOX_SIZE, editFrame, findEditAt, handlesFor, imageFrame, isRotatable, isTextType, moveEditPatch,
  resizeEditPatch, rotateEditPatch,
} from './frames';
import { frameCorners, frameContains, handleDirection, toPage } from './geometry';
import { layoutText } from './textLayout';

// In the test environment text is measured as 0.5 em per character, ascent is 0.9 em and descent 0.2 em.
const text = (patch = {}) => ({
  id: 'text', type: 'addText', page: 1, text: 'abcd', textX: 100, baseline: 200, fontSize: 10, fontFamily: 'sans', ...patch,
});
const image = (patch = {}) => ({
  id: 'image', type: 'addImage', page: 1, x: 100, y: 100, width: 80, height: 40, ...patch,
});
const region = (patch = {}) => ({
  id: 'region', type: 'highlight', page: 1, x: 10, y: 20, width: 50, height: 12, ...patch,
});

const expectPoint = (actual, expected) => {
  expect(actual.x).toBeCloseTo(expected.x, 5);
  expect(actual.y).toBeCloseTo(expected.y, 5);
};

// The point a handle has to be dragged to for the frame to be `factor` times as large around the opposite corner.
const dragPoint = (frame, handle, factor) => {
  const [dx, dy] = handleDirection(handle);
  return toPage(
    frame,
    (-dx * frame.width) / 2 + dx * frame.width * factor,
    (-dy * frame.height) / 2 + dy * frame.height * factor,
  );
};

// Index in frameCorners() of the corner opposite to a corner handle.
const OPPOSITE = { nw: 2, ne: 3, se: 0, sw: 1 };

describe('kinds of edits', () => {
  test('text and replacements are text', () => {
    expect(isTextType(text())).toBe(true);
    expect(isTextType({ type: 'replace' })).toBe(true);
    expect(isTextType(image())).toBe(false);
    expect(isTextType(region())).toBe(false);
  });

  test('text and images can be turned', () => {
    expect(isRotatable(text())).toBe(true);
    expect(isRotatable(image())).toBe(true);
    expect(isRotatable(region())).toBe(false);
    expect(isRotatable({ type: 'erase' })).toBe(false);
  });

  test('text is resized by its width and scaled by its corners, the others by every handle', () => {
    expect(handlesFor(text()).sort()).toEqual(['e', 'ne', 'nw', 'se', 'sw', 'w']);
    expect(handlesFor(image())).toHaveLength(8);
    expect(handlesFor(region())).toHaveLength(8);
  });
});

describe('editFrame', () => {
  test('frames text by its layout', () => {
    const frame = editFrame(text());
    expect(frame.width).toBeCloseTo(20);
    expect(frame.height).toBeCloseTo(11);
    expect(frame.cx).toBeCloseTo(110);
    expect(frame.cy).toBeCloseTo(196.5);
  });

  test('frames an image by its box and turns it around its centre', () => {
    expect(imageFrame(image())).toEqual({ cx: 140, cy: 120, width: 80, height: 40, rotation: 0 });
    expect(editFrame(image({ rotation: 30 }))).toEqual({ cx: 140, cy: 120, width: 80, height: 40, rotation: 30 });
  });

  test('frames a region by its rectangle', () => {
    expect(editFrame(region())).toEqual({ cx: 35, cy: 26, width: 50, height: 12, rotation: 0 });
    expect(editFrame({ type: 'erase', x: 0, y: 0, width: 4, height: 2 })).toEqual({
      cx: 2, cy: 1, width: 4, height: 2, rotation: 0,
    });
  });

  test('frames a replacement by its new text, not by the box it covers', () => {
    const replaced = text({
      type: 'replace', x: 98, y: 188, width: 12, height: 14, text: 'abcd efgh', textX: 100, baseline: 200,
    });
    const frame = editFrame(replaced);
    expect(frame.width).toBeCloseTo(45);
    expect(frame.cx).toBeCloseTo(122.5);
  });
});

describe('findEditAt', () => {
  test('finds the edit under the point', () => {
    const edits = [text(), image()];
    expect(findEditAt(edits, 105, 197)).toBe(edits[0]);
    expect(findEditAt(edits, 150, 120)).toBe(edits[1]);
    expect(findEditAt(edits, 5, 5)).toBeNull();
    expect(findEditAt([], 5, 5)).toBeNull();
  });

  test('the topmost edit wins', () => {
    const edits = [image({ id: 'below' }), image({ id: 'above', x: 120 })];
    expect(findEditAt(edits, 150, 120).id).toBe('above');
    expect(findEditAt(edits, 110, 120).id).toBe('below');
  });

  test('only edits that are accepted are found', () => {
    const edits = [text({ baseline: 120, textX: 110 }), image()];
    expect(findEditAt(edits, 115, 117, (edit) => edit.type === 'addImage').type).toBe('addImage');
    expect(findEditAt(edits, 115, 117, () => false)).toBeNull();
  });

  test('has a tolerance around the edit', () => {
    const edits = [image()];
    expect(findEditAt(edits, 99, 120, undefined, 0)).toBeNull();
    expect(findEditAt(edits, 99, 120, undefined, 2)).toBe(edits[0]);
    expect(findEditAt(edits, 96, 120, undefined, 2)).toBeNull();
  });

  test('hits the whole text of a replacement, which is wider than the text it replaced', () => {
    // "Sunil" was replaced by "Sunil Sharma": the box that was covered is only as wide as "Sunil".
    const sunil = text({
      id: 'name', type: 'replace', x: 100, y: 190, width: 25, height: 13, text: 'Sunil Sharma', textX: 100, baseline: 200,
    });
    expect(findEditAt([sunil], 110, 197)).toBe(sunil);
    expect(findEditAt([sunil], 150, 197)).toBe(sunil);
    expect(findEditAt([sunil], 100 + 12 * 5 - 1, 197)).toBe(sunil);
    expect(findEditAt([sunil], 100 + 12 * 5 + 10, 197, undefined, 2)).toBeNull();
  });

  test('hits rotated text where it is drawn', () => {
    // Turned a quarter, the text runs down from its origin, and its glyphs are to the right of the baseline.
    const turned = text({ rotation: 90 });
    expect(findEditAt([turned], 100, 205)).toBe(turned);
    expect(findEditAt([turned], 108, 215)).toBe(turned);
    expect(findEditAt([turned], 115, 205)).toBeNull();
    expect(findEditAt([turned], 105, 190)).toBeNull();
    expect(findEditAt([turned], 105, 230)).toBeNull();
    // Where the end of the same text would be if it were not turned.
    expect(findEditAt([text()], 118, 195)).not.toBeNull();
    expect(findEditAt([turned], 118, 195)).toBeNull();
  });

  test('hits rotated images where they are drawn', () => {
    const tilted = image({ x: 100, y: 100, width: 100, height: 20, rotation: 90 });
    // Centre (150, 110), now 20 wide and 100 tall.
    expect(findEditAt([tilted], 150, 65)).toBe(tilted);
    expect(findEditAt([tilted], 150, 155)).toBe(tilted);
    expect(findEditAt([tilted], 105, 110, undefined, 0)).toBeNull();
    expect(findEditAt([tilted], 195, 110, undefined, 0)).toBeNull();
  });
});

describe('moveEditPatch', () => {
  test('moves the origin of text, and leaves the box that a replacement covers', () => {
    expect(moveEditPatch(text(), 5, -3)).toEqual({ textX: 105, baseline: 197 });
    const replaced = text({ type: 'replace', x: 98, y: 188, width: 12, height: 14 });
    expect(moveEditPatch(replaced, 5, -3)).toEqual({ textX: 105, baseline: 197 });
  });

  test('moves the box of images and regions', () => {
    expect(moveEditPatch(image(), 5, -3)).toEqual({ x: 105, y: 97 });
    expect(moveEditPatch(region(), -1, 1)).toEqual({ x: 9, y: 21 });
  });
});

describe('rotateEditPatch', () => {
  test('turns an image around its centre without moving its box', () => {
    expect(rotateEditPatch(image(), 30)).toEqual({ rotation: 30 });
    expect(rotateEditPatch(image(), -90)).toEqual({ rotation: 270 });
    expect(rotateEditPatch(image(), 720)).toEqual({ rotation: 0 });
  });

  test.each([30, 90, 137, 180, 270, 359])('turns text around the centre of its block, to %d degrees', (degrees) => {
    const block = text({ text: 'abcd\nab', boxWidth: 50, rotation: 20 });
    const before = editFrame(block);
    const patch = rotateEditPatch(block, degrees);
    expect(patch.rotation).toBeCloseTo(degrees);
    const after = editFrame({ ...block, ...patch });
    expectPoint({ x: after.cx, y: after.cy }, { x: before.cx, y: before.cy });
    expect(after.width).toBeCloseTo(before.width);
    expect(after.height).toBeCloseTo(before.height);
    expect(after.rotation).toBeCloseTo(degrees);
  });

  test('turning to the same rotation changes nothing', () => {
    const block = text({ rotation: 40, textX: 130.5, baseline: 77.25 });
    const patch = rotateEditPatch(block, 40);
    expect(patch.rotation).toBe(40);
    expect(patch.textX).toBeCloseTo(130.5);
    expect(patch.baseline).toBeCloseTo(77.25);
  });

  test('keeps the text of a replacement where the block is', () => {
    const replaced = text({ type: 'replace', x: 98, y: 188, width: 12, height: 14 });
    const patch = rotateEditPatch(replaced, 45);
    expect(Object.keys(patch).sort()).toEqual(['baseline', 'rotation', 'textX']);
  });
});

describe('resizeEditPatch for text', () => {
  test('the east side sets the width, and the west side stays', () => {
    const block = text({ text: 'aaaa bbbb cccc' });
    const frame = editFrame(block);
    const patch = resizeEditPatch(block, 'e', { x: 100 + 40, y: 197 });
    expect(patch).toEqual({ boxWidth: 40 });
    const after = editFrame({ ...block, ...patch });
    expect(after.cx - after.width / 2).toBeCloseTo(frame.cx - frame.width / 2);
  });

  test('the west side sets the width, and the east side stays', () => {
    const block = text({ text: 'aaaa bbbb cccc' });
    const frame = editFrame(block);
    expect(frame.width).toBeCloseTo(70);
    const patch = resizeEditPatch(block, 'w', { x: 100 + 30, y: 197 });
    expect(patch.boxWidth).toBeCloseTo(40);
    const after = editFrame({ ...block, ...patch });
    expect(after.cx + after.width / 2).toBeCloseTo(frame.cx + frame.width / 2);
    expect(patch.textX).toBeCloseTo(130);
    expect(patch.baseline).toBeCloseTo(200);
  });

  test.each([0, 30, 90, 215])('a turned block keeps its fixed side and its top when resized, at %d degrees', (rotation) => {
    const block = text({ text: 'aaaa bbbb cccc', rotation, boxWidth: 60 });
    const before = editFrame(block);
    const [tl, tr] = frameCorners(before);
    const east = resizeEditPatch(block, 'e', toPage(before, before.width / 2 - 20, 0));
    expect(east.boxWidth).toBeCloseTo(40);
    expectPoint(frameCorners(editFrame({ ...block, ...east }))[0], tl);

    const west = resizeEditPatch(block, 'w', toPage(before, -before.width / 2 + 20, 0));
    expect(west.boxWidth).toBeCloseTo(40);
    expectPoint(frameCorners(editFrame({ ...block, ...west }))[1], tr);
  });

  test('a block is at least as wide as its font size', () => {
    const block = text({ text: 'aaaa bbbb' });
    expect(resizeEditPatch(block, 'e', { x: 90, y: 200 }).boxWidth).toBe(10);
    expect(resizeEditPatch(block, 'w', { x: 400, y: 200 }).boxWidth).toBe(10);
  });

  test('top and bottom are not handles of text', () => {
    expect(resizeEditPatch(text(), 'n', { x: 100, y: 100 })).toBeNull();
    expect(resizeEditPatch(text(), 's', { x: 100, y: 100 })).toBeNull();
  });

  test('a narrower block wraps its text', () => {
    const block = text({ text: 'aaaa bbbb cccc' });
    const patch = resizeEditPatch(block, 'e', { x: 100 + 25, y: 197 });
    expect(layoutText({ ...block, ...patch }).lines).toEqual(['aaaa', 'bbbb', 'cccc']);
  });

  test.each(['nw', 'ne', 'se', 'sw'])('the %s corner scales the text around the opposite corner', (handle) => {
    [0, 30, 90, 200].forEach((rotation) => {
      const block = text({ text: 'abcd\nab', rotation, textX: 150, baseline: 250 });
      const before = editFrame(block);
      const patch = resizeEditPatch(block, handle, dragPoint(before, handle, 2));
      expect(patch.fontSize).toBe(20);
      expect(patch.boxWidth).toBeNull();
      const after = editFrame({ ...block, ...patch });
      expect(after.width).toBeCloseTo(before.width * 2);
      expect(after.height).toBeCloseTo(before.height * 2);
      expect(after.rotation).toBe(rotation);
      const fixed = OPPOSITE[handle];
      expectPoint(frameCorners(after)[fixed], frameCorners(before)[fixed]);
    });
  });

  test('scales the width of a block that has one', () => {
    const block = text({ text: 'aaaa bbbb', boxWidth: 30, rotation: 45 });
    const before = editFrame(block);
    const patch = resizeEditPatch(block, 'se', dragPoint(before, 'se', 1.5));
    expect(patch.fontSize).toBe(15);
    expect(patch.boxWidth).toBeCloseTo(45);
    const after = editFrame({ ...block, ...patch });
    expect(layoutText({ ...block, ...patch }).lines).toEqual(layoutText(block).lines);
    expect(after.height).toBeCloseTo(before.height * 1.5);
    expectPoint(frameCorners(after)[0], frameCorners(before)[0]);
  });

  test('shrinks and stops at the smallest font size', () => {
    const block = text();
    const before = editFrame(block);
    expect(resizeEditPatch(block, 'se', dragPoint(before, 'se', 0.5)).fontSize).toBe(5);
    expect(resizeEditPatch(block, 'se', dragPoint(before, 'se', 0.01)).fontSize).toBe(4);
    expect(resizeEditPatch(block, 'se', dragPoint(before, 'se', -3)).fontSize).toBe(4);
  });

  test('grows and stops at the largest font size', () => {
    const block = text();
    const before = editFrame(block);
    expect(resizeEditPatch(block, 'se', dragPoint(before, 'se', 1000)).fontSize).toBe(300);
  });

  test('tiny text can still be made larger', () => {
    const block = text({ fontSize: 3 });
    const before = editFrame(block);
    expect(resizeEditPatch(block, 'se', dragPoint(before, 'se', 2)).fontSize).toBe(6);
    expect(resizeEditPatch(block, 'se', dragPoint(before, 'se', 0.5)).fontSize).toBe(3);
  });

  test('the font size is kept to a tenth', () => {
    const block = text();
    const before = editFrame(block);
    expect(resizeEditPatch(block, 'se', dragPoint(before, 'se', 1.2345)).fontSize).toBe(12.3);
  });

  test('a replacement keeps the box it covers', () => {
    const replaced = text({ type: 'replace', x: 98, y: 188, width: 12, height: 14 });
    const patch = resizeEditPatch(replaced, 'se', dragPoint(editFrame(replaced), 'se', 2));
    expect(Object.keys(patch).sort()).toEqual(['baseline', 'boxWidth', 'fontSize', 'textX']);
  });
});

describe('resizeEditPatch for images and regions', () => {
  test('sides resize on their own axis', () => {
    const patch = resizeEditPatch(image(), 'e', { x: 220, y: 500 });
    expect(patch).toEqual({ x: 100, y: 100, width: 120, height: 40 });
    const north = resizeEditPatch(image(), 'n', { x: 0, y: 80 });
    expect(north).toEqual({ x: 100, y: 80, width: 80, height: 60 });
  });

  test('corners keep the proportions of an image', () => {
    const patch = resizeEditPatch(image(), 'se', { x: 260, y: 140 });
    expect(patch.width / patch.height).toBeCloseTo(2);
    expect(patch.x).toBeCloseTo(100);
    expect(patch.y).toBeCloseTo(100);
    expect(patch.width).toBeGreaterThan(80);
  });

  test('corners are free when asked to', () => {
    const patch = resizeEditPatch(image(), 'se', { x: 260, y: 140 }, { free: true });
    expect(patch).toEqual({ x: 100, y: 100, width: 160, height: 40 });
  });

  test('regions are resized freely', () => {
    const patch = resizeEditPatch(region(), 'se', { x: 100, y: 52 });
    expect(patch).toEqual({ x: 10, y: 20, width: 90, height: 32 });
  });

  test('cannot be made smaller than the minimum', () => {
    const patch = resizeEditPatch(image(), 'e', { x: 0, y: 120 });
    expect(patch.width).toBe(MIN_BOX_SIZE);
    const small = resizeEditPatch(image(), 'se', { x: 0, y: 0 });
    expect(small.width).toBeGreaterThanOrEqual(MIN_BOX_SIZE);
    expect(small.height).toBeGreaterThanOrEqual(MIN_BOX_SIZE);
    expect(small.width / small.height).toBeCloseTo(2);
  });

  test.each(['nw', 'ne', 'se', 'sw'])('a turned image keeps the opposite corner when its %s corner is dragged', (handle) => {
    const tilted = image({ rotation: 30 });
    const before = editFrame(tilted);
    const patch = resizeEditPatch(tilted, handle, dragPoint(before, handle, 1.5));
    const after = editFrame({ ...tilted, ...patch });
    expect(after.width).toBeCloseTo(120);
    expect(after.height).toBeCloseTo(60);
    expect(after.rotation).toBe(30);
    const fixed = OPPOSITE[handle];
    expectPoint(frameCorners(after)[fixed], frameCorners(before)[fixed]);
  });

  test('the box that is stored is the unturned one, around the centre of the frame', () => {
    const tilted = image({ rotation: 60 });
    const patch = resizeEditPatch(tilted, 'e', toPage(editFrame(tilted), 60, 0));
    const after = editFrame({ ...tilted, ...patch });
    expect(frameContains(after, after.cx, after.cy)).toBe(true);
    expect(patch.x + patch.width / 2).toBeCloseTo(after.cx);
    expect(patch.y + patch.height / 2).toBeCloseTo(after.cy);
  });
});
