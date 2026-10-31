// Lays out the text of an edit the way the backend draws it, so that the preview, the hit box of a block and the
// exported PDF all agree.
//
// The server never wraps text: it draws the lines it is given. A block with a width (`boxWidth`) is therefore
// wrapped here, and the lines are sent joined by "\n". A block without a width is as wide as its longest line.

import { DEFAULT_LINE_HEIGHT, MAX_LINE_HEIGHT, MIN_LINE_HEIGHT, fontEpoch, fontMetrics, textWidth } from './fonts';
import { rotateVector } from './geometry';

export const DEFAULT_FONT_SIZE = 14;
export const MIN_FONT_SIZE = 4;
export const MAX_FONT_SIZE = 300;
// A block of (almost) no text still needs a box to point at.
const MIN_FRAME_WIDTH_EM = 0.5;

const isSpace = (char) => char === ' ' || char === '\t';
const isLetter = (char) => char !== undefined && /\p{L}/u.test(char);
const isWordChar = (char) => char !== undefined && /[\p{L}\p{N}]/u.test(char);
const trimEnd = (text) => text.replace(/[ \t]+$/, '');

/** The line height factor of an edit, within the range the backend accepts. */
export function lineHeightOf(edit) {
  const value = Number(edit.lineHeight);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_LINE_HEIGHT;
  }
  return Math.min(MAX_LINE_HEIGHT, Math.max(MIN_LINE_HEIGHT, value));
}

export function fontSizeOf(edit) {
  const size = Number(edit.fontSize);
  return Number.isFinite(size) && size > 0 ? size : DEFAULT_FONT_SIZE;
}

/**
 * Cuts a paragraph into the pieces a line may end after: a word together with the spaces behind it, or the part of
 * a word up to an inner hyphen ("well-" "known"). Spaces at the start of the paragraph are a piece of their own.
 */
export function breakPieces(paragraph) {
  const pieces = [];
  let start = 0;
  for (let i = 1; i <= paragraph.length; i += 1) {
    const previous = paragraph[i - 1];
    const next = paragraph[i];
    const ends = i === paragraph.length
      || (isSpace(previous) && !isSpace(next))
      || (previous === '-' && isWordChar(paragraph[i - 2]) && isLetter(next));
    if (ends) {
      pieces.push(paragraph.slice(start, i));
      start = i;
    }
  }
  return pieces;
}

// A word that does not fit a line of its own is broken between characters.
function breakWord(piece, maxWidth, measure) {
  const word = trimEnd(piece);
  const spaces = piece.slice(word.length);
  const parts = [];
  let part = '';
  Array.from(word).forEach((char) => {
    if (part !== '' && measure(part + char) > maxWidth) {
      parts.push(part);
      part = char;
    } else {
      part += char;
    }
  });
  parts.push(part + spaces);
  return parts;
}

/**
 * Breaks a paragraph into lines that are not wider than `maxWidth`, like a browser does: at spaces and after inner
 * hyphens, and between characters inside words that are wider than a line. The spaces at the end of a line do not
 * count and are not kept. `maxWidth` of null means no wrapping.
 *
 * @param measure width of a piece of text
 */
export function wrapParagraph(paragraph, maxWidth, measure) {
  if (maxWidth === null || paragraph === '') {
    return [trimEnd(paragraph)];
  }
  const lines = [];
  let line = '';
  const fits = (text) => measure(trimEnd(text)) <= maxWidth;
  // Starts a line with a piece, breaking it up if even a line of its own is too narrow for it.
  const start = (piece) => {
    if (fits(piece)) {
      line = piece;
      return;
    }
    const parts = breakWord(piece, maxWidth, measure);
    lines.push(...parts.slice(0, -1));
    line = parts[parts.length - 1];
  };
  breakPieces(paragraph).forEach((piece) => {
    if (line === '') {
      start(piece);
    } else if (fits(line + piece)) {
      line += piece;
    } else {
      lines.push(trimEnd(line));
      start(piece);
    }
  });
  lines.push(trimEnd(line));
  return lines;
}

/** Wraps text with explicit line breaks. Every line loses the spaces at its end. */
export function wrapText(text, maxWidth, measure) {
  return text.split('\n').flatMap((paragraph) => wrapParagraph(paragraph, maxWidth, measure));
}

function compute(edit) {
  const fontSize = fontSizeOf(edit);
  const metrics = fontMetrics(edit);
  const boxWidth = Number(edit.boxWidth) > 0 ? Number(edit.boxWidth) : null;
  const measure = (text) => textWidth(text, edit, fontSize);
  // The server draws a tab as four spaces, so the text is measured that way.
  const lines = wrapText(normalizeBreaks(edit.text).replace(/\t/g, '    '), boxWidth, measure);
  const widths = lines.map(measure);
  const width = boxWidth === null ? widths.reduce((widest, w) => Math.max(widest, w), 0) : boxWidth;
  const align = edit.align === 'center' || edit.align === 'right' ? edit.align : 'left';
  const offsets = widths.map((lineWidth) => {
    if (align === 'center') {
      return (width - lineWidth) / 2;
    }
    return align === 'right' ? width - lineWidth : 0;
  });
  const ascent = metrics.ascent * fontSize;
  const descent = metrics.descent * fontSize;
  const pitch = fontSize * lineHeightOf(edit);
  return {
    lines,
    widths,
    offsets,
    width,
    height: ascent + (lines.length - 1) * pitch + descent,
    pitch,
    fontSize,
    ascent,
    descent,
    boxWidth,
    align,
  };
}

const cache = new WeakMap();

/**
 * The layout of the text of an edit (or of an editor session, which has the same text and style fields).
 * Edits are immutable, so the layout is kept with them until a font arrives.
 *
 * Positions are relative to the origin of the text, the left end of the first baseline, with x along the line
 * and y towards the next line: the block spans x from 0 to `width` and y from `-ascent` to `-ascent + height`.
 * Each line starts at `offsets[i]` and lies on `i * pitch`.
 */
export function layoutText(edit) {
  const epoch = fontEpoch();
  const cached = cache.get(edit);
  if (cached && cached.epoch === epoch) {
    return cached.layout;
  }
  const layout = compute(edit);
  cache.set(edit, { epoch, layout });
  return layout;
}

/** The text as it is sent to the server: the lines, joined. */
export const wrappedText = (edit) => layoutText(edit).lines.join('\n');

const normalizeBreaks = (text) => String(text ?? '').replace(/\r\n?/g, '\n');

/** Index of the character boundary closest to a horizontal offset from the start of the text. */
export function caretIndexAt(text, offsetX, widthOf) {
  if (!(offsetX > 0)) {
    return 0;
  }
  let previous = 0;
  for (let i = 1; i <= text.length; i += 1) {
    const width = widthOf(text.slice(0, i));
    if (width >= offsetX) {
      return offsetX - previous < width - offsetX ? i - 1 : i;
    }
    previous = width;
  }
  return text.length;
}

/** Where each of the lines of a layout starts in the text it was made from. */
export function lineStarts(text, lines) {
  const source = normalizeBreaks(text);
  const starts = [];
  let position = 0;
  lines.forEach((line) => {
    starts.push(position);
    position += line.length;
    // What was left out of the line: the spaces that ended it, and the line break.
    while (isSpace(source[position])) {
      position += 1;
    }
    if (source[position] === '\n') {
      position += 1;
    }
  });
  return starts;
}

/**
 * The index in the text of the character boundary closest to a point of the block, given in the axes of the
 * layout: x along the lines from the start of the text, y towards the next line from the first baseline.
 */
export function caretIndexAtPoint(edit, { x, y }) {
  const layout = layoutText(edit);
  const middle = (layout.descent - layout.ascent) / 2;
  const line = Math.min(layout.lines.length - 1, Math.max(0, Math.round((y - middle) / layout.pitch)));
  const inLine = caretIndexAt(
    layout.lines[line],
    x - layout.offsets[line],
    (part) => textWidth(part, edit, layout.fontSize),
  );
  return lineStarts(edit.text, layout.lines)[line] + inLine;
}

const frameWidthOf = (layout) => Math.max(layout.width, layout.fontSize * MIN_FRAME_WIDTH_EM);

/** The rotated box around the text of an edit, in page units. */
export function blockFrame(edit, layout = layoutText(edit)) {
  const rotation = edit.rotation || 0;
  const width = frameWidthOf(layout);
  const centre = rotateVector(width / 2, -layout.ascent + layout.height / 2, rotation);
  return {
    cx: edit.textX + centre.x,
    cy: edit.baseline + centre.y,
    width,
    height: layout.height,
    rotation,
  };
}

/** Where the text has to start for its block to have the given frame (see blockFrame). */
export function originForFrame(layout, frame) {
  const centre = rotateVector(frame.width / 2, -layout.ascent + layout.height / 2, frame.rotation || 0);
  return { textX: frame.cx - centre.x, baseline: frame.cy - centre.y };
}
