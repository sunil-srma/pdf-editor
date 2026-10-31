// Geometry helpers for the text PDF.js finds on a page. Everything here is expressed in "page units":
// the page as displayed (after rotation and cropping) at scale 1, with the origin at the top-left corner.
// That is also the coordinate system the backend expects, so numbers can travel between the two unchanged.

const ASCENT_RANGE = [0.7, 1.05];
const DESCENT_RANGE = [0.1, 0.4];
const DEFAULT_ASCENT = 0.8;
const DEFAULT_DESCENT = 0.2;
// Added around a text box so that anti-aliased glyph edges are covered as well.
const COVER_PADDING = 1;
// Items rotated by more than this (radians) cannot be replaced; they can still be erased or highlighted.
const HORIZONTAL_TOLERANCE = 0.02;

/** Same as PDF.js `Util.transform`: the product of two affine matrices [a b c d e f]. */
export function multiply(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function clamp(value, [min, max], fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/**
 * Converts PDF.js text content into items with page-unit geometry.
 *
 * @param textContent result of `page.getTextContent()`
 * @param transform   `viewport.transform` of the page viewport at scale 1
 * @returns {Array<{index:number,str:string,x:number,baseline:number,width:number,fontSize:number,
 *   ascent:number,descent:number,angle:number,horizontal:boolean,fontName:string,cssFamily:string,
 *   box:{x:number,y:number,width:number,height:number}}>}
 *   `x`/`baseline` is the start of the text on its baseline; `box` is the area to cover when replacing it.
 */
export function buildTextItems(textContent, transform) {
  const styles = textContent.styles || {};
  const items = [];

  textContent.items.forEach((item, index) => {
    // Marked-content entries have no string; blank items give nothing to click on.
    if (typeof item.str !== 'string' || item.str.trim() === '' || !Array.isArray(item.transform)) {
      return;
    }
    const m = multiply(transform, item.transform);
    const fontSize = Math.hypot(m[2], m[3]);
    const run = Math.hypot(m[0], m[1]);
    if (!(fontSize > 0) || !(run > 0) || !(item.width > 0)) {
      return;
    }

    const style = styles[item.fontName] || {};
    const ascent = clamp(style.ascent, ASCENT_RANGE, DEFAULT_ASCENT);
    const descent = clamp(Math.abs(style.descent), DESCENT_RANGE, DEFAULT_DESCENT);
    const angle = Math.atan2(m[1], m[0]);

    // Unit vectors along the baseline and "up" in page units; the box is their span, so it is
    // correct for rotated text, too.
    const along = [m[0] / run, m[1] / run];
    const up = [m[2] / fontSize, m[3] / fontSize];
    const xs = [];
    const ys = [];
    [[0, -descent * fontSize], [item.width, -descent * fontSize],
      [item.width, ascent * fontSize], [0, ascent * fontSize]].forEach(([t, s]) => {
      xs.push(m[4] + t * along[0] + s * up[0]);
      ys.push(m[5] + t * along[1] + s * up[1]);
    });
    const left = Math.min(...xs);
    const top = Math.min(...ys);

    items.push({
      index,
      str: item.str,
      x: m[4],
      baseline: m[5],
      width: item.width,
      fontSize,
      ascent,
      descent,
      angle,
      horizontal: Math.abs(angle) < HORIZONTAL_TOLERANCE,
      fontName: item.fontName,
      cssFamily: style.fontFamily || '',
      box: {
        x: left - COVER_PADDING,
        y: top - COVER_PADDING,
        width: Math.max(...xs) - left + 2 * COVER_PADDING,
        height: Math.max(...ys) - top + 2 * COVER_PADDING,
      },
    });
  });

  return items;
}

export function containsPoint(box, x, y, tolerance = 0) {
  return x >= box.x - tolerance && x <= box.x + box.width + tolerance
    && y >= box.y - tolerance && y <= box.y + box.height + tolerance;
}

/** Fraction (0..1) of box `a` that is covered by box `b`. */
export function coveredFraction(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0 || a.width <= 0 || a.height <= 0) {
    return 0;
  }
  return (width * height) / (a.width * a.height);
}

/** True when a replace/erase edit has already hidden most of `box`. */
export function isCoveredByEdit(box, edits) {
  return edits.some((edit) => (edit.type === 'replace' || edit.type === 'erase')
    && coveredFraction(box, edit) > 0.5);
}

/** The smallest unhidden item under the point, so that nested boxes pick the most specific one. */
export function findItemAt(items, x, y, isHidden = () => false, tolerance = 1) {
  let best = null;
  let bestArea = Infinity;
  for (const item of items) {
    if (!containsPoint(item.box, x, y, tolerance) || isHidden(item)) {
      continue;
    }
    const area = item.box.width * item.box.height;
    if (area < bestArea) {
      best = item;
      bestArea = area;
    }
  }
  return best;
}

/** Normalises a drag between two points into a box with positive size. */
export function boxBetween(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function toHex(r, g, b) {
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

// How different a pixel must be from the background to count as ink.
const INK_THRESHOLD = 96;

/**
 * Estimates the background and the text colour in an area of rendered pixels.
 *
 * @param image ImageData-like object `{data, width, height}`
 * @returns {{background:string, foreground:string|null}} hex colours; `foreground` is null when no
 *   pixel differs enough from the background
 */
export function estimateColors(image) {
  const { data, width, height } = image;
  if (!data || width < 1 || height < 1) {
    return { background: '#ffffff', foreground: null };
  }

  // The background is the most common colour along the border of the area, which is expected to
  // contain no text.
  const buckets = new Map();
  const addBorderPixel = (x, y) => {
    const i = (y * width + x) * 4;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += data[i];
    bucket.g += data[i + 1];
    bucket.b += data[i + 2];
    buckets.set(key, bucket);
  };
  for (let x = 0; x < width; x++) {
    addBorderPixel(x, 0);
    addBorderPixel(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    addBorderPixel(0, y);
    addBorderPixel(width - 1, y);
  }
  let dominant = null;
  buckets.forEach((bucket) => {
    if (!dominant || bucket.count > dominant.count) {
      dominant = bucket;
    }
  });
  const bg = [dominant.r / dominant.count, dominant.g / dominant.count, dominant.b / dominant.count];

  // The text colour is the pixel that differs most from the background; anti-aliased edge pixels are
  // always closer to the background than the solid core of a glyph.
  let farthest = 0;
  let ink = null;
  for (let i = 0; i < width * height * 4; i += 4) {
    const distance = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
    if (distance > farthest) {
      farthest = distance;
      ink = [data[i], data[i + 1], data[i + 2]];
    }
  }

  return {
    background: toHex(...bg),
    foreground: ink && farthest >= INK_THRESHOLD ? toHex(...ink) : null,
  };
}

/**
 * Reads pixels through a small scratch canvas. Calling `getImageData` repeatedly on the page canvas itself
 * forces a slow GPU read-back each time (and makes browsers warn about it).
 */
let scratchCanvas = null;

export function readPixels(canvas, x, y, width, height) {
  scratchCanvas = scratchCanvas || document.createElement('canvas');
  scratchCanvas.width = width;
  scratchCanvas.height = height;
  const context = scratchCanvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(canvas, x, y, width, height, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

/**
 * Samples colours from a rendered canvas.
 *
 * @param canvas     the canvas holding the rendered page
 * @param box        area in page units
 * @param pixelRatio canvas pixels per page unit
 * @param margin     extra pixels around the box so that the border contains background only
 * @param read       reads `(canvas, x, y, width, height)` pixels; replaceable for testing
 * @returns {{background:string, foreground:string|null}|null} null if the canvas cannot be read
 */
export function sampleColors(canvas, box, pixelRatio, margin = 2, read = readPixels) {
  try {
    const x0 = Math.max(0, Math.floor(box.x * pixelRatio) - margin);
    const y0 = Math.max(0, Math.floor(box.y * pixelRatio) - margin);
    const x1 = Math.min(canvas.width, Math.ceil((box.x + box.width) * pixelRatio) + margin);
    const y1 = Math.min(canvas.height, Math.ceil((box.y + box.height) * pixelRatio) + margin);
    if (x1 - x0 < 2 || y1 - y0 < 2) {
      return null;
    }
    return estimateColors(read(canvas, x0, y0, x1 - x0, y1 - y0));
  } catch (error) {
    return null;
  }
}
