import { act, fireEvent, renderHook } from '@testing-library/react';
import useFrameGestures, { ROTATION_STEP, SNAP_DISTANCE_PX, guideTargets } from './useFrameGestures';

const pageSize = { width: 600, height: 800 };
// The page is shown at twice its size.
const SCALE = 2;
const pointFor = (event) => ({ x: event.clientX / SCALE, y: event.clientY / SCALE });

const image = (extra = {}) => ({
  id: 'i', type: 'addImage', page: 1, x: 100, y: 100, width: 100, height: 50, rotation: 0, opacity: 1, imageUrl: 'data:,x', ...extra,
});
const text = (extra = {}) => ({
  id: 't', type: 'addText', page: 1, text: 'Hello', textX: 100, baseline: 200, fontSize: 20, fontFamily: 'sans', rotation: 0, ...extra,
});

// A pointer press at a point of the page, as the screen sees it.
const press = (x, y) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: x * SCALE, clientY: y * SCALE });
const move = (x, y, extra = {}) => act(() => {
  fireEvent.pointerMove(window, { pointerId: 1, clientX: x * SCALE, clientY: y * SCALE, ...extra });
});
const release = (x, y) => act(() => {
  fireEvent.pointerUp(window, { pointerId: 1, clientX: x * SCALE, clientY: y * SCALE });
});

function setup(options = {}) {
  const onCommit = jest.fn();
  const rendered = renderHook(() => useFrameGestures({ pageSize, scale: SCALE, pointFor, onCommit, ...options }));
  const begin = (...args) => act(() => rendered.result.current.begin(...args));
  return { ...rendered, onCommit, begin, live: () => rendered.result.current.live };
}

describe('guideTargets', () => {
  test('are the edges and the middle of the page', () => {
    expect(guideTargets([], pageSize, null)).toEqual({ x: [0, 300, 600], y: [0, 400, 800] });
  });

  test('include the edges and the middle of the other blocks and images', () => {
    const targets = guideTargets([image(), text(), image({ id: 'other', x: 10, y: 20, width: 40, height: 60 })], pageSize, 'i');
    // The image 'i' is the one that moves: it is not a guide for itself.
    expect(targets.x).toEqual(expect.arrayContaining([0, 300, 600, 10, 30, 50]));
    // The image 'i' is the one that moves: its right edge (200) is not a guide for itself.
    expect(targets.x).not.toContain(200);
    expect(targets.y).toEqual(expect.arrayContaining([20, 50, 80]));
    // The block of text: its left edge is its origin, and it is 50 wide.
    expect(targets.x).toEqual(expect.arrayContaining([100, 125, 150]));
  });

  test('regions are not guides', () => {
    const targets = guideTargets([{ id: 'e', type: 'erase', x: 11, y: 22, width: 33, height: 44 }], pageSize, null);
    expect(targets.x).toHaveLength(3);
    expect(targets.y).toHaveLength(3);
  });
});

describe('moving', () => {
  test('previews the move and commits it once when the pointer is released', () => {
    const { begin, live, onCommit } = setup();
    const edit = image();
    begin(press(150, 125), edit, 'move');
    expect(live()).toBeNull();

    move(190, 145);
    expect(live()).toMatchObject({ id: 'i', kind: 'move', patch: { x: 140, y: 120 } });
    expect(onCommit).not.toHaveBeenCalled();

    move(200, 150);
    release(200, 150);
    expect(live()).toBeNull();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(edit, { x: 150, y: 125 });
  });

  test('moves added text by its origin', () => {
    const { begin, onCommit } = setup();
    const edit = text();
    begin(press(110, 195), edit, 'move');
    move(130, 215);
    release(130, 215);
    expect(onCommit).toHaveBeenCalledWith(edit, { textX: 120, baseline: 220 });
  });

  test('a press that is released without a drag is a click', () => {
    const { begin, live, onCommit } = setup();
    const onClick = jest.fn();
    begin(press(150, 125), image(), 'move', null, { onClick });
    move(150.5, 125);
    release(150.5, 125);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(live()).toBeNull();
  });

  test('tells when the drag begins, once', () => {
    const { begin } = setup();
    const onDragStart = jest.fn();
    begin(press(150, 125), image(), 'move', null, { onDragStart });
    move(151, 125);
    expect(onDragStart).not.toHaveBeenCalled();
    move(160, 125);
    move(170, 125);
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });

  test('Escape drops the move', () => {
    const { begin, live, onCommit } = setup();
    begin(press(150, 125), image(), 'move');
    move(190, 145);
    expect(live()).not.toBeNull();
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(live()).toBeNull();
    release(190, 145);
    expect(onCommit).not.toHaveBeenCalled();
  });

  test('only the main button of a mouse starts a gesture', () => {
    const { begin, onCommit } = setup();
    begin({ ...press(150, 125), button: 2 }, image(), 'move');
    move(190, 145);
    release(190, 145);
    expect(onCommit).not.toHaveBeenCalled();
  });

  test('cannot take a block off the page', () => {
    const { begin, onCommit } = setup();
    begin(press(150, 125), image(), 'move');
    move(-850, 125);
    release(-850, 125);
    // At least 10 units of the image are left on the page.
    expect(onCommit.mock.calls[0][1].x).toBeCloseTo(-90);
  });

  describe('with guides', () => {
    const targetsFor = () => ({ x: [300], y: [] });

    test('snaps to a guide that is close and says which', () => {
      const { begin, live, onCommit } = setup({ targetsFor });
      begin(press(150, 125), image(), 'move');
      // The right edge is at 200 + 98 = 298, 2 units from the guide.
      move(248, 125);
      expect(live().guides).toEqual({ x: 300, y: null });
      release(248, 125);
      expect(onCommit.mock.calls[0][1]).toEqual({ x: 200, y: 100 });
    });

    test('the middle of a block snaps as well', () => {
      const { begin, onCommit } = setup({ targetsFor });
      begin(press(150, 125), image(), 'move');
      // The middle is at 150 + 148 = 298.
      move(298, 125);
      release(298, 125);
      expect(onCommit.mock.calls[0][1].x).toBeCloseTo(250);
    });

    test('does not snap when the guide is further away than a few screen pixels', () => {
      const { begin, live, onCommit } = setup({ targetsFor });
      begin(press(150, 125), image(), 'move');
      // 3.5 units, 7 screen pixels from the guide.
      const reach = SNAP_DISTANCE_PX / SCALE;
      move(250 - reach - 0.5 - 2, 125);
      expect(live().guides).toEqual({ x: null, y: null });
      release(250, 125);
      expect(onCommit).toHaveBeenCalled();
    });

    test('Alt switches the guides off', () => {
      const { begin, live, onCommit } = setup({ targetsFor });
      begin(press(150, 125), image(), 'move');
      move(248, 125, { altKey: true });
      expect(live().guides).toBeNull();
      release(248, 125);
      expect(onCommit.mock.calls[0][1].x).toBeCloseTo(198);
    });

    test('asks for the guides of the block that moves', () => {
      const spy = jest.fn(targetsFor);
      const { begin } = setup({ targetsFor: spy });
      const edit = image();
      begin(press(150, 125), edit, 'move');
      expect(spy).toHaveBeenCalledWith(edit);
    });

    test('resizing and rotating ask for none', () => {
      const spy = jest.fn(targetsFor);
      const { begin } = setup({ targetsFor: spy });
      begin(press(200, 150), image(), 'resize', 'se');
      begin(press(150, 76), image(), 'rotate');
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

describe('resizing', () => {
  test('an image keeps its proportions when a corner is dragged', () => {
    const { begin, live, onCommit } = setup();
    begin(press(200, 150), image(), 'resize', 'se');
    move(250, 175);
    expect(live()).toMatchObject({ id: 'i', kind: 'resize' });
    release(250, 175);
    const patch = onCommit.mock.calls[0][1];
    expect(patch.x).toBeCloseTo(100);
    expect(patch.y).toBeCloseTo(100);
    expect(patch.width).toBeCloseTo(150);
    expect(patch.height).toBeCloseTo(75);
  });

  test('Shift lets a corner change the proportions', () => {
    const { begin, onCommit } = setup();
    begin(press(200, 150), image(), 'resize', 'se');
    move(300, 160, { shiftKey: true });
    release(300, 160);
    const patch = onCommit.mock.calls[0][1];
    expect(patch.width).toBeCloseTo(200);
    expect(patch.height).toBeCloseTo(60);
  });

  test('the width of a block of text is changed from its side', () => {
    const { begin, onCommit } = setup();
    begin(press(150, 195), text(), 'resize', 'e');
    move(220, 195);
    release(220, 195);
    expect(onCommit.mock.calls[0][1]).toEqual({ boxWidth: 120 });
  });

  test('a side that text cannot be resized from does nothing', () => {
    const { begin, live, onCommit } = setup();
    begin(press(125, 182), text(), 'resize', 'n');
    move(125, 150);
    expect(live()).toBeNull();
    release(125, 150);
    expect(onCommit).not.toHaveBeenCalled();
  });

  test('a handle follows the pointer from the first pixel', () => {
    const { begin, live } = setup();
    begin(press(200, 150), image(), 'resize', 'se');
    move(201, 150);
    expect(live()).not.toBeNull();
  });

  test('a handle grabbed off its corner does not make the frame jump', () => {
    const { begin, onCommit } = setup();
    // Grabbed 4 units right of and below the corner (200, 150), then dragged by (+50, +25).
    begin(press(204, 154), image(), 'resize', 'se');
    move(254, 179);
    release(254, 179);
    const patch = onCommit.mock.calls[0][1];
    expect(patch.width).toBeCloseTo(150);
    expect(patch.height).toBeCloseTo(75);
  });
});

describe('rotating', () => {
  const centre = { x: 150, y: 125 };
  const around = (degrees, distance = 100) => ({
    x: centre.x + distance * Math.sin((degrees * Math.PI) / 180),
    y: centre.y - distance * Math.cos((degrees * Math.PI) / 180),
  });

  test('turns an image about its middle, without a jump when the handle is grabbed', () => {
    const { begin, live, onCommit } = setup();
    // The handle is above the image and the pointer is a little to the side of it.
    const start = around(10);
    begin(press(start.x, start.y), image(), 'rotate');
    const to = around(100);
    move(to.x, to.y);
    expect(live()).toMatchObject({ id: 'i', kind: 'rotate', patch: { rotation: 90 }, angle: 90 });
    release(to.x, to.y);
    expect(onCommit.mock.calls[0][1]).toEqual({ rotation: 90 });
  });

  test('keeps the other angles as they are and sticks to the diagonals when it is close', () => {
    const { begin, live } = setup();
    const start = around(0);
    begin(press(start.x, start.y), image(), 'rotate');
    let to = around(20);
    move(to.x, to.y);
    // jsdom rounds pointer positions to whole pixels, so the angle is only approximately what was asked for.
    expect(live().angle).toBeCloseTo(20, 0);
    to = around(43);
    move(to.x, to.y);
    expect(live().angle).toBe(45);
  });

  test('Shift turns in steps', () => {
    const { begin, live } = setup();
    const start = around(0);
    begin(press(start.x, start.y), image(), 'rotate');
    const to = around(20);
    move(to.x, to.y, { shiftKey: true });
    expect(live().angle).toBe(15);
    expect(ROTATION_STEP).toBe(15);
  });

  test('goes on from the angle the image has', () => {
    const { begin, live } = setup();
    const start = around(30);
    begin(press(start.x, start.y), image({ rotation: 30 }), 'rotate');
    const to = around(50);
    move(to.x, to.y);
    expect(live().angle).toBeCloseTo(50, 0);
  });

  test('a block of text turns about its middle: its origin moves', () => {
    const { begin, onCommit } = setup();
    const block = text();
    // The block is 50 wide and 22 high: its middle is at (125, 193).
    const start = { x: 125, y: 193 - 11 - 24 };
    begin(press(start.x, start.y), block, 'rotate');
    move(225, 193);
    release(225, 193);
    const patch = onCommit.mock.calls[0][1];
    expect(patch.rotation).toBe(90);
    // The middle of the turned block is where it was.
    expect(patch.textX).toBeCloseTo(125 - 7);
    expect(patch.baseline).toBeCloseTo(193 - 25);
  });
});

describe('the hook', () => {
  test('uses the latest function to commit', () => {
    const first = jest.fn();
    const second = jest.fn();
    const rendered = renderHook(({ onCommit }) => useFrameGestures({ pageSize, scale: SCALE, pointFor, onCommit }), {
      initialProps: { onCommit: first },
    });
    act(() => rendered.result.current.begin(press(150, 125), image(), 'move'));
    rendered.rerender({ onCommit: second });
    move(190, 145);
    release(190, 145);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('a gesture that is running when the component goes away is dropped', () => {
    const { begin, unmount, onCommit } = setup();
    begin(press(150, 125), image(), 'move');
    move(190, 145);
    unmount();
    release(190, 145);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
