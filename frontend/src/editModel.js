// The edit model: every change the user makes is an "edit" kept in an undo/redo history and applied to the
// PDF in one request when the document is exported. Geometry is in page units (see pdfText.js).
//
// A text block is described by the same fields in an edit and in an editing session (the state of the inline
// editor): its text, its style (TEXT_STYLE_KEYS) and where it is (textX, baseline, rotation, boxWidth).
import { DEFAULT_LINE_HEIGHT, MAX_LINE_HEIGHT, MIN_LINE_HEIGHT } from './fonts';
import { normalizeDegrees } from './geometry';
import { MAX_FONT_SIZE, MIN_FONT_SIZE, layoutText, wrappedText } from './textLayout';

export { MAX_FONT_SIZE, MIN_FONT_SIZE };
export const MAX_HISTORY = 200;
export const MAX_TEXT_LENGTH = 20000;

export const TEXT_STYLE_KEYS = [
  'fontFamily', 'fontSize', 'bold', 'italic', 'underline', 'strikethrough', 'color', 'align', 'lineHeight', 'opacity',
];
export const DEFAULT_TEXT_STYLE = {
  fontFamily: 'sans',
  fontSize: 14,
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  color: '#000000',
  align: 'left',
  lineHeight: DEFAULT_LINE_HEIGHT,
  opacity: 1,
};
export const ALIGNMENTS = ['left', 'center', 'right'];
// The fields that make a block what it is, besides its text.
const BLOCK_KEYS = [...TEXT_STYLE_KEYS, 'textX', 'baseline', 'rotation', 'boxWidth'];

let sequence = 0;

export function newId() {
  sequence += 1;
  return `edit-${sequence}`;
}

export const initialHistory = { past: [], present: [], future: [] };

function record(state, present, coalesce) {
  const past = [...state.past, state.present];
  return {
    past: past.length > MAX_HISTORY ? past.slice(-MAX_HISTORY) : past,
    present,
    future: [],
    coalesce,
  };
}

const changesAnything = (edit, patch) => Object.keys(patch).some((key) => !Object.is(edit[key], patch[key]));

/**
 * Reducer for the edit history. `present` is the list of edits currently applied.
 * Actions: add {edit}, update {id, patch, coalesce?}, remove {id}, undo, redo, reset.
 * An update that changes nothing is not an undo step, and leaves the edit as it is. Updates that follow each
 * other with the same `coalesce` key (e.g. while a slider is dragged) are one undo step together.
 */
export function historyReducer(state, action) {
  switch (action.type) {
    case 'add':
      return record(state, [...state.present, action.edit]);
    case 'update': {
      const current = state.present.find((edit) => edit.id === action.id);
      if (!current || !changesAnything(current, action.patch)) {
        return state;
      }
      const present = state.present.map((edit) => (edit === current ? { ...edit, ...action.patch } : edit));
      if (action.coalesce && state.coalesce === action.coalesce) {
        return { ...state, present };
      }
      return record(state, present, action.coalesce);
    }
    case 'remove':
      if (!state.present.some((edit) => edit.id === action.id)) {
        return state;
      }
      return record(state, state.present.filter((edit) => edit.id !== action.id));
    case 'undo':
      if (state.past.length === 0) {
        return state;
      }
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
      };
    case 'redo':
      if (state.future.length === 0) {
        return state;
      }
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
      };
    case 'reset':
      return initialHistory;
    default:
      return state;
  }
}

// --- Style ----------------------------------------------------------------------------------------------

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** The style fields of any object, made valid: numbers within their range, flags as booleans. */
export function normalizeStyle(values = {}) {
  const size = Number(values.fontSize);
  const lineHeight = Number(values.lineHeight);
  const opacity = values.opacity === undefined || values.opacity === null ? 1 : Number(values.opacity);
  return {
    fontFamily: typeof values.fontFamily === 'string' && values.fontFamily ? values.fontFamily : DEFAULT_TEXT_STYLE.fontFamily,
    fontSize: Number.isFinite(size) && size > 0
      ? clamp(Math.round(size * 10) / 10, MIN_FONT_SIZE, MAX_FONT_SIZE)
      : DEFAULT_TEXT_STYLE.fontSize,
    bold: Boolean(values.bold),
    italic: Boolean(values.italic),
    underline: Boolean(values.underline),
    strikethrough: Boolean(values.strikethrough),
    color: HEX_COLOR.test(values.color) ? values.color.toLowerCase() : DEFAULT_TEXT_STYLE.color,
    align: ALIGNMENTS.includes(values.align) ? values.align : DEFAULT_TEXT_STYLE.align,
    lineHeight: Number.isFinite(lineHeight) && lineHeight > 0
      ? clamp(Math.round(lineHeight * 100) / 100, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT)
      : DEFAULT_TEXT_STYLE.lineHeight,
    opacity: Number.isFinite(opacity) ? clamp(Math.round(opacity * 100) / 100, 0, 1) : 1,
  };
}

export function normalizeText(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

/** The text, style and position of the block that an edit or an editing session holds, in a valid form. */
export function blockOf(source, text = source.text) {
  const boxWidth = Number(source.boxWidth);
  const rotation = Number(source.rotation);
  return {
    text: normalizeText(text),
    ...normalizeStyle(source),
    textX: source.textX,
    baseline: source.baseline,
    rotation: Number.isFinite(rotation) ? normalizeDegrees(rotation) : 0,
    boxWidth: Number.isFinite(boxWidth) && boxWidth > 0 ? boxWidth : null,
  };
}

const sameBlock = (a, b) => a.text === b.text && BLOCK_KEYS.every((key) => a[key] === b[key]);

// --- Payload --------------------------------------------------------------------------------------------

const round = (value) => Math.round(value * 100) / 100;

const TEXT_FIELDS = [
  'textX', 'baseline', 'fontSize', 'fontFamily', 'bold', 'italic', 'underline', 'strikethrough', 'color', 'align',
  'lineHeight', 'opacity', 'rotation',
];
// The fields of each edit type that the backend reads. Text and the width of a text block are added separately.
const PAYLOAD_FIELDS = {
  replace: ['x', 'y', 'width', 'height', ...TEXT_FIELDS, 'backgroundColor'],
  addText: TEXT_FIELDS,
  erase: ['x', 'y', 'width', 'height', 'backgroundColor'],
  highlight: ['x', 'y', 'width', 'height', 'color'],
  addImage: ['x', 'y', 'width', 'height', 'rotation', 'opacity'],
};

/** Builds the JSON object the backend expects for one edit. `page` is {width, height} in page units. */
export function toPayload(edit, page) {
  const payload = {
    type: edit.type,
    page: edit.page,
    pageWidth: round(page.width),
    pageHeight: round(page.height),
  };
  (PAYLOAD_FIELDS[edit.type] || []).forEach((field) => {
    const value = edit[field];
    if (value !== undefined && value !== null) {
      payload[field] = typeof value === 'number' ? round(value) : value;
    }
  });
  if (edit.type === 'replace' || edit.type === 'addText') {
    // The server does not wrap text: it draws the lines it is given, so the block is wrapped here.
    payload.text = wrappedText(edit);
    const { boxWidth } = layoutText(edit);
    if (boxWidth !== null) {
      payload.boxWidth = round(boxWidth);
    }
  }
  if (edit.type === 'addImage') {
    payload.imageBase64 = edit.imageUrl.slice(edit.imageUrl.indexOf(',') + 1);
  }
  return payload;
}

// --- Committing the inline editor -----------------------------------------------------------------------

/**
 * Decides what committing the inline editor means for the history.
 *
 * @param session  the editing session: its mode, its block (see blockOf) and the `original` block it started with
 * @param text     the text the user ended up with
 * @param existing the edit being re-edited (mode "existing"), if still present
 * @returns {null | {type:'add', edit} | {type:'update', id, patch} | {type:'remove', id}}
 *   null when nothing changed. Emptying text erases the original (replace) or deletes the edit.
 */
export function resolveCommit(session, text, existing) {
  const next = blockOf(session, text);
  const unchanged = sameBlock(next, session.original);
  const blank = next.text.trim() === '';

  if (session.mode === 'existing') {
    if (!existing || unchanged) {
      return null;
    }
    if (blank) {
      return existing.type === 'replace'
        ? { type: 'update', id: existing.id, patch: { type: 'erase' } }
        : { type: 'remove', id: existing.id };
    }
    return { type: 'update', id: existing.id, patch: next };
  }

  if (session.mode === 'replace') {
    if (unchanged) {
      return null;
    }
    const common = {
      id: newId(),
      page: session.page,
      ...session.cover,
      backgroundColor: session.background,
      sourceIndex: session.sourceIndex,
    };
    return { type: 'add', edit: blank ? { ...common, type: 'erase' } : { ...common, type: 'replace', ...next } };
  }

  // mode "new"
  if (blank) {
    return null;
  }
  return { type: 'add', edit: { id: newId(), type: 'addText', page: session.page, ...next } };
}

/**
 * The editing session that edits a text edit again, with the caret at `caretIndex` (by default at the end).
 * A replace edit keeps covering the original text while it is edited.
 */
export function sessionForEdit(edit, caretIndex) {
  const original = blockOf(edit);
  const replace = edit.type === 'replace';
  return {
    ...original,
    page: edit.page,
    mode: 'existing',
    editId: edit.id,
    cover: replace ? { x: edit.x, y: edit.y, width: edit.width, height: edit.height } : null,
    background: replace ? edit.backgroundColor : null,
    original,
    caretIndex: Math.min(Math.max(0, caretIndex ?? original.text.length), original.text.length),
  };
}

/** The style of a block (TEXT_STYLE_KEYS), for example to make it the style of new text. */
export function styleOf(block) {
  return Object.fromEntries(TEXT_STYLE_KEYS.map((key) => [key, block[key]]));
}

/**
 * Creates an image edit centred on `point`, at most 40% of the page width (and 80% of its height),
 * keeping the picture's aspect ratio and keeping it inside the page.
 */
export function createImageEdit(pending, point, page, pageSize) {
  let width = Math.min(pending.width, pageSize.width * 0.4);
  let height = (width * pending.height) / pending.width;
  if (height > pageSize.height * 0.8) {
    height = pageSize.height * 0.8;
    width = (height * pending.width) / pending.height;
  }
  return {
    id: newId(),
    type: 'addImage',
    page,
    x: Math.min(Math.max(0, point.x - width / 2), Math.max(0, pageSize.width - width)),
    y: Math.min(Math.max(0, point.y - height / 2), Math.max(0, pageSize.height - height)),
    width,
    height,
    rotation: 0,
    opacity: 1,
    imageUrl: pending.dataUrl,
  };
}
