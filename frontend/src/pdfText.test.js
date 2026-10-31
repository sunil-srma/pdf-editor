import {
  boxBetween, buildTextItems, containsPoint, coveredFraction, estimateColors,
  findItemAt, isCoveredByEdit, multiply, readPixels, sampleColors, toHex,
} from './pdfText';

// Viewport transform of an unrotated 612x792 page at scale 1, and of the same page rotated by 90 degrees.
const UPRIGHT = [1, 0, 0, -1, 0, 792];
const ROTATED_90 = [0, 1, 1, 0, 0, 0];

const content = (items, styles = {}) => ({ items, styles });
const word = (patch = {}) => ({
  str: 'Hello', transform: [12, 0, 0, 12, 72, 700], width: 30, height: 12, fontName: 'f1', ...patch,
});

describe('multiply', () => {
  test('identity leaves a matrix unchanged', () => {
    const m = [2, 0, 0, 3, 5, 7];
    expect(multiply([1, 0, 0, 1, 0, 0], m)).toEqual(m);
    expect(multiply(m, [1, 0, 0, 1, 0, 0])).toEqual(m);
  });

  test('applies the second matrix first, then the first', () => {
    expect(multiply([1, 0, 0, 1, 10, 20], [2, 0, 0, 2, 1, 1])).toEqual([2, 0, 0, 2, 11, 21]);
  });
});

describe('buildTextItems', () => {
  test('puts text of an upright page into top-left page units', () => {
    const [item] = buildTextItems(
      content([word()], { f1: { ascent: 0.9, descent: -0.2, fontFamily: 'serif' } }),
      UPRIGHT,
    );
    expect(item).toMatchObject({
      index: 0, str: 'Hello', x: 72, baseline: 92, width: 30, fontSize: 12, horizontal: true, cssFamily: 'serif',
    });
    expect(item.box.x).toBeCloseTo(71);
    expect(item.box.y).toBeCloseTo(80.2);
    expect(item.box.width).toBeCloseTo(32);
    expect(item.box.height).toBeCloseTo(15.2);
  });

  test('keeps the index of the item in the PDF.js list', () => {
    const items = buildTextItems(content([word({ str: ' ' }), word({ str: 'second' })]), UPRIGHT);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ index: 1, str: 'second' });
  });

  test('skips marked-content entries, blanks and zero-width items', () => {
    const items = buildTextItems(content([
      { type: 'beginMarkedContent', id: 'x' },
      word({ str: '' }),
      word({ width: 0 }),
      word({ transform: [0, 0, 0, 0, 1, 1] }),
      word({ str: 'kept' }),
    ]), UPRIGHT);
    expect(items.map((item) => item.str)).toEqual(['kept']);
  });

  test('falls back to typical font proportions for unknown or odd fonts', () => {
    const [plain] = buildTextItems(content([word()]), UPRIGHT);
    expect(plain.ascent).toBeCloseTo(0.8);
    expect(plain.descent).toBeCloseTo(0.2);
    const [odd] = buildTextItems(content([word()], { f1: { ascent: 5, descent: -9 } }), UPRIGHT);
    expect(odd.ascent).toBeCloseTo(1.05);
    expect(odd.descent).toBeCloseTo(0.4);
  });

  test('follows the rotation of the page and marks sideways text as not editable', () => {
    const [item] = buildTextItems(content([word({ transform: [12, 0, 0, 12, 100, 200] })]), ROTATED_90);
    expect(item.horizontal).toBe(false);
    expect(item.x).toBeCloseTo(200);
    expect(item.baseline).toBeCloseTo(100);
    // The 30-unit-wide text now runs downwards; the line is 12 units (0.8 + 0.2 of the font size) wide.
    expect(item.box.x).toBeCloseTo(200 - 2.4 - 1);
    expect(item.box.y).toBeCloseTo(100 - 1);
    expect(item.box.width).toBeCloseTo(12 + 2);
    expect(item.box.height).toBeCloseTo(30 + 2);
  });

  test('text that is rotated on an upright page is not horizontal either', () => {
    const [item] = buildTextItems(content([word({ transform: [0, 12, -12, 0, 100, 200] })]), UPRIGHT);
    expect(item.horizontal).toBe(false);
  });
});

describe('hit testing', () => {
  const box = { x: 10, y: 10, width: 20, height: 10 };

  test('containsPoint honours the tolerance', () => {
    expect(containsPoint(box, 10, 10)).toBe(true);
    expect(containsPoint(box, 30, 20)).toBe(true);
    expect(containsPoint(box, 31, 20)).toBe(false);
    expect(containsPoint(box, 31, 20, 1)).toBe(true);
  });

  test('coveredFraction measures how much of the first box the second hides', () => {
    expect(coveredFraction(box, { x: 0, y: 0, width: 100, height: 100 })).toBe(1);
    expect(coveredFraction(box, { x: 20, y: 10, width: 100, height: 100 })).toBeCloseTo(0.5);
    expect(coveredFraction(box, { x: 50, y: 50, width: 5, height: 5 })).toBe(0);
    expect(coveredFraction({ x: 0, y: 0, width: 0, height: 5 }, box)).toBe(0);
  });

  test('replace and erase edits hide text, highlights and added text do not', () => {
    const cover = { x: 0, y: 0, width: 100, height: 100, page: 1 };
    expect(isCoveredByEdit(box, [{ ...cover, type: 'replace' }])).toBe(true);
    expect(isCoveredByEdit(box, [{ ...cover, type: 'erase' }])).toBe(true);
    expect(isCoveredByEdit(box, [{ ...cover, type: 'highlight' }, { ...cover, type: 'addText' }])).toBe(false);
    expect(isCoveredByEdit(box, [{ x: 25, y: 10, width: 100, height: 10, type: 'erase' }])).toBe(false);
  });

  test('findItemAt picks the smallest visible item', () => {
    const items = [
      { index: 0, box: { x: 0, y: 0, width: 100, height: 100 } },
      { index: 1, box: { x: 40, y: 40, width: 10, height: 10 } },
    ];
    expect(findItemAt(items, 45, 45).index).toBe(1);
    expect(findItemAt(items, 5, 5).index).toBe(0);
    expect(findItemAt(items, 45, 45, (item) => item.index === 1).index).toBe(0);
    expect(findItemAt(items, 500, 500)).toBeNull();
    expect(findItemAt(items, 101, 50)).not.toBeNull(); // within the default 1-unit tolerance
  });

  test('boxBetween normalises a drag in any direction', () => {
    expect(boxBetween({ x: 30, y: 40 }, { x: 10, y: 5 })).toEqual({ x: 10, y: 5, width: 20, height: 35 });
  });
});

describe('colours', () => {
  function image(width, height, background, paint) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const color = (paint && paint(x, y)) || background;
        data.set([...color, 255], (y * width + x) * 4);
      }
    }
    return { data, width, height };
  }

  test('toHex', () => {
    expect(toHex(255, 0, 16)).toBe('#ff0010');
    expect(toHex(0.4, 254.6, 7)).toBe('#00ff07');
  });

  test('finds the background on the border and the ink inside', () => {
    const colors = estimateColors(image(20, 10, [250, 250, 250], (x, y) => (
      x >= 6 && x < 12 && y >= 3 && y < 7 ? [10, 20, 30] : null)));
    expect(colors).toEqual({ background: '#fafafa', foreground: '#0a141e' });
  });

  test('anti-aliased edges do not hide the solid colour of the ink', () => {
    const colors = estimateColors(image(20, 10, [255, 255, 255], (x, y) => {
      if (x === 10 && y === 5) {
        return [200, 0, 0];
      }
      return x >= 8 && x < 13 && y >= 3 && y < 8 ? [240, 200, 200] : null;
    }));
    expect(colors.foreground).toBe('#c80000');
  });

  test('a dark background is recognised too', () => {
    const colors = estimateColors(image(20, 10, [20, 20, 40], (x) => (x === 10 ? [255, 255, 255] : null)));
    expect(colors.background).toBe('#141428');
    expect(colors.foreground).toBe('#ffffff');
  });

  test('without ink there is no foreground', () => {
    expect(estimateColors(image(10, 10, [255, 255, 240]))).toEqual({ background: '#fffff0', foreground: null });
  });

  test('faint differences are not ink', () => {
    const colors = estimateColors(image(10, 10, [255, 255, 255], (x, y) => (x === 5 && y === 5 ? [240, 240, 240] : null)));
    expect(colors.foreground).toBeNull();
  });

  test('unreadable images give white', () => {
    expect(estimateColors({ data: null, width: 0, height: 0 })).toEqual({ background: '#ffffff', foreground: null });
  });

  describe('sampleColors', () => {
    const canvas = (width, height) => ({ width, height });
    const whiteReader = () => jest.fn((source, x, y, w, h) => image(w, h, [255, 255, 255]));

    test('reads the box plus a margin, in canvas pixels', () => {
      const read = whiteReader();
      const source = canvas(1000, 1000);
      const result = sampleColors(source, { x: 10, y: 10, width: 20, height: 5 }, 2, 2, read);
      expect(read).toHaveBeenCalledWith(source, 18, 18, 44, 14);
      expect(result.background).toBe('#ffffff');
    });

    test('stays inside the canvas', () => {
      const read = whiteReader();
      const source = canvas(100, 50);
      sampleColors(source, { x: 0, y: 0, width: 500, height: 500 }, 1, 2, read);
      expect(read).toHaveBeenCalledWith(source, 0, 0, 100, 50);
    });

    test('gives null for empty areas and unreadable canvases', () => {
      const read = jest.fn();
      expect(sampleColors(canvas(100, 100), { x: 500, y: 500, width: 5, height: 5 }, 1, 2, read)).toBeNull();
      expect(read).not.toHaveBeenCalled();
      const tainted = () => { throw new Error('tainted'); };
      expect(sampleColors(canvas(100, 100), { x: 1, y: 1, width: 5, height: 5 }, 1, 2, tainted)).toBeNull();
    });

    test('readPixels copies the area to a scratch canvas that is flagged for frequent reads', () => {
      const pixels = image(4, 3, [10, 20, 30]);
      const context = { drawImage: jest.fn(), getImageData: jest.fn(() => pixels) };
      const getContext = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
      const source = canvas(100, 100);
      try {
        expect(readPixels(source, 5, 6, 4, 3)).toBe(pixels);
        expect(getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
        expect(context.drawImage).toHaveBeenCalledWith(source, 5, 6, 4, 3, 0, 0, 4, 3);
        expect(context.getImageData).toHaveBeenCalledWith(0, 0, 4, 3);
      } finally {
        getContext.mockRestore();
      }
    });
  });
});
