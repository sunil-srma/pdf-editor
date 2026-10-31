import {
  BLOCK_MIME, PASTE_OFFSET, clipOfBlock, clipOfEdit, clipOfSelection, clipOfText, createClipEntry, nextPasteSteps,
  parseClip, pasteEdit, serializeClip,
} from './clipboard';
import { MAX_TEXT_LENGTH, TEXT_STYLE_KEYS } from './editModel';
import { editFrame } from './frames';
import { frameBounds } from './geometry';

// In tests every character is half the font size wide, the ascent is 90% and the descent 20% of it.
const pageSize = { width: 612, height: 792 };

const styled = {
  fontFamily: 'opensans',
  fontSize: 20,
  bold: true,
  italic: true,
  underline: true,
  strikethrough: true,
  color: '#aa5500',
  align: 'center',
  lineHeight: 1.6,
  opacity: 0.6,
};

const textEdit = (extra = {}) => ({
  id: 'a', type: 'addText', page: 1, text: 'Hello', textX: 100, baseline: 200, rotation: 0, boxWidth: null, ...styled, ...extra,
});

const imageEdit = (extra = {}) => ({
  id: 'i', type: 'addImage', page: 1, x: 100, y: 120, width: 100, height: 50, rotation: 0, opacity: 1, imageUrl: 'data:image/png;base64,QUJD', ...extra,
});

const bounds = (edit) => frameBounds(editFrame(edit));

describe('copying', () => {
  test('a text block is copied with everything that gives it its look', () => {
    const clip = clipOfEdit(textEdit({ rotation: 30, boxWidth: 120 }));
    expect(clip).toEqual({
      kind: 'text', page: 1, text: 'Hello', textX: 100, baseline: 200, rotation: 30, boxWidth: 120, ...styled,
    });
  });

  test('a replacement is copied as the text it shows, not as the original it covers', () => {
    const clip = clipOfEdit(textEdit({
      type: 'replace', x: 90, y: 180, width: 40, height: 24, backgroundColor: '#ffffff', sourceIndex: 3,
    }));
    expect(Object.keys(clip).sort()).toEqual(
      ['baseline', 'boxWidth', 'kind', 'page', 'rotation', 'text', 'textX', ...TEXT_STYLE_KEYS].sort(),
    );
  });

  test('an image is copied with its size, turn and opacity', () => {
    expect(clipOfEdit(imageEdit({ rotation: 45, opacity: 0.5 }))).toEqual({
      kind: 'image', page: 1, x: 100, y: 120, width: 100, height: 50, rotation: 45, opacity: 0.5, imageUrl: 'data:image/png;base64,QUJD',
    });
    const plain = imageEdit();
    delete plain.rotation;
    delete plain.opacity;
    expect(clipOfEdit(plain)).toMatchObject({ rotation: 0, opacity: 1 });
  });

  test('erased and highlighted regions are not copied', () => {
    expect(clipOfEdit({ id: 'e', type: 'erase', page: 1, x: 1, y: 2, width: 3, height: 4 })).toBeNull();
    expect(clipOfEdit({ id: 'h', type: 'highlight', page: 1, x: 1, y: 2, width: 3, height: 4 })).toBeNull();
  });

  test('a block being edited is copied with the text it shows', () => {
    const session = { mode: 'existing', page: 2, text: 'old', textX: 5, baseline: 9, rotation: 10, boxWidth: null, ...styled };
    const clip = clipOfBlock(session, 'new text\r\n');
    expect(clip).toMatchObject({ kind: 'text', page: 2, text: 'new text', textX: 5, baseline: 9, rotation: 10, ...styled });
    expect(clip).not.toHaveProperty('mode');
  });

  test('a selection of text has the style of its block, but is a plain block', () => {
    const session = { page: 2, text: 'Hello world', textX: 5, baseline: 9, rotation: 40, boxWidth: 80, ...styled };
    const clip = clipOfSelection(session, 'world');
    expect(clip).toMatchObject({
      kind: 'text', fragment: true, page: 2, text: 'world', rotation: 0, boxWidth: null, ...styled,
    });
  });

  test('text without a block gets a block whose top left corner is where it is put', () => {
    const clip = clipOfText('Some text', { fontSize: 20, color: '#ff0000' }, { x: 30, y: 40 });
    expect(clip).toMatchObject({
      kind: 'text', text: 'Some text', fontSize: 20, color: '#ff0000', textX: 30, rotation: 0, boxWidth: null,
    });
    // The ascent is 90% of the font size.
    expect(clip.baseline).toBeCloseTo(58);
    expect(clip.fontFamily).toBe('sans');
  });
});

describe('the clipboard format', () => {
  test('a text block survives the round trip', () => {
    const clip = clipOfEdit(textEdit({ rotation: 33, boxWidth: 99, text: 'two\nlines' }));
    expect(parseClip(serializeClip(clip))).toEqual(clip);
  });

  test('a fragment stays a fragment, a block does not become one', () => {
    const fragment = clipOfSelection({ page: 1, text: 'abc', textX: 1, baseline: 2, ...styled }, 'b');
    expect(parseClip(serializeClip(fragment))).toEqual(fragment);
    const block = clipOfEdit(textEdit());
    expect(parseClip(serializeClip(block))).not.toHaveProperty('fragment');
  });

  test('images are not put on the system clipboard', () => {
    expect(serializeClip(clipOfEdit(imageEdit()))).toBeNull();
  });

  test('the type of the clipboard data is a custom one', () => {
    expect(BLOCK_MIME).toMatch(/^application\/x-/);
  });

  test.each([
    ['text that is not JSON', 'not json'],
    ['JSON that is not an object', '42'],
    ['null', 'null'],
    ['no version', JSON.stringify({ kind: 'text', text: 'a', textX: 1, baseline: 2 })],
    ['another version', JSON.stringify({ version: 2, kind: 'text', text: 'a', textX: 1, baseline: 2 })],
    ['another kind', JSON.stringify({ version: 1, kind: 'image', text: 'a', textX: 1, baseline: 2 })],
    ['a text that is not text', JSON.stringify({ version: 1, kind: 'text', text: 5, textX: 1, baseline: 2 })],
    ['no place', JSON.stringify({ version: 1, kind: 'text', text: 'a' })],
    ['a place that is not a number', JSON.stringify({ version: 1, kind: 'text', text: 'a', textX: '1', baseline: 2 })],
    ['a place that is out of reach', JSON.stringify({ version: 1, kind: 'text', text: 'a', textX: 1e9, baseline: 2 })],
    ['a width that is out of reach', JSON.stringify({ version: 1, kind: 'text', text: 'a', textX: 1, baseline: 2, boxWidth: 1e9 })],
    ['a width that is not a number', JSON.stringify({ version: 1, kind: 'text', text: 'a', textX: 1, baseline: 2, boxWidth: 'wide' })],
    ['far too much text', JSON.stringify({ version: 1, kind: 'text', text: 'a'.repeat(MAX_TEXT_LENGTH + 1), textX: 1, baseline: 2 })],
  ])('rejects %s', (name, json) => {
    expect(parseClip(json)).toBeNull();
  });

  test('accepts a block that has no width, and makes whatever it holds valid', () => {
    const clip = parseClip(JSON.stringify({
      version: 1,
      kind: 'text',
      text: 'a\r\n',
      textX: 1,
      baseline: 2,
      boxWidth: null,
      fontSize: 5000,
      color: 'red',
      align: 'justify',
      opacity: 7,
      rotation: 450,
      evil: 'dropped',
    }));
    expect(clip).toMatchObject({
      kind: 'text', page: 0, text: 'a', boxWidth: null, fontSize: 300, color: '#000000', align: 'left', opacity: 1, rotation: 90,
    });
    expect(clip).not.toHaveProperty('evil');
  });
});

describe('where pasted blocks go', () => {
  test('the first paste on the page of the original is offset from it, the next ones further', () => {
    const entry = createClipEntry(clipOfEdit(textEdit({ page: 1 })));
    expect([nextPasteSteps(entry, 1), nextPasteSteps(entry, 1), nextPasteSteps(entry, 1)]).toEqual([1, 2, 3]);
  });

  test('the first paste on another page takes the place of the original', () => {
    const entry = createClipEntry(clipOfEdit(textEdit({ page: 1 })));
    expect([nextPasteSteps(entry, 2), nextPasteSteps(entry, 2)]).toEqual([0, 1]);
    expect(nextPasteSteps(entry, 1)).toBe(1);
  });

  test('text that has no page is pasted where it was meant to go', () => {
    const entry = createClipEntry(clipOfText('x', {}, { x: 1, y: 2 }));
    expect(nextPasteSteps(entry, 1)).toBe(0);
    expect(nextPasteSteps(entry, 1)).toBe(1);
  });
});

describe('pasteEdit', () => {
  test('makes a new text block with the same style, text, turn and width', () => {
    const clip = clipOfEdit(textEdit({ rotation: 20, boxWidth: 150, text: 'a b c' }));
    const pasted = pasteEdit(clip, { page: 3, pageSize, steps: 0 });
    expect(pasted).toMatchObject({
      type: 'addText', page: 3, text: 'a b c', textX: 100, baseline: 200, rotation: 20, boxWidth: 150, ...styled,
    });
    expect(pasted.id).toEqual(expect.any(String));
    expect(pasted).not.toHaveProperty('kind');
    expect(pasted).not.toHaveProperty('fragment');
  });

  test('every paste has its own id', () => {
    const clip = clipOfEdit(textEdit());
    const first = pasteEdit(clip, { page: 1, pageSize, steps: 1 });
    const second = pasteEdit(clip, { page: 1, pageSize, steps: 2 });
    expect(first.id).not.toBe(second.id);
    expect(first.id).not.toBe('a');
  });

  test('a replacement is pasted as added text, without what it covered', () => {
    const clip = clipOfEdit(textEdit({
      type: 'replace', x: 90, y: 180, width: 40, height: 24, backgroundColor: '#ffffff', sourceIndex: 3,
    }));
    const pasted = pasteEdit(clip, { page: 1, pageSize, steps: 1 });
    expect(pasted.type).toBe('addText');
    ['x', 'y', 'width', 'height', 'backgroundColor', 'sourceIndex'].forEach((key) => expect(pasted).not.toHaveProperty(key));
  });

  test('is offset by the number of steps', () => {
    const clip = clipOfEdit(textEdit());
    expect(pasteEdit(clip, { page: 1, pageSize, steps: 0 })).toMatchObject({ textX: 100, baseline: 200 });
    expect(pasteEdit(clip, { page: 1, pageSize, steps: 1 })).toMatchObject({ textX: 100 + PASTE_OFFSET, baseline: 200 + PASTE_OFFSET });
    expect(pasteEdit(clip, { page: 1, pageSize, steps: 3 })).toMatchObject({ textX: 100 + 3 * PASTE_OFFSET, baseline: 200 + 3 * PASTE_OFFSET });
  });

  test('leaves the copy as it was', () => {
    const clip = clipOfEdit(textEdit());
    const before = JSON.parse(JSON.stringify(clip));
    pasteEdit(clip, { page: 2, pageSize, steps: 2 });
    expect(clip).toEqual(before);
  });

  test('a block at the right or the bottom of the page is brought back onto it', () => {
    // 'Hello' is 50 wide and 22 high, from 18 above its baseline to 4 below it.
    const right = pasteEdit(clipOfEdit(textEdit({ textX: 580 })), { page: 1, pageSize, steps: 1 });
    expect(right.textX).toBeCloseTo(562);
    expect(right.baseline).toBeCloseTo(212);

    const bottom = pasteEdit(clipOfEdit(textEdit({ baseline: 780 })), { page: 1, pageSize, steps: 1 });
    expect(bottom.baseline).toBeCloseTo(788);
    expect(bottom.textX).toBeCloseTo(112);
  });

  test('a block beyond the left or the top of the page is brought back onto it', () => {
    const pasted = pasteEdit(clipOfEdit(textEdit({ textX: -20, baseline: 5 })), { page: 1, pageSize, steps: 0 });
    expect(pasted.textX).toBeCloseTo(0);
    expect(pasted.baseline).toBeCloseTo(18);
  });

  test('a block that is larger than the page starts at its left and top', () => {
    const wide = pasteEdit(clipOfEdit(textEdit({ text: 'a'.repeat(100), textX: 50 })), { page: 1, pageSize, steps: 1 });
    expect(wide.textX).toBeCloseTo(0);
    const tall = pasteEdit(
      clipOfEdit(textEdit({ text: Array(60).fill('x').join('\n'), baseline: 300 })),
      { page: 1, pageSize, steps: 0 },
    );
    expect(bounds(tall).y).toBeCloseTo(0);
  });

  test('a turned block is kept on the page by the space it takes up', () => {
    [90, 45, 180, 270].forEach((rotation) => {
      const pasted = pasteEdit(clipOfEdit(textEdit({ rotation, textX: 2, baseline: 790 })), { page: 1, pageSize, steps: 1 });
      const box = bounds(pasted);
      expect(box.x).toBeGreaterThanOrEqual(-1e-6);
      expect(box.y).toBeGreaterThanOrEqual(-1e-6);
      expect(box.x + box.width).toBeLessThanOrEqual(pageSize.width + 1e-6);
      expect(box.y + box.height).toBeLessThanOrEqual(pageSize.height + 1e-6);
      expect(pasted.rotation).toBe(rotation);
    });
  });

  test('an image is pasted with its picture, size, turn and opacity', () => {
    const clip = clipOfEdit(imageEdit({ rotation: 30, opacity: 0.4 }));
    const pasted = pasteEdit(clip, { page: 2, pageSize, steps: 2 });
    expect(pasted).toMatchObject({
      type: 'addImage', page: 2, x: 100 + 2 * PASTE_OFFSET, y: 120 + 2 * PASTE_OFFSET, width: 100, height: 50,
      rotation: 30, opacity: 0.4, imageUrl: 'data:image/png;base64,QUJD',
    });
    expect(pasted.id).toEqual(expect.any(String));
    expect(pasted).not.toHaveProperty('kind');
  });

  test('an image is brought back onto the page', () => {
    const plain = pasteEdit(clipOfEdit(imageEdit({ x: 560 })), { page: 1, pageSize, steps: 0 });
    expect(plain.x).toBeCloseTo(512);
    const turned = pasteEdit(clipOfEdit(imageEdit({ x: 560, rotation: 90 })), { page: 1, pageSize, steps: 0 });
    const box = bounds(turned);
    expect(box.x + box.width).toBeCloseTo(pageSize.width);
    expect(turned.x).toBeCloseTo(537);
  });
});
