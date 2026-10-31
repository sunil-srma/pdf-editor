import {
  blockFrame,
  breakPieces,
  caretIndexAt,
  caretIndexAtPoint,
  fontSizeOf,
  layoutText,
  lineHeightOf,
  lineStarts,
  originForFrame,
  wrapParagraph,
  wrapText,
  wrappedText,
} from './textLayout';
import { fontEpoch, setFamilies } from './fonts';
import { frameContains } from './geometry';

// Every character is 10 wide.
const measure = (text) => text.length * 10;

const flushFonts = () => new Promise((resolve) => { setTimeout(resolve, 0); });

afterEach(async () => {
  setFamilies([]);
  await flushFonts();
});

describe('breakPieces', () => {
  test.each([
    ['hello world', ['hello ', 'world']],
    ['  hello   world ', ['  ', 'hello   ', 'world ']],
    ['well-known fact', ['well-', 'known ', 'fact']],
    ['e-mail', ['e-', 'mail']],
    ['a - b', ['a ', '- ', 'b']],
    ['10-20', ['10-20']],
    ['-5', ['-5']],
    ['word', ['word']],
    ['', []],
  ])('%j', (paragraph, expected) => {
    expect(breakPieces(paragraph)).toEqual(expected);
  });

  test('a tab is a space', () => {
    expect(breakPieces('a\tb')).toEqual(['a\t', 'b']);
  });
});

describe('wrapParagraph', () => {
  test('does not wrap without a width, but loses the spaces at the end', () => {
    expect(wrapParagraph('a very long line   ', null, measure)).toEqual(['a very long line']);
  });

  test('breaks at spaces', () => {
    expect(wrapParagraph('aaa bbb ccc', 70, measure)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapParagraph('aaa bbb ccc', 60, measure)).toEqual(['aaa', 'bbb', 'ccc']);
    expect(wrapParagraph('aaa bbb ccc', 110, measure)).toEqual(['aaa bbb ccc']);
  });

  test('the spaces at the end of a line may stick out of the box', () => {
    expect(wrapParagraph('aaa   bbb', 30, measure)).toEqual(['aaa', 'bbb']);
  });

  test('breaks after an inner hyphen', () => {
    expect(wrapParagraph('well-known', 60, measure)).toEqual(['well-', 'known']);
    expect(wrapParagraph('10-20-30', 40, measure)).toEqual(['10-2', '0-30']);
  });

  test('breaks a word that is wider than the box between characters', () => {
    expect(wrapParagraph('abcdefghij', 40, measure)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapParagraph('ab abcdefghij', 40, measure)).toEqual(['ab', 'abcd', 'efgh', 'ij']);
  });

  test('keeps going when the box is narrower than a character', () => {
    expect(wrapParagraph('abc', 5, measure)).toEqual(['a', 'b', 'c']);
  });

  test('keeps the spaces at the start of a paragraph', () => {
    expect(wrapParagraph('  ab', 100, measure)).toEqual(['  ab']);
  });

  test('an empty paragraph is an empty line', () => {
    expect(wrapParagraph('', 100, measure)).toEqual(['']);
    expect(wrapParagraph('   ', 100, measure)).toEqual(['']);
  });

  test('does not break characters that are made of several code units', () => {
    expect(wrapParagraph('😀😀😀😀', 20, (text) => Array.from(text).length * 10)).toEqual(['😀😀', '😀😀']);
  });
});

describe('wrapText', () => {
  test('keeps the lines the user made, blank ones too', () => {
    expect(wrapText('a\n\nb', 100, measure)).toEqual(['a', '', 'b']);
    expect(wrapText('a\n\nb', null, measure)).toEqual(['a', '', 'b']);
    expect(wrapText('', null, measure)).toEqual(['']);
  });

  test('wraps every paragraph on its own', () => {
    expect(wrapText('aaa bbb\nccc ddd', 40, measure)).toEqual(['aaa', 'bbb', 'ccc', 'ddd']);
  });
});

describe('style values', () => {
  test('line height stays inside what the backend accepts', () => {
    expect(lineHeightOf({})).toBe(1.2);
    expect(lineHeightOf({ lineHeight: 2 })).toBe(2);
    expect(lineHeightOf({ lineHeight: 0 })).toBe(1.2);
    expect(lineHeightOf({ lineHeight: -3 })).toBe(1.2);
    expect(lineHeightOf({ lineHeight: 'x' })).toBe(1.2);
    expect(lineHeightOf({ lineHeight: 0.1 })).toBe(0.5);
    expect(lineHeightOf({ lineHeight: 99 })).toBe(5);
  });

  test('font size has a fallback', () => {
    expect(fontSizeOf({ fontSize: 20 })).toBe(20);
    expect(fontSizeOf({})).toBe(14);
    expect(fontSizeOf({ fontSize: 0 })).toBe(14);
    expect(fontSizeOf({ fontSize: 'big' })).toBe(14);
  });
});

// In the test environment text is measured as 0.5 em per character, ascent is 0.9 em and descent 0.2 em.
describe('layoutText', () => {
  const edit = (patch = {}) => ({
    text: 'abcd', textX: 100, baseline: 200, fontSize: 10, fontFamily: 'sans', ...patch,
  });

  test('a block without a width is as wide as its longest line', () => {
    const layout = layoutText(edit({ text: 'abcd\nab' }));
    expect(layout.lines).toEqual(['abcd', 'ab']);
    expect(layout.widths).toEqual([20, 10]);
    expect(layout.width).toBe(20);
    expect(layout.boxWidth).toBeNull();
  });

  test('a tab is four spaces, as the server draws it', () => {
    const layout = layoutText(edit({ text: 'a\tb' }));
    expect(layout.lines).toEqual(['a    b']);
    expect(layout.width).toBe(30);
  });

  test('has the height of its lines', () => {
    const one = layoutText(edit());
    expect(one.ascent).toBeCloseTo(9);
    expect(one.descent).toBeCloseTo(2);
    expect(one.pitch).toBeCloseTo(12);
    expect(one.height).toBeCloseTo(11);

    const three = layoutText(edit({ text: 'a\nb\nc' }));
    expect(three.height).toBeCloseTo(9 + 2 * 12 + 2);
  });

  test('the line height factor sets the distance between lines', () => {
    const layout = layoutText(edit({ text: 'a\nb', lineHeight: 2 }));
    expect(layout.pitch).toBeCloseTo(20);
    expect(layout.height).toBeCloseTo(9 + 20 + 2);
  });

  test('a width wraps the text and is the width of the block', () => {
    const layout = layoutText(edit({ text: 'aaaa bbbb', boxWidth: 25 }));
    expect(layout.lines).toEqual(['aaaa', 'bbbb']);
    expect(layout.width).toBe(25);
    expect(layout.boxWidth).toBe(25);
  });

  test('an unusable width means no width', () => {
    expect(layoutText(edit({ boxWidth: 0 })).boxWidth).toBeNull();
    expect(layoutText(edit({ boxWidth: -5 })).boxWidth).toBeNull();
    expect(layoutText(edit({ boxWidth: null })).boxWidth).toBeNull();
    expect(layoutText(edit({ boxWidth: 'wide' })).boxWidth).toBeNull();
  });

  test('lines are aligned inside the block', () => {
    const base = { text: 'abcd\nab', boxWidth: 40 };
    expect(layoutText(edit({ ...base })).offsets).toEqual([0, 0]);
    expect(layoutText(edit({ ...base, align: 'left' })).offsets).toEqual([0, 0]);
    expect(layoutText(edit({ ...base, align: 'center' })).offsets).toEqual([10, 15]);
    expect(layoutText(edit({ ...base, align: 'right' })).offsets).toEqual([20, 30]);
  });

  test('the widest line is the box of a block without a width', () => {
    expect(layoutText(edit({ text: 'abcd\nab', align: 'right' })).offsets).toEqual([0, 10]);
    expect(layoutText(edit({ text: 'abcd\nab', align: 'center' })).offsets).toEqual([0, 5]);
  });

  test('an unknown alignment is left', () => {
    const layout = layoutText(edit({ boxWidth: 40, align: 'justify' }));
    expect(layout.align).toBe('left');
    expect(layout.offsets).toEqual([0]);
  });

  test('line breaks of any kind separate lines', () => {
    expect(layoutText(edit({ text: 'a\r\nb\rc' })).lines).toEqual(['a', 'b', 'c']);
  });

  test('text that is missing is empty', () => {
    const layout = layoutText(edit({ text: undefined }));
    expect(layout.lines).toEqual(['']);
    expect(layout.width).toBe(0);
  });

  test('wrappedText is what is sent to the server', () => {
    expect(wrappedText(edit({ text: 'aaaa bbbb   \ncc', boxWidth: 25 }))).toBe('aaaa\nbbbb\ncc');
  });

  test('is worked out once for an edit', () => {
    const subject = edit();
    expect(layoutText(subject)).toBe(layoutText(subject));
    expect(layoutText(edit())).not.toBe(layoutText(subject));
  });

  test('is worked out again after fonts arrived', async () => {
    const subject = edit();
    const before = layoutText(subject);
    const epoch = fontEpoch();
    setFamilies([]);
    await flushFonts();
    expect(fontEpoch()).toBeGreaterThan(epoch);
    const after = layoutText(subject);
    expect(after).not.toBe(before);
    expect(after).toEqual(before);
  });
});

describe('blockFrame', () => {
  const edit = (patch = {}) => ({
    text: 'abcd', textX: 100, baseline: 200, fontSize: 10, fontFamily: 'sans', ...patch,
  });

  test('is the box around the text', () => {
    const frame = blockFrame(edit());
    expect(frame.width).toBeCloseTo(20);
    expect(frame.height).toBeCloseTo(11);
    expect(frame.cx).toBeCloseTo(110);
    expect(frame.cy).toBeCloseTo(196.5);
    expect(frame.rotation).toBe(0);
  });

  test('covers the glyphs, from the ascent to the descent', () => {
    const frame = blockFrame(edit());
    expect(frameContains(frame, 100.5, 191.5)).toBe(true);
    expect(frameContains(frame, 119.5, 201.5)).toBe(true);
    expect(frameContains(frame, 100.5, 190)).toBe(false);
    expect(frameContains(frame, 100.5, 203)).toBe(false);
    expect(frameContains(frame, 99, 196)).toBe(false);
    expect(frameContains(frame, 121, 196)).toBe(false);
  });

  test('spans the box of a block with a width', () => {
    const frame = blockFrame(edit({ boxWidth: 80 }));
    expect(frame.width).toBeCloseTo(80);
    expect(frame.cx).toBeCloseTo(140);
  });

  test('turns around the start of the first baseline', () => {
    const frame = blockFrame(edit({ rotation: 90 }));
    expect(frame.rotation).toBe(90);
    expect(frame.cx).toBeCloseTo(103.5);
    expect(frame.cy).toBeCloseTo(210);
    // The origin of the text is the left end of the baseline, wherever the block is turned to.
    expect(frameContains(frame, 100, 200.5)).toBe(true);
    expect(frameContains(frame, 100, 199.5)).toBe(false);
  });

  test('turned upside down', () => {
    const frame = blockFrame(edit({ rotation: 180 }));
    expect(frame.cx).toBeCloseTo(90);
    expect(frame.cy).toBeCloseTo(203.5);
  });

  test('an empty block can still be pointed at', () => {
    const frame = blockFrame(edit({ text: '' }));
    expect(frame.width).toBeCloseTo(5);
    expect(frame.height).toBeCloseTo(11);
  });

  test.each([0, 30, 90, 137, 180, 270])('originForFrame is the inverse at %d degrees', (rotation) => {
    const subject = edit({ text: 'ab\nabcd', rotation, textX: 77, baseline: 133 });
    const layout = layoutText(subject);
    const frame = blockFrame(subject, layout);
    const origin = originForFrame(layout, frame);
    expect(origin.textX).toBeCloseTo(77);
    expect(origin.baseline).toBeCloseTo(133);
  });

  test('originForFrame places the block where its frame is', () => {
    const subject = edit({ rotation: 45 });
    const layout = layoutText(subject);
    const frame = { ...blockFrame(subject, layout), cx: 300, cy: 400 };
    const moved = { ...subject, ...originForFrame(layout, frame) };
    const after = blockFrame(moved);
    expect(after.cx).toBeCloseTo(300);
    expect(after.cy).toBeCloseTo(400);
  });
});

describe('caretIndexAt', () => {
  const widthOf = (part) => part.length * 10;

  test('is the boundary closest to the offset', () => {
    expect(caretIndexAt('abcd', 0, widthOf)).toBe(0);
    expect(caretIndexAt('abcd', -5, widthOf)).toBe(0);
    expect(caretIndexAt('abcd', 4, widthOf)).toBe(0);
    expect(caretIndexAt('abcd', 6, widthOf)).toBe(1);
    expect(caretIndexAt('abcd', 14, widthOf)).toBe(1);
    expect(caretIndexAt('abcd', 16, widthOf)).toBe(2);
    expect(caretIndexAt('abcd', 100, widthOf)).toBe(4);
    expect(caretIndexAt('', 10, widthOf)).toBe(0);
  });
});

describe('lineStarts', () => {
  test('finds where each line starts in the text', () => {
    expect(lineStarts('aaa bbb\nccc', ['aaa', 'bbb', 'ccc'])).toEqual([0, 4, 8]);
    expect(lineStarts('a\n\nb', ['a', '', 'b'])).toEqual([0, 2, 3]);
    expect(lineStarts('abcdefghij', ['abcd', 'efgh', 'ij'])).toEqual([0, 4, 8]);
    expect(lineStarts('ab   \ncd', ['ab', 'cd'])).toEqual([0, 6]);
    expect(lineStarts('a\r\nb', ['a', 'b'])).toEqual([0, 2]);
    expect(lineStarts('   x', ['', 'x'])).toEqual([0, 3]);
  });

  test('agrees with the layout of a text', () => {
    const edit = { text: 'one two  three\n\nfour five-six', fontSize: 10, fontFamily: 'sans', boxWidth: 30 };
    const { lines } = layoutText(edit);
    const starts = lineStarts(edit.text, lines);
    lines.forEach((line, i) => {
      expect(edit.text.slice(starts[i], starts[i] + line.length)).toBe(line);
    });
  });
});

describe('caretIndexAtPoint', () => {
  // 5 wide characters; the glyphs of the first line span y from -9 to 2 and the lines are 12 apart.
  const wrapped = { text: 'abcd efgh', fontSize: 10, fontFamily: 'sans', boxWidth: 25 };

  test('finds the character in the line under the point', () => {
    expect(caretIndexAtPoint(wrapped, { x: 0, y: -3 })).toBe(0);
    expect(caretIndexAtPoint(wrapped, { x: 11, y: -3 })).toBe(2);
    expect(caretIndexAtPoint(wrapped, { x: 11, y: 9 })).toBe(7);
    expect(caretIndexAtPoint(wrapped, { x: 500, y: 9 })).toBe(9);
  });

  test('stays on the first and the last line', () => {
    expect(caretIndexAtPoint(wrapped, { x: 11, y: -50 })).toBe(2);
    expect(caretIndexAtPoint(wrapped, { x: 11, y: 500 })).toBe(7);
  });

  test('picks the line that is closest in the gap between two', () => {
    expect(caretIndexAtPoint(wrapped, { x: 11, y: 2 })).toBe(2);
    expect(caretIndexAtPoint(wrapped, { x: 11, y: 3 })).toBe(7);
  });

  test('allows for the alignment of the lines', () => {
    const centred = { text: 'ab\nabcd', fontSize: 10, fontFamily: 'sans', align: 'center' };
    expect(caretIndexAtPoint(centred, { x: 5.5, y: -3 })).toBe(0);
    expect(caretIndexAtPoint(centred, { x: 10.5, y: -3 })).toBe(1);
    expect(caretIndexAtPoint(centred, { x: 100, y: -3 })).toBe(2);
    expect(caretIndexAtPoint(centred, { x: 5, y: 9 })).toBe(4);
  });
});
