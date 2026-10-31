// Fonts shared by the live preview, the inline editor and the text layout.
//
// The catalogue comes from the backend (GET /api/fonts). The backend also draws the text into the PDF with the
// same font files, so the preview and the export use the same glyphs. Until the catalogue has arrived (or when it
// cannot be loaded) the three standard families are offered, which the backend always has.

export const FONTS_URL = '/api/fonts';
export const FONT_FILES_URL = '/api/fonts/files/';

// Distance between baselines as a multiple of the font size. Mirrors the backend (PdfEditService).
export const DEFAULT_LINE_HEIGHT = 1.2;
export const MIN_LINE_HEIGHT = 0.5;
export const MAX_LINE_HEIGHT = 5;

// Text decorations, in multiples of the font size, as the backend draws them: the offset is measured from the
// baseline towards the next line.
export const UNDERLINE_OFFSET = 0.13;
export const STRIKETHROUGH_OFFSET = -0.28;
export const DECORATION_THICKNESS = 0.065;

export const CATEGORY_LABELS = {
  sans: 'Sans-serif',
  serif: 'Serif',
  mono: 'Monospace',
  handwriting: 'Handwriting',
};

export const FALLBACK_FAMILIES = [
  {
    id: 'sans', label: 'Helvetica', category: 'sans', standard: true, webFamily: null, faces: {},
    css: 'Helvetica, Arial, "Liberation Sans", "Nimbus Sans", sans-serif',
  },
  {
    id: 'serif', label: 'Times', category: 'serif', standard: true, webFamily: null, faces: {},
    css: '"Times New Roman", Times, "Liberation Serif", "Nimbus Roman", serif',
  },
  {
    id: 'mono', label: 'Courier', category: 'mono', standard: true, webFamily: null, faces: {},
    css: '"Courier New", Courier, "Liberation Mono", "Nimbus Mono PS", monospace',
  },
];

const FALLBACK_METRICS = {
  sans: { ascent: 0.905, descent: 0.212 },
  serif: { ascent: 0.891, descent: 0.216 },
  mono: { ascent: 0.833, descent: 0.3 },
  handwriting: { ascent: 0.95, descent: 0.3 },
};

// --- Catalogue ------------------------------------------------------------------------------------------

let families = FALLBACK_FAMILIES;
let epoch = 0;
let notifying = false;
const listeners = new Set();
const registeredFaces = new Set();
const loadingFaces = new Map();

export const getFamilies = () => families;

/** Changes whenever the catalogue or a font file arrives; layouts measured earlier are then out of date. */
export const fontEpoch = () => epoch;

/** @returns {Function} unsubscribes */
export function subscribeToFonts(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const widthCache = new Map();
const metricsCache = new Map();

// Several fonts usually arrive together, which should cause a single update.
function fontsChanged() {
  if (notifying) {
    return;
  }
  notifying = true;
  Promise.resolve().then(() => {
    notifying = false;
    epoch += 1;
    widthCache.clear();
    metricsCache.clear();
    listeners.forEach((listener) => listener());
  });
}

/** Replaces the catalogue. The standard families are always kept, first. */
export function setFamilies(list) {
  const ids = new Set(list.map((family) => family.id));
  families = [...FALLBACK_FAMILIES.filter((family) => !ids.has(family.id)), ...list];
  fontsChanged();
}

/**
 * Validates the body of GET /api/fonts.
 *
 * @returns the families, or null when the body does not look like a catalogue
 */
export function parseCatalogue(body) {
  if (!body || !Array.isArray(body.families)) {
    return null;
  }
  const parsed = body.families
    .filter((family) => family && typeof family.id === 'string' && typeof family.label === 'string' && typeof family.css === 'string')
    .map((family) => ({
      id: family.id,
      label: family.label,
      category: CATEGORY_LABELS[family.category] ? family.category : 'sans',
      standard: Boolean(family.standard),
      webFamily: typeof family.webFamily === 'string' ? family.webFamily : null,
      css: family.css,
      faces: Object.fromEntries(
        Object.entries(family.faces && typeof family.faces === 'object' ? family.faces : {})
          .filter(([, file]) => typeof file === 'string'),
      ),
    }));
  return parsed.length > 0 ? parsed : null;
}

function registerFaces(list) {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
    return;
  }
  list.forEach((family) => {
    if (!family.webFamily) {
      return;
    }
    Object.entries(family.faces).forEach(([style, file]) => {
      const key = `${family.webFamily}|${style}`;
      if (registeredFaces.has(key)) {
        return;
      }
      registeredFaces.add(key);
      const face = new FontFace(family.webFamily, `url("${FONT_FILES_URL}${encodeURIComponent(file)}")`, {
        weight: style.startsWith('bold') ? '700' : '400',
        style: /italic$/i.test(style) ? 'italic' : 'normal',
      });
      document.fonts.add(face);
    });
  });
}

/**
 * Fetches the catalogue from the backend and registers its fonts with the browser. The font files themselves
 * are downloaded when they are first needed. Without a catalogue the standard families keep working.
 *
 * @returns {Promise<boolean>} whether the catalogue was loaded
 */
export async function loadFontCatalogue(fetchImpl = (...args) => window.fetch(...args)) {
  try {
    const response = await fetchImpl(FONTS_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      return false;
    }
    const parsed = parseCatalogue(await response.json());
    if (!parsed) {
      return false;
    }
    registerFaces(parsed);
    setFamilies(parsed);
    return true;
  } catch (error) {
    return false;
  }
}

export function findFamily(id) {
  return families.find((family) => family.id === id) || families[0];
}

export const cssFamily = (id) => findFamily(id).css;

/** The families by category, in the order of the catalogue. Empty categories are left out. */
export function groupedFamilies() {
  return Object.keys(CATEGORY_LABELS)
    .map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      families: families.filter((family) => family.category === category),
    }))
    .filter((group) => group.families.length > 0);
}

/** Whether the family has a bold face and an italic face of its own. */
export function familySupports(id) {
  const family = findFamily(id);
  if (family.standard) {
    return { bold: true, italic: true };
  }
  return { bold: Boolean(family.faces.bold), italic: Boolean(family.faces.italic) };
}

/**
 * The weight and slant that are really drawn for a style. This mirrors how the backend picks a face
 * (FontFamily.faceFile): a face the family lacks is replaced by the closest one, never faked.
 */
export function effectiveStyle({ fontFamily, bold, italic }) {
  const family = findFamily(fontFamily);
  const wantBold = Boolean(bold);
  const wantItalic = Boolean(italic);
  if (family.standard) {
    return { bold: wantBold, italic: wantItalic };
  }
  const has = (face) => Boolean(family.faces[face]);
  if (wantBold && wantItalic) {
    if (has('boldItalic')) {
      return { bold: true, italic: true };
    }
    if (has('bold')) {
      return { bold: true, italic: false };
    }
    return has('italic') ? { bold: false, italic: true } : { bold: false, italic: false };
  }
  if (wantBold) {
    return { bold: has('bold'), italic: false };
  }
  return { bold: false, italic: wantItalic && has('italic') };
}

/** The style without the bold and italic flags that its family cannot show. */
export function constrainStyle(style) {
  const supports = familySupports(style.fontFamily);
  return { ...style, bold: Boolean(style.bold) && supports.bold, italic: Boolean(style.italic) && supports.italic };
}

/** CSS `font` shorthand for a style ({fontFamily, bold, italic}) at the given size in pixels. */
export function fontShorthand(style, sizePx) {
  const { bold, italic } = effectiveStyle(style);
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${sizePx}px ${cssFamily(style.fontFamily)}`;
}

/**
 * CSS properties that make text look like the PDF text: the drawn weight and slant, and no kerning or
 * ligatures, which the backend does not apply either.
 */
export function typeface(style) {
  const { bold, italic } = effectiveStyle(style);
  return {
    fontFamily: cssFamily(style.fontFamily),
    fontWeight: bold ? 700 : 400,
    fontStyle: italic ? 'italic' : 'normal',
    fontKerning: 'none',
    fontVariantLigatures: 'none',
    textRendering: 'geometricPrecision',
  };
}

// --- Loading and measuring ------------------------------------------------------------------------------

/** Starts downloading the font file of a style, unless it is there already. The epoch changes when it arrives. */
export function preloadFace(style, sample = 'Ag') {
  if (typeof document === 'undefined' || !document.fonts || typeof document.fonts.check !== 'function') {
    return;
  }
  const font = fontShorthand(style, 16);
  try {
    if (document.fonts.check(font, sample) || loadingFaces.has(font)) {
      return;
    }
    const loading = document.fonts.load(font, sample)
      .catch(() => {})
      .then(() => {
        loadingFaces.delete(font);
        fontsChanged();
      });
    loadingFaces.set(font, loading);
  } catch (error) {
    // An unusable font description: there is nothing to wait for.
  }
}

let measuringContext;
let measuringFont = '';
const REFERENCE_SIZE = 100;
const MAX_CACHED_WIDTHS = 6000;

function context() {
  if (measuringContext === undefined) {
    try {
      measuringContext = document.createElement('canvas').getContext('2d') || null;
    } catch (error) {
      measuringContext = null;
    }
  }
  return measuringContext;
}

function prepare(ctx, font) {
  if (measuringFont !== font) {
    ctx.font = font;
    // Like the backend, measure without kerning and at exact (not hinted) advances.
    ctx.fontKerning = 'none';
    ctx.textRendering = 'geometricPrecision';
    measuringFont = font;
  }
}

/** Width of a single line of text, in the same unit as `size`. */
export function textWidth(text, style, size) {
  if (text === '') {
    return 0;
  }
  const ctx = context();
  if (!ctx) {
    return text.length * size * 0.55;
  }
  // Measured at a large size, where rounding is negligible, and scaled.
  const font = fontShorthand(style, REFERENCE_SIZE);
  const key = `${font}\u0000${text}`;
  let width = widthCache.get(key);
  if (width === undefined) {
    preloadFace(style, text);
    prepare(ctx, font);
    width = ctx.measureText(text).width;
    if (widthCache.size >= MAX_CACHED_WIDTHS) {
      widthCache.clear();
    }
    widthCache.set(key, width);
  }
  return (width * size) / REFERENCE_SIZE;
}

/** Ascent and descent of a font as fractions of the font size. */
export function fontMetrics(style) {
  const { bold, italic } = effectiveStyle(style);
  const key = `${style.fontFamily}|${bold}|${italic}`;
  const cached = metricsCache.get(key);
  if (cached) {
    return cached;
  }
  let metrics = FALLBACK_METRICS[findFamily(style.fontFamily).category] || FALLBACK_METRICS.sans;
  const ctx = context();
  if (ctx) {
    preloadFace(style);
    prepare(ctx, fontShorthand(style, REFERENCE_SIZE));
    const measured = ctx.measureText('Hg');
    const ascent = measured.fontBoundingBoxAscent;
    const descent = measured.fontBoundingBoxDescent;
    if (Number.isFinite(ascent) && Number.isFinite(descent) && ascent + descent > 0) {
      metrics = { ascent: ascent / REFERENCE_SIZE, descent: descent / REFERENCE_SIZE };
    }
  }
  metricsCache.set(key, metrics);
  return metrics;
}

/**
 * Distance from the top of a line box (whose height is `lineHeight * fontSize`) to its baseline, in the unit of
 * `fontSize`. The inline editor uses it to put its first baseline exactly where the PDF text is.
 */
export function firstBaselineOffset(style, fontSize, lineHeight = DEFAULT_LINE_HEIGHT) {
  const { ascent, descent } = fontMetrics(style);
  const halfLeading = (lineHeight - (ascent + descent)) / 2;
  return (halfLeading + ascent) * fontSize;
}

// --- Fonts of existing PDF text -------------------------------------------------------------------------

const MONO_NAME = /mono(?!type)|courier|consolas|menlo|typewriter|lucidaconsole|inconsolata|nimbusmon|cmtt/;
const SANS_NAME = /sans|arial|helvetica|calibri|verdana|tahoma|segoe|roboto|trebuchet|futura|univers|frutiger|myriad|nimbussan|cmss/;
const SERIF_NAME = /times|serif|georgia|garamond|palatino|minion|cambria|bookman|century|roman|nimbusrom|baskerville|caslon|didot|bodoni|charter|utopia|libertin|cm(?:r|bx|b|ti|sl|csc|mi|sy|ex)\d/;
// URW fonts call the bold weight "Medi" ("NimbusRomNo9L-Medi", "-MediItal"); a true "Medium" is not bold.
const BOLD_NAME = /bold|black|heavy|(?:^|[-_])demi|cmbx|cmb\d|-medi(?:ital)?$/;
const ITALIC_NAME = /italic|oblique|slanted|(?:regu|medi|bold|-|_)ital(?![a-z])|-(?:bold|semibold|medium|light)?it$|cm(?:ti|sl|mi)\d/;

// Fonts of the catalogue that look like (or are) a font a document may use. Metric-compatible ones keep the
// layout of the original text; the others are the closest look.
const BUNDLED_LOOKALIKES = [
  [/calibri|carlito/, 'carlito'],
  [/cambria|caladea/, 'caladea'],
  [/opensans/, 'opensans'],
  [/roboto(?!mono|slab|condensed)/, 'roboto'],
  [/montserrat/, 'montserrat'],
  [/courierprime/, 'courierprime'],
  [/dancingscript/, 'dancingscript'],
  [/comicneue|comicsans/, 'comicneue'],
];

// PDF.js only reports a generic CSS family ("serif", "sans-serif", "monospace"), and gets it wrong for many
// embedded fonts, so it is used only when the font name says nothing.
function familyOf(name, css) {
  const compact = name.replace(/[\s_-]/g, '');
  const bundled = BUNDLED_LOOKALIKES.find(([pattern, id]) => pattern.test(compact) && families.some((family) => family.id === id));
  if (bundled) {
    return bundled[1];
  }
  if (MONO_NAME.test(name)) {
    return 'mono';
  }
  if (SANS_NAME.test(name)) {
    return 'sans';
  }
  if (SERIF_NAME.test(name)) {
    return 'serif';
  }
  if (/mono/.test(css)) {
    return 'mono';
  }
  if (/sans/.test(css)) {
    return 'sans';
  }
  return /serif|times|roman/.test(css) ? 'serif' : 'sans';
}

/**
 * Guesses family, weight and slant of an existing PDF font from its name (for example
 * "ABCDEF+Arial-BoldMT" or "NimbusRomNo9L-MediItal") and, failing that, from the CSS family PDF.js reports.
 */
export function detectFontStyle({ cssFamily: css = '', fontName = '', bold = false, italic = false } = {}) {
  const name = String(fontName).replace(/^[A-Z]{6}\+/, '').toLowerCase();
  return constrainStyle({
    fontFamily: familyOf(name, String(css).toLowerCase()),
    bold: Boolean(bold) || BOLD_NAME.test(name),
    italic: Boolean(italic) || ITALIC_NAME.test(name),
  });
}
