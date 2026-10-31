// Copying and pasting blocks. A copy keeps everything about a block, so that what is pasted looks the same: for text
// its words, style, rotation and width; for an image its picture, size, rotation and opacity.
import {
  MAX_TEXT_LENGTH, blockOf, newId, normalizeStyle,
} from './editModel';
import { editFrame, isTextType, moveEditPatch } from './frames';
import { frameBounds } from './geometry';
import { layoutText } from './textLayout';

// The format of a block on the system clipboard, so that a text block can be pasted into another tab as well.
export const BLOCK_MIME = 'application/x-pdf-editor-block';
const FORMAT_VERSION = 1;
// Anything further from the page than this cannot be a real block; it would only be a damaged or hostile clipboard.
const MAX_COORDINATE = 100000;
// How far each paste of the same block lies from the one before, in page units.
export const PASTE_OFFSET = 12;

/** A copy of a text block: of an edit, or of an editing session with the text it is showing. */
export function clipOfBlock(source, text = source.text) {
  return { kind: 'text', page: source.page, ...blockOf(source, text) };
}

/** A copy of an edit, or null when the edit cannot be copied (regions). */
export function clipOfEdit(edit) {
  if (isTextType(edit)) {
    return clipOfBlock(edit);
  }
  if (edit.type === 'addImage') {
    return {
      kind: 'image',
      page: edit.page,
      x: edit.x,
      y: edit.y,
      width: edit.width,
      height: edit.height,
      rotation: edit.rotation || 0,
      opacity: edit.opacity ?? 1,
      imageUrl: edit.imageUrl,
    };
  }
  return null;
}

/**
 * A copy of some of the text of a block: it has the style of the block but not its width or rotation, so that
 * pasting it makes a plain new block that looks like the text it came from.
 */
export function clipOfSelection(source, selectedText) {
  return { ...clipOfBlock({ ...source, rotation: 0, boxWidth: null }, selectedText), fragment: true };
}

/** A new block with the given text and style whose top left corner is at `point`. */
export function clipOfText(text, style, point) {
  const block = {
    text, ...normalizeStyle(style), textX: point.x, baseline: 0, rotation: 0, boxWidth: null,
  };
  const { ascent } = layoutText(block);
  return { kind: 'text', page: 0, ...blockOf({ ...block, baseline: point.y + ascent }) };
}

/** The clip as text for the system clipboard, or null for clips that are only kept inside the editor (images). */
export function serializeClip(clip) {
  return clip.kind === 'text' ? JSON.stringify({ ...clip, version: FORMAT_VERSION }) : null;
}

const sane = (value) => Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;

/** The clip in text from the system clipboard, or null when the text is not one (or not a safe one). */
export function parseClip(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch (error) {
    return null;
  }
  if (!data || data.version !== FORMAT_VERSION || data.kind !== 'text' || typeof data.text !== 'string'
    || data.text.length > MAX_TEXT_LENGTH || !sane(data.textX) || !sane(data.baseline)
    || (data.boxWidth !== undefined && data.boxWidth !== null && !sane(data.boxWidth))) {
    return null;
  }
  const clip = { kind: 'text', page: Number.isInteger(data.page) ? data.page : 0, ...blockOf(data) };
  return data.fragment === true ? { ...clip, fragment: true } : clip;
}

/**
 * Remembers where a clip has been pasted, so that pasting it again offsets it again instead of piling the copies
 * up on one another.
 */
export function createClipEntry(clip) {
  return { clip, pasted: {} };
}

/** How many offsets from the original the next paste onto `page` is placed at. */
export function nextPasteSteps(entry, page) {
  const earlier = entry.pasted[page] || 0;
  entry.pasted[page] = earlier + 1;
  // The first paste onto the page of the original must not cover it; on other pages it can take its place.
  return earlier + (entry.clip.page === page ? 1 : 0);
}

// How far to move something from `start` to have all of it between 0 and `limit` (or its start, when it is larger).
function fit(start, size, limit) {
  if (size >= limit) {
    return -start;
  }
  return Math.min(Math.max(start, 0), limit - size) - start;
}

/**
 * A new edit made of a clip, `steps` offsets away from where the clip was taken, and moved back onto the page
 * if it would end up outside.
 */
export function pasteEdit(clip, { page, pageSize, steps = 0 }) {
  const offset = steps * PASTE_OFFSET;
  let edit;
  if (clip.kind === 'image') {
    edit = {
      id: newId(),
      type: 'addImage',
      page,
      x: clip.x + offset,
      y: clip.y + offset,
      width: clip.width,
      height: clip.height,
      rotation: clip.rotation,
      opacity: clip.opacity,
      imageUrl: clip.imageUrl,
    };
  } else {
    const { kind, page: copiedFrom, fragment, ...block } = clip;
    edit = {
      id: newId(), type: 'addText', page, ...block, textX: block.textX + offset, baseline: block.baseline + offset,
    };
  }
  const bounds = frameBounds(editFrame(edit));
  const dx = fit(bounds.x, bounds.width, pageSize.width);
  const dy = fit(bounds.y, bounds.height, pageSize.height);
  return dx === 0 && dy === 0 ? edit : { ...edit, ...moveEditPatch(edit, dx, dy) };
}
