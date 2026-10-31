import {
  DEFAULT_LINE_HEIGHT, FALLBACK_FAMILIES, FONT_FILES_URL, FONTS_URL, constrainStyle, cssFamily, detectFontStyle,
  effectiveStyle, familySupports, findFamily, firstBaselineOffset, fontEpoch, fontMetrics, fontShorthand,
  getFamilies, groupedFamilies, loadFontCatalogue, parseCatalogue, preloadFace, setFamilies, subscribeToFonts,
  textWidth, typeface,
} from './fonts';

const ALL_FACES = (prefix) => ({
  regular: `${prefix}-Regular.ttf`,
  bold: `${prefix}-Bold.ttf`,
  italic: `${prefix}-Italic.ttf`,
  boldItalic: `${prefix}-BoldItalic.ttf`,
});

// The shape GET /api/fonts answers with.
const SERVER_FAMILIES = [
  { id: 'sans', label: 'Helvetica', category: 'sans', standard: true, css: 'Helvetica, sans-serif', faces: {} },
  { id: 'serif', label: 'Times', category: 'serif', standard: true, css: 'Times, serif', faces: {} },
  { id: 'mono', label: 'Courier', category: 'mono', standard: true, css: 'Courier, monospace', faces: {} },
  {
    id: 'opensans', label: 'Open Sans', category: 'sans', standard: false, webFamily: 'pdfedit-opensans',
    css: '"pdfedit-opensans", sans-serif', faces: ALL_FACES('OpenSans'),
  },
  {
    id: 'carlito', label: 'Calibri (Carlito)', category: 'sans', standard: false, webFamily: 'pdfedit-carlito',
    css: '"pdfedit-carlito", sans-serif', faces: ALL_FACES('Carlito'),
  },
  {
    id: 'caladea', label: 'Cambria (Caladea)', category: 'serif', standard: false, webFamily: 'pdfedit-caladea',
    css: '"pdfedit-caladea", serif', faces: ALL_FACES('Caladea'),
  },
  {
    id: 'dancingscript', label: 'Dancing Script', category: 'handwriting', standard: false,
    webFamily: 'pdfedit-dancingscript', css: '"pdfedit-dancingscript", cursive',
    faces: { regular: 'DancingScript-Regular.otf', bold: 'DancingScript-Bold.otf' },
  },
];

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(async () => {
  setFamilies([]);
  await flush();
  delete document.fonts;
  delete global.FontFace;
});

describe('the catalogue', () => {
  test('offers the three standard families until the server answered', () => {
    expect(getFamilies()).toBe(FALLBACK_FAMILIES);
    expect(getFamilies().map((family) => family.id)).toEqual(['sans', 'serif', 'mono']);
    expect(getFamilies().map((family) => family.label)).toEqual(['Helvetica', 'Times', 'Courier']);
  });

  test('cssFamily and findFamily fall back to the first family for unknown ids', () => {
    expect(cssFamily('serif')).toMatch(/serif/);
    expect(cssFamily('mono')).toMatch(/monospace/);
    expect(cssFamily('whatever')).toBe(cssFamily('sans'));
    expect(findFamily(undefined).id).toBe('sans');
  });

  test('parseCatalogue keeps valid families and normalizes them', () => {
    const parsed = parseCatalogue({
      families: [
        SERVER_FAMILIES[3],
        { id: 'odd', label: 'Odd', css: 'x', category: 'strange', faces: { regular: 'a.ttf', bold: 7 } },
        { label: 'No id', css: 'x' },
        null,
        { id: 'nocss', label: 'No css' },
      ],
    });
    expect(parsed.map((family) => family.id)).toEqual(['opensans', 'odd']);
    expect(parsed[0]).toMatchObject({ webFamily: 'pdfedit-opensans', standard: false, category: 'sans' });
    // An unknown category becomes sans, and a face that is not a file name is dropped.
    expect(parsed[1]).toMatchObject({ category: 'sans', webFamily: null, faces: { regular: 'a.ttf' } });
  });

  test('parseCatalogue rejects anything that is not a catalogue', () => {
    expect(parseCatalogue(null)).toBeNull();
    expect(parseCatalogue({})).toBeNull();
    expect(parseCatalogue({ families: 'x' })).toBeNull();
    expect(parseCatalogue({ families: [] })).toBeNull();
    expect(parseCatalogue({ families: [{ id: 1 }] })).toBeNull();
  });

  test('setFamilies keeps the standard families in front', () => {
    setFamilies(SERVER_FAMILIES.slice(3));
    expect(getFamilies().map((family) => family.id)).toEqual(['sans', 'serif', 'mono', 'opensans', 'carlito', 'caladea', 'dancingscript']);
    // A catalogue that has them already does not duplicate them.
    setFamilies(SERVER_FAMILIES);
    expect(getFamilies().map((family) => family.id).filter((id) => id === 'sans')).toHaveLength(1);
  });

  test('groups the families by category', () => {
    setFamilies(SERVER_FAMILIES);
    expect(groupedFamilies().map((group) => [group.label, group.families.map((family) => family.id)])).toEqual([
      ['Sans-serif', ['sans', 'opensans', 'carlito']],
      ['Serif', ['serif', 'caladea']],
      ['Monospace', ['mono']],
      ['Handwriting', ['dancingscript']],
    ]);
  });

  test('categories without a family are left out', () => {
    expect(groupedFamilies().map((group) => group.category)).toEqual(['sans', 'serif', 'mono']);
  });

  test('the epoch changes once for a batch of changes, and listeners are told', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToFonts(listener);
    const before = fontEpoch();
    setFamilies(SERVER_FAMILIES);
    setFamilies(SERVER_FAMILIES);
    await flush();
    expect(fontEpoch()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setFamilies(SERVER_FAMILIES);
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('loading the catalogue', () => {
  const answer = (body, ok = true) => jest.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) });

  test('fetches it from the backend and offers its families', async () => {
    const fetchImpl = answer({ families: SERVER_FAMILIES });
    await expect(loadFontCatalogue(fetchImpl)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(FONTS_URL, expect.anything());
    expect(getFamilies().map((family) => family.id)).toContain('opensans');
  });

  test('registers the font files with the browser, without downloading them', async () => {
    const add = jest.fn();
    document.fonts = { add };
    const created = [];
    global.FontFace = function FontFace(family, source, descriptors) {
      created.push({ family, source, descriptors });
    };
    await loadFontCatalogue(answer({ families: SERVER_FAMILIES }));
    // 4 + 4 + 4 faces of the three full families and 2 of Dancing Script
    expect(add).toHaveBeenCalledTimes(14);
    expect(created).toContainEqual({
      family: 'pdfedit-opensans',
      source: `url("${FONT_FILES_URL}OpenSans-BoldItalic.ttf")`,
      descriptors: { weight: '700', style: 'italic' },
    });
    expect(created).toContainEqual({
      family: 'pdfedit-dancingscript',
      source: `url("${FONT_FILES_URL}DancingScript-Regular.otf")`,
      descriptors: { weight: '400', style: 'normal' },
    });
    expect(created.every((face) => face.family.startsWith('pdfedit-'))).toBe(true);

    // Loading the catalogue again does not register the same files twice.
    await loadFontCatalogue(answer({ families: SERVER_FAMILIES }));
    expect(add).toHaveBeenCalledTimes(14);
  });

  test.each([
    ['an error status', answer({}, false)],
    ['an unusable body', answer({ nothing: true })],
    ['a network error', jest.fn().mockRejectedValue(new Error('offline'))],
    ['a body that is not JSON', jest.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('bad json')) })],
  ])('keeps the standard families after %s', async (name, fetchImpl) => {
    await expect(loadFontCatalogue(fetchImpl)).resolves.toBe(false);
    expect(getFamilies().map((family) => family.id)).toEqual(['sans', 'serif', 'mono']);
  });
});

describe('weights and slants', () => {
  beforeEach(() => setFamilies(SERVER_FAMILIES));

  test('standard families can be bold and italic', () => {
    expect(familySupports('sans')).toEqual({ bold: true, italic: true });
    expect(effectiveStyle({ fontFamily: 'serif', bold: true, italic: true })).toEqual({ bold: true, italic: true });
  });

  test('a family without an italic face cannot be italic, and is never slanted artificially', () => {
    expect(familySupports('dancingscript')).toEqual({ bold: true, italic: false });
    expect(effectiveStyle({ fontFamily: 'dancingscript', bold: false, italic: true })).toEqual({ bold: false, italic: false });
    // The closest face of bold italic is bold, as on the server.
    expect(effectiveStyle({ fontFamily: 'dancingscript', bold: true, italic: true })).toEqual({ bold: true, italic: false });
    expect(effectiveStyle({ fontFamily: 'dancingscript', bold: true })).toEqual({ bold: true, italic: false });
  });

  test('a complete family shows every combination', () => {
    [[false, false], [true, false], [false, true], [true, true]].forEach(([bold, italic]) => {
      expect(effectiveStyle({ fontFamily: 'opensans', bold, italic })).toEqual({ bold, italic });
    });
  });

  test('an unknown family behaves like the first one', () => {
    expect(effectiveStyle({ fontFamily: 'nope', bold: true, italic: true })).toEqual({ bold: true, italic: true });
  });

  test('constrainStyle clears the flags a family cannot show', () => {
    expect(constrainStyle({ fontFamily: 'dancingscript', bold: true, italic: true, color: '#111' }))
      .toEqual({ fontFamily: 'dancingscript', bold: true, italic: false, color: '#111' });
    expect(constrainStyle({ fontFamily: 'sans', bold: true, italic: true }))
      .toEqual({ fontFamily: 'sans', bold: true, italic: true });
    expect(constrainStyle({ fontFamily: 'opensans' })).toEqual({ fontFamily: 'opensans', bold: false, italic: false });
  });

  test('fontShorthand combines slant, weight, size and family', () => {
    expect(fontShorthand({ fontFamily: 'sans', bold: true, italic: true }, 12)).toMatch(/^italic bold 12px /);
    expect(fontShorthand({ fontFamily: 'mono' }, 9.5)).toMatch(/^9\.5px .*monospace$/);
    expect(fontShorthand({ fontFamily: 'opensans', bold: true }, 20)).toBe('bold 20px "pdfedit-opensans", sans-serif');
  });

  test('fontShorthand asks only for faces that exist', () => {
    expect(fontShorthand({ fontFamily: 'dancingscript', italic: true }, 10)).toBe('10px "pdfedit-dancingscript", cursive');
  });

  test('typeface gives the CSS that matches the PDF text', () => {
    expect(typeface({ fontFamily: 'opensans', bold: true, italic: true })).toEqual({
      fontFamily: '"pdfedit-opensans", sans-serif',
      fontWeight: 700,
      fontStyle: 'italic',
      fontKerning: 'none',
      fontVariantLigatures: 'none',
      textRendering: 'geometricPrecision',
    });
    expect(typeface({ fontFamily: 'dancingscript', italic: true })).toMatchObject({ fontWeight: 400, fontStyle: 'normal' });
  });
});

describe('measuring', () => {
  test('measures text with the canvas', () => {
    // test canvas: half a font size per character
    expect(textWidth('abcd', { fontFamily: 'sans' }, 10)).toBe(20);
    expect(textWidth('abcd', { fontFamily: 'sans' }, 40)).toBe(80);
    expect(textWidth('', { fontFamily: 'sans' }, 40)).toBe(0);
  });

  test('fontMetrics are fractions of the font size', () => {
    const { ascent, descent } = fontMetrics({ fontFamily: 'sans', bold: false, italic: false });
    expect(ascent).toBeCloseTo(0.9);
    expect(descent).toBeCloseTo(0.2);
  });

  test('the first baseline sits where the line box puts it', () => {
    const { ascent, descent } = fontMetrics({ fontFamily: 'sans' });
    expect(firstBaselineOffset({ fontFamily: 'sans' }, 20))
      .toBeCloseTo(((DEFAULT_LINE_HEIGHT - (ascent + descent)) / 2 + ascent) * 20);
    // Taller lines add space above the first baseline, too.
    expect(firstBaselineOffset({ fontFamily: 'sans' }, 20, 2))
      .toBeCloseTo(((2 - (ascent + descent)) / 2 + ascent) * 20);
  });
});

describe('loading a font file', () => {
  const style = { fontFamily: 'opensans', bold: true };

  test('downloads a face once and updates the layouts when it has arrived', async () => {
    setFamilies(SERVER_FAMILIES);
    await flush();
    let finish;
    const load = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
    document.fonts = { check: jest.fn(() => false), load };
    const before = fontEpoch();

    preloadFace(style);
    preloadFace(style);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toMatch(/^bold 16px "pdfedit-opensans"/);

    finish([]);
    await flush();
    expect(fontEpoch()).toBe(before + 1);
  });

  test('does nothing for fonts that are there', () => {
    document.fonts = { check: jest.fn(() => true), load: jest.fn() };
    preloadFace(style);
    expect(document.fonts.load).not.toHaveBeenCalled();
  });

  test('survives a browser without the font loading API and a failing download', async () => {
    expect(() => preloadFace(style)).not.toThrow();
    document.fonts = { check: () => false, load: () => Promise.reject(new Error('404')) };
    expect(() => preloadFace(style)).not.toThrow();
    await flush();
    document.fonts = { check: () => { throw new SyntaxError('bad font'); }, load: jest.fn() };
    expect(() => preloadFace(style)).not.toThrow();
  });
});

describe('detectFontStyle', () => {
  test.each([
    ['ABCDEF+Arial-BoldMT', '', { fontFamily: 'sans', bold: true, italic: false }],
    ['Times-Italic', '', { fontFamily: 'serif', bold: false, italic: true }],
    ['XYZABC+CourierNewPS-BoldItalicMT', '', { fontFamily: 'mono', bold: true, italic: true }],
    ['g_d0_f1', 'monospace', { fontFamily: 'mono', bold: false, italic: false }],
    ['g_d0_f2', '"Times New Roman", serif', { fontFamily: 'serif', bold: false, italic: false }],
    ['g_d0_f3', 'sans-serif', { fontFamily: 'sans', bold: false, italic: false }],
    ['Calibri', 'serif', { fontFamily: 'sans', bold: false, italic: false }],
    ['Helvetica-Oblique', '', { fontFamily: 'sans', bold: false, italic: true }],
    ['', '', { fontFamily: 'sans', bold: false, italic: false }],
    // PDF.js reports "sans-serif" for these embedded fonts; the name has to win
    ['TACTGM+NimbusRomNo9L-Medi', 'sans-serif', { fontFamily: 'serif', bold: true, italic: false }],
    ['KUYGUP+NimbusRomNo9L-Regu', 'sans-serif', { fontFamily: 'serif', bold: false, italic: false }],
    ['NimbusRomNo9L-ReguItal', 'sans-serif', { fontFamily: 'serif', bold: false, italic: true }],
    ['NimbusRomNo9L-MediItal', 'sans-serif', { fontFamily: 'serif', bold: true, italic: true }],
    ['NimbusSanL-Bold', 'serif', { fontFamily: 'sans', bold: true, italic: false }],
    ['TLZTLU+CMR8', 'sans-serif', { fontFamily: 'serif', bold: false, italic: false }],
    ['CMBX12', 'sans-serif', { fontFamily: 'serif', bold: true, italic: false }],
    ['CMTI10', 'sans-serif', { fontFamily: 'serif', bold: false, italic: true }],
    ['RRLDLB+CMTT9', 'monospace', { fontFamily: 'mono', bold: false, italic: false }],
    ['CMSS10', 'serif', { fontFamily: 'sans', bold: false, italic: false }],
    ['MinionPro-BoldIt', '', { fontFamily: 'serif', bold: true, italic: true }],
    ['Roboto-Medium', '', { fontFamily: 'sans', bold: false, italic: false }],
    ['DS-Digital', '', { fontFamily: 'sans', bold: false, italic: false }],
    ['LiberationSerif-Bold', '', { fontFamily: 'serif', bold: true, italic: false }],
    ['DejaVuSansMono-Oblique', '', { fontFamily: 'mono', bold: false, italic: true }],
    ['NimbusMonL-Regu', 'sans-serif', { fontFamily: 'mono', bold: false, italic: false }],
  ])('%s / %s', (fontName, css, expected) => {
    expect(detectFontStyle({ fontName, cssFamily: css })).toEqual(expected);
  });

  test('flags reported by PDF.js are honoured', () => {
    expect(detectFontStyle({ fontName: 'Plain', bold: true, italic: true }))
      .toEqual({ fontFamily: 'sans', bold: true, italic: true });
  });

  test('works without arguments', () => {
    expect(detectFontStyle()).toEqual({ fontFamily: 'sans', bold: false, italic: false });
  });

  describe('with the bundled fonts', () => {
    beforeEach(() => setFamilies(SERVER_FAMILIES));

    test.each([
      ['ABCDEF+Calibri-Bold', '', { fontFamily: 'carlito', bold: true, italic: false }],
      ['Calibri-LightItalic', '', { fontFamily: 'carlito', bold: false, italic: true }],
      ['Cambria', 'serif', { fontFamily: 'caladea', bold: false, italic: false }],
      ['OpenSans-BoldItalic', '', { fontFamily: 'opensans', bold: true, italic: true }],
      ['Open Sans', '', { fontFamily: 'opensans', bold: false, italic: false }],
      ['DancingScript-Bold', '', { fontFamily: 'dancingscript', bold: true, italic: false }],
      // Roboto is not in this catalogue, so the name still says "sans".
      ['Roboto-Regular', '', { fontFamily: 'sans', bold: false, italic: false }],
      ['Arial-BoldMT', '', { fontFamily: 'sans', bold: true, italic: false }],
    ])('%s / %s', (fontName, css, expected) => {
      expect(detectFontStyle({ fontName, cssFamily: css })).toEqual(expected);
    });

    test('a style the family does not have is dropped', () => {
      expect(detectFontStyle({ fontName: 'DancingScript-BoldItalic' }))
        .toEqual({ fontFamily: 'dancingscript', bold: true, italic: false });
    });
  });
});
