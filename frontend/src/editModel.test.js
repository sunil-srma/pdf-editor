import {
  DEFAULT_TEXT_STYLE, MAX_HISTORY, TEXT_STYLE_KEYS, blockOf, createImageEdit, historyReducer, initialHistory,
  normalizeStyle, normalizeText, resolveCommit, toPayload,
} from './editModel';

const edit = (id, extra = {}) => ({ id, type: 'erase', page: 1, x: 0, y: 0, width: 10, height: 10, ...extra });

const run = (state, ...actions) => actions.reduce(historyReducer, state);

describe('historyReducer', () => {
  test('add, update and remove record one history entry each', () => {
    let state = run(initialHistory, { type: 'add', edit: edit('a') });
    expect(state.present).toEqual([edit('a')]);
    expect(state.past).toEqual([[]]);

    state = run(state, { type: 'update', id: 'a', patch: { x: 5 } });
    expect(state.present[0].x).toBe(5);
    expect(state.past).toHaveLength(2);

    state = run(state, { type: 'remove', id: 'a' });
    expect(state.present).toEqual([]);
    expect(state.past).toHaveLength(3);
  });

  test('undo and redo walk through the history', () => {
    const added = run(initialHistory, { type: 'add', edit: edit('a') }, { type: 'add', edit: edit('b') });

    const undone = run(added, { type: 'undo' });
    expect(undone.present.map((e) => e.id)).toEqual(['a']);
    expect(undone.future).toHaveLength(1);

    const redone = run(undone, { type: 'redo' });
    expect(redone.present).toEqual(added.present);
    expect(redone.future).toHaveLength(0);
  });

  test('a new edit after undo drops the redo history', () => {
    const state = run(
      initialHistory,
      { type: 'add', edit: edit('a') },
      { type: 'undo' },
      { type: 'add', edit: edit('b') },
    );
    expect(state.present.map((e) => e.id)).toEqual(['b']);
    expect(state.future).toEqual([]);
  });

  test('undo and redo without history change nothing', () => {
    expect(historyReducer(initialHistory, { type: 'undo' })).toBe(initialHistory);
    expect(historyReducer(initialHistory, { type: 'redo' })).toBe(initialHistory);
  });

  test('updating or removing an unknown edit is ignored', () => {
    const state = run(initialHistory, { type: 'add', edit: edit('a') });
    expect(historyReducer(state, { type: 'update', id: 'nope', patch: { x: 1 } })).toBe(state);
    expect(historyReducer(state, { type: 'remove', id: 'nope' })).toBe(state);
  });

  test('an update that changes nothing is not a history entry', () => {
    const state = run(initialHistory, { type: 'add', edit: edit('a', { x: 4 }) });
    expect(historyReducer(state, { type: 'update', id: 'a', patch: { x: 4, y: 0 } })).toBe(state);
    expect(historyReducer(state, { type: 'update', id: 'a', patch: {} })).toBe(state);
  });

  test('an update leaves the other edits as they are', () => {
    const state = run(initialHistory, { type: 'add', edit: edit('a') }, { type: 'add', edit: edit('b') });
    const next = historyReducer(state, { type: 'update', id: 'b', patch: { x: 3 } });
    expect(next.present[0]).toBe(state.present[0]);
    expect(next.present[1]).not.toBe(state.present[1]);
  });

  test('reset clears everything', () => {
    const state = run(initialHistory, { type: 'add', edit: edit('a') }, { type: 'reset' });
    expect(state).toEqual(initialHistory);
  });

  test('the history is limited', () => {
    let state = initialHistory;
    for (let i = 0; i < MAX_HISTORY + 25; i += 1) {
      state = historyReducer(state, { type: 'add', edit: edit(`e${i}`) });
    }
    expect(state.past).toHaveLength(MAX_HISTORY);
    expect(state.present).toHaveLength(MAX_HISTORY + 25);
  });
});

describe('normalizeStyle', () => {
  test('the defaults are what is used for anything missing', () => {
    expect(normalizeStyle({})).toEqual(DEFAULT_TEXT_STYLE);
    expect(normalizeStyle()).toEqual(DEFAULT_TEXT_STYLE);
    expect(Object.keys(DEFAULT_TEXT_STYLE).sort()).toEqual([...TEXT_STYLE_KEYS].sort());
  });

  test('keeps valid values', () => {
    const style = {
      fontFamily: 'opensans',
      fontSize: 18.5,
      bold: true,
      italic: true,
      underline: true,
      strikethrough: true,
      color: '#aa00bb',
      align: 'right',
      lineHeight: 1.5,
      opacity: 0.4,
    };
    expect(normalizeStyle(style)).toEqual(style);
  });

  test('ignores everything that is not a style', () => {
    expect(Object.keys(normalizeStyle({ text: 'x', textX: 4, id: 'a', fontSize: 20 })).sort())
      .toEqual([...TEXT_STYLE_KEYS].sort());
  });

  test('keeps the font size within the limits, to a tenth', () => {
    expect(normalizeStyle({ fontSize: 5000 }).fontSize).toBe(300);
    expect(normalizeStyle({ fontSize: 1 }).fontSize).toBe(4);
    expect(normalizeStyle({ fontSize: 'abc' }).fontSize).toBe(14);
    expect(normalizeStyle({ fontSize: 0 }).fontSize).toBe(14);
    expect(normalizeStyle({ fontSize: -4 }).fontSize).toBe(14);
    expect(normalizeStyle({ fontSize: 11.953 }).fontSize).toBe(12);
    expect(normalizeStyle({ fontSize: '12.34' }).fontSize).toBe(12.3);
  });

  test('keeps the line height within what the backend accepts', () => {
    expect(normalizeStyle({ lineHeight: 0.1 }).lineHeight).toBe(0.5);
    expect(normalizeStyle({ lineHeight: 99 }).lineHeight).toBe(5);
    expect(normalizeStyle({ lineHeight: 0 }).lineHeight).toBe(1.2);
    expect(normalizeStyle({ lineHeight: 'x' }).lineHeight).toBe(1.2);
    expect(normalizeStyle({ lineHeight: 1.234 }).lineHeight).toBe(1.23);
  });

  test('keeps opacity between 0 and 1', () => {
    expect(normalizeStyle({ opacity: 0 }).opacity).toBe(0);
    expect(normalizeStyle({ opacity: -1 }).opacity).toBe(0);
    expect(normalizeStyle({ opacity: 7 }).opacity).toBe(1);
    expect(normalizeStyle({ opacity: null }).opacity).toBe(1);
    expect(normalizeStyle({ opacity: 'x' }).opacity).toBe(1);
    expect(normalizeStyle({ opacity: 0.456 }).opacity).toBe(0.46);
  });

  test('accepts only known alignments and six digit colours', () => {
    expect(normalizeStyle({ align: 'justify' }).align).toBe('left');
    expect(normalizeStyle({ align: 'center' }).align).toBe('center');
    expect(normalizeStyle({ color: 'red' }).color).toBe('#000000');
    expect(normalizeStyle({ color: '#FFAA00' }).color).toBe('#ffaa00');
    expect(normalizeStyle({ color: '#fa0' }).color).toBe('#000000');
  });

  test('flags are booleans and a family is never empty', () => {
    expect(normalizeStyle({ bold: 1, italic: 'yes', underline: 0, strikethrough: undefined })).toMatchObject({
      bold: true, italic: true, underline: false, strikethrough: false,
    });
    expect(normalizeStyle({ fontFamily: '' }).fontFamily).toBe('sans');
    expect(normalizeStyle({ fontFamily: 5 }).fontFamily).toBe('sans');
  });
});

describe('normalizeText', () => {
  test('uses \\n for line breaks and drops the ones at the end', () => {
    expect(normalizeText('a\r\nb\rc\n\n')).toBe('a\nb\nc');
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(12)).toBe('12');
    expect(normalizeText('  keep  ')).toBe('  keep  ');
  });
});

describe('blockOf', () => {
  test('has the text, the style and the place of a block', () => {
    const block = blockOf({
      id: 'a', type: 'addText', page: 3, text: 'Hi\r\n', textX: 10, baseline: 20, rotation: 450, boxWidth: 60, fontSize: 20,
    });
    expect(block).toEqual({
      ...DEFAULT_TEXT_STYLE, fontSize: 20, text: 'Hi', textX: 10, baseline: 20, rotation: 90, boxWidth: 60,
    });
  });

  test('a block without a rotation or a width has none', () => {
    const block = blockOf({ text: 'x', textX: 1, baseline: 2, rotation: undefined, boxWidth: 0 });
    expect(block.rotation).toBe(0);
    expect(block.boxWidth).toBeNull();
    expect(blockOf({ text: 'x', textX: 1, baseline: 2, boxWidth: -5 }).boxWidth).toBeNull();
    expect(blockOf({ text: 'x', textX: 1, baseline: 2, rotation: 'x' }).rotation).toBe(0);
  });

  test('takes the text from the argument when it is given', () => {
    expect(blockOf({ text: 'old', textX: 1, baseline: 2 }, 'new').text).toBe('new');
  });
});

describe('toPayload', () => {
  const page = { width: 612, height: 792 };

  test('sends only the fields the backend reads and rounds numbers', () => {
    const payload = toPayload({
      id: 'edit-1',
      type: 'replace',
      page: 2,
      x: 10.123456,
      y: 20,
      width: 30.5,
      height: 12,
      textX: 11.987,
      baseline: 31.004,
      fontSize: 11.5,
      text: 'Hello',
      fontFamily: 'serif',
      bold: true,
      italic: false,
      underline: true,
      strikethrough: false,
      color: '#112233',
      align: 'center',
      lineHeight: 1.5,
      opacity: 0.5,
      rotation: 12.3456,
      backgroundColor: '#ffffff',
      sourceIndex: 7,
    }, page);

    expect(payload).toEqual({
      type: 'replace',
      page: 2,
      pageWidth: 612,
      pageHeight: 792,
      x: 10.12,
      y: 20,
      width: 30.5,
      height: 12,
      textX: 11.99,
      baseline: 31,
      fontSize: 11.5,
      text: 'Hello',
      fontFamily: 'serif',
      bold: true,
      italic: false,
      underline: true,
      strikethrough: false,
      color: '#112233',
      align: 'center',
      lineHeight: 1.5,
      opacity: 0.5,
      rotation: 12.35,
      backgroundColor: '#ffffff',
    });
  });

  test('added text does not need a box', () => {
    const payload = toPayload({ id: 'a', type: 'addText', page: 1, text: 'Hi', textX: 5, baseline: 30, fontSize: 12 }, page);
    expect(payload).toEqual({
      type: 'addText', page: 1, pageWidth: 612, pageHeight: 792, text: 'Hi', textX: 5, baseline: 30, fontSize: 12,
    });
  });

  test('a block without a width is sent as it is, without a box width', () => {
    const payload = toPayload({
      id: 'a', type: 'addText', page: 1, text: 'one  \nline two  ', textX: 5, baseline: 30, fontSize: 10, fontFamily: 'sans',
    }, page);
    expect(payload.text).toBe('one\nline two');
    expect(payload).not.toHaveProperty('boxWidth');
  });

  test('the server gets the lines of a block that has a width, and the width', () => {
    // In tests every character is half the font size wide: 'aaaa bbbb' is 45 wide.
    const payload = toPayload({
      id: 'a', type: 'addText', page: 1, text: 'aaaa bbbb cc\n\nlast', textX: 5, baseline: 30, fontSize: 10, fontFamily: 'sans',
      boxWidth: 40.123, align: 'right',
    }, page);
    expect(payload.text).toBe('aaaa\nbbbb cc\n\nlast');
    expect(payload.boxWidth).toBe(40.12);
    expect(payload.align).toBe('right');
  });

  test('highlight and erase carry their colours', () => {
    expect(toPayload({ id: 'h', type: 'highlight', page: 1, x: 1, y: 2, width: 3, height: 4, color: '#ffff00' }, page))
      .toMatchObject({ type: 'highlight', color: '#ffff00' });
    expect(toPayload(edit('e', { backgroundColor: '#eeeeee' }), page))
      .toMatchObject({ type: 'erase', backgroundColor: '#eeeeee' });
  });

  test('erase and highlight send no text or style of a block', () => {
    const payload = toPayload(edit('e', { text: 'old', textX: 3, rotation: 20, boxWidth: 40, backgroundColor: '#fff' }), page);
    expect(Object.keys(payload).sort()).toEqual(['backgroundColor', 'height', 'page', 'pageHeight', 'pageWidth', 'type', 'width', 'x', 'y']);
  });

  test('images are sent as plain base64 without the data URL prefix', () => {
    const payload = toPayload({
      id: 'i', type: 'addImage', page: 1, x: 1, y: 2, width: 3, height: 4, imageUrl: 'data:image/png;base64,QUJD',
    }, page);
    expect(payload.imageBase64).toBe('QUJD');
    expect(payload).not.toHaveProperty('imageUrl');
  });

  test('images carry their rotation and opacity', () => {
    const payload = toPayload({
      id: 'i', type: 'addImage', page: 1, x: 1, y: 2, width: 3, height: 4, rotation: 33.333, opacity: 0.75, imageUrl: 'data:,QUJD',
    }, page);
    expect(payload).toMatchObject({ rotation: 33.33, opacity: 0.75 });
  });
});

describe('resolveCommit', () => {
  const block = (patch = {}) => ({
    ...DEFAULT_TEXT_STYLE, fontSize: 12, textX: 50, baseline: 100, rotation: 0, boxWidth: null, ...patch,
  });
  const original = { text: 'Hello', ...block() };
  const replaceSession = {
    ...block(),
    mode: 'replace',
    page: 3,
    sourceIndex: 4,
    cover: { x: 49, y: 89, width: 40, height: 14 },
    background: '#fafafa',
    original,
  };

  test('replace: nothing changed means nothing to do', () => {
    expect(resolveCommit(replaceSession, 'Hello', null)).toBeNull();
    expect(resolveCommit(replaceSession, 'Hello\n', null)).toBeNull();
  });

  test('replace: changed text becomes a replace edit that covers the original text', () => {
    const result = resolveCommit({ ...replaceSession, bold: true }, 'Bye', null);
    expect(result.type).toBe('add');
    expect(result.edit).toMatchObject({
      type: 'replace',
      page: 3,
      sourceIndex: 4,
      x: 49,
      y: 89,
      width: 40,
      height: 14,
      backgroundColor: '#fafafa',
      text: 'Bye',
      bold: true,
      fontFamily: 'sans',
      fontSize: 12,
      color: '#000000',
      textX: 50,
      baseline: 100,
      rotation: 0,
      boxWidth: null,
    });
    expect(result.edit.id).toEqual(expect.any(String));
  });

  test('replace: the edit has the whole style', () => {
    const session = {
      ...replaceSession,
      fontFamily: 'opensans', underline: true, strikethrough: true, align: 'center', lineHeight: 1.6, opacity: 0.5, rotation: 15, boxWidth: 90,
    };
    expect(resolveCommit(session, 'Hello', null).edit).toMatchObject({
      type: 'replace', fontFamily: 'opensans', underline: true, strikethrough: true, align: 'center', lineHeight: 1.6,
      opacity: 0.5, rotation: 15, boxWidth: 90, text: 'Hello',
    });
  });

  test('replace: emptying the text erases the original', () => {
    const result = resolveCommit(replaceSession, '  ', null);
    expect(result.edit).toMatchObject({ type: 'erase', page: 3, x: 49, width: 40, backgroundColor: '#fafafa' });
    expect(result.edit).not.toHaveProperty('text');
  });

  test('replace: a changed style alone is a change', () => {
    expect(resolveCommit({ ...replaceSession, color: '#ff0000' }, 'Hello', null).type).toBe('add');
    expect(resolveCommit({ ...replaceSession, underline: true }, 'Hello', null).type).toBe('add');
    expect(resolveCommit({ ...replaceSession, align: 'right' }, 'Hello', null).type).toBe('add');
  });

  test('replace: moving, turning or resizing the block alone is a change', () => {
    expect(resolveCommit({ ...replaceSession, textX: 60 }, 'Hello', null).edit).toMatchObject({ type: 'replace', textX: 60 });
    expect(resolveCommit({ ...replaceSession, rotation: 90 }, 'Hello', null).edit).toMatchObject({ rotation: 90 });
    expect(resolveCommit({ ...replaceSession, boxWidth: 80 }, 'Hello', null).edit).toMatchObject({ boxWidth: 80 });
  });

  test('new: blank text adds nothing', () => {
    const session = { ...block(), mode: 'new', page: 1, original: { ...original, text: '' } };
    expect(resolveCommit(session, '\n \n', null)).toBeNull();
  });

  test('new: text becomes an addText edit', () => {
    const session = { ...block({ textX: 10, baseline: 30 }), mode: 'new', page: 2, original: { ...original, text: '' } };
    const result = resolveCommit(session, 'Note\r\nsecond\n\n', null);
    expect(result.type).toBe('add');
    expect(result.edit).toMatchObject({ type: 'addText', page: 2, text: 'Note\nsecond', textX: 10, baseline: 30 });
    expect(result.edit).not.toHaveProperty('x');
    expect(result.edit).not.toHaveProperty('width');
  });

  test('existing: unchanged values or a missing edit change nothing', () => {
    const existing = { id: 'a', type: 'addText', textX: 50, baseline: 100 };
    const session = { ...block(), mode: 'existing', editId: 'a', original };
    expect(resolveCommit(session, 'Hello', existing)).toBeNull();
    expect(resolveCommit(session, 'x', undefined)).toBeNull();
  });

  test('existing: editing a block updates all of it', () => {
    const existing = { id: 'a', type: 'addText', textX: 50, baseline: 100 };
    const session = { ...block({ fontSize: 20, rotation: 30 }), mode: 'existing', editId: 'a', original };
    const result = resolveCommit(session, 'Hello there', existing);
    expect(result.type).toBe('update');
    expect(result.id).toBe('a');
    expect(result.patch).toMatchObject({ text: 'Hello there', fontSize: 20, rotation: 30, textX: 50, baseline: 100 });
  });

  test('existing: editing a replacement keeps its cover', () => {
    const existing = { id: 'r', type: 'replace', x: 1, y: 2, width: 3, height: 4, textX: 50, baseline: 100 };
    const session = { ...block(), mode: 'existing', editId: 'r', original };
    const result = resolveCommit(session, 'Other', existing);
    expect(result.patch).toMatchObject({ text: 'Other' });
    expect(result.patch).not.toHaveProperty('x');
    expect(result.patch).not.toHaveProperty('width');
  });

  test('existing: emptying a replacement turns it into an erase, emptying added text removes it', () => {
    const session = { ...block(), mode: 'existing', editId: 'r', original };
    expect(resolveCommit(session, '', { id: 'r', type: 'replace' }))
      .toEqual({ type: 'update', id: 'r', patch: { type: 'erase' } });
    expect(resolveCommit(session, '', { id: 'r', type: 'addText' }))
      .toEqual({ type: 'remove', id: 'r' });
  });

  test('font sizes are kept within limits and invalid sizes fall back', () => {
    const session = { ...block(), mode: 'new', page: 1, original: { ...original, text: '' } };
    expect(resolveCommit({ ...session, fontSize: 5000 }, 'x', null).edit.fontSize).toBe(300);
    expect(resolveCommit({ ...session, fontSize: 1 }, 'x', null).edit.fontSize).toBe(4);
    expect(resolveCommit({ ...session, fontSize: 'abc' }, 'x', null).edit.fontSize).toBe(14);
  });
});

describe('createImageEdit', () => {
  const pageSize = { width: 600, height: 800 };
  const pending = (width, height) => ({ dataUrl: 'data:image/png;base64,AA==', width, height });

  test('is centred on the point and keeps small images at their size', () => {
    const result = createImageEdit(pending(100, 50), { x: 300, y: 400 }, 2, pageSize);
    expect(result).toMatchObject({
      type: 'addImage', page: 2, x: 250, y: 375, width: 100, height: 50, rotation: 0, opacity: 1,
    });
    expect(result.imageUrl).toBe('data:image/png;base64,AA==');
  });

  test('shrinks wide images to 40% of the page width, keeping the aspect ratio', () => {
    const result = createImageEdit(pending(2000, 1000), { x: 300, y: 400 }, 1, pageSize);
    expect(result.width).toBe(240);
    expect(result.height).toBe(120);
  });

  test('shrinks tall images to 80% of the page height', () => {
    const result = createImageEdit(pending(100, 4000), { x: 300, y: 400 }, 1, pageSize);
    expect(result.height).toBe(640);
    expect(result.width).toBeCloseTo(16);
  });

  test('stays inside the page', () => {
    const corner = createImageEdit(pending(100, 100), { x: 0, y: 0 }, 1, pageSize);
    expect(corner).toMatchObject({ x: 0, y: 0 });
    const far = createImageEdit(pending(100, 100), { x: 9999, y: 9999 }, 1, pageSize);
    expect(far).toMatchObject({ x: 500, y: 700 });
  });
});
