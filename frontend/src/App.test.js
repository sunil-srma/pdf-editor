import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { loadImage } from './images';
import { openDocument } from './pdfjs';

// import.meta (used to locate the PDF.js worker) cannot be parsed by Jest, and the real library needs a worker.
jest.mock('./pdfjs', () => ({ openDocument: jest.fn() }));
jest.mock('./images', () => ({ loadImage: jest.fn() }));

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
// The window is 1032px wide in these tests, so a page is fitted to 1000px: 1000 / 612 is capped at 150%.
const SCALE = 1.5;

// Two lines of text; "Hello world" sits on the baseline y = 792 - 700 = 92 (page units, from the top).
const TEXT = [
  { str: 'Hello world', transform: [12, 0, 0, 12, 72, 700], width: 66, height: 12, fontName: 'f1' },
  { str: 'Second line', transform: [12, 0, 0, 12, 72, 660], width: 66, height: 12, fontName: 'f1' },
];
const FIRST_WORD = { x: 100, y: 88 };
const SECOND_WORD = { x: 100, y: 128 };
const BLANK_SPACE = { x: 400, y: 400 };

function fakePdf({ pages = 1, items = TEXT } = {}) {
  const pageObjects = Array.from({ length: pages }, () => ({
    getViewport: ({ scale }) => ({
      width: PAGE_WIDTH * scale,
      height: PAGE_HEIGHT * scale,
      transform: [scale, 0, 0, -scale, 0, PAGE_HEIGHT * scale],
    }),
    getTextContent: jest.fn(() => Promise.resolve({
      items,
      styles: { f1: { fontFamily: 'sans-serif', ascent: 0.9, descent: -0.2 } },
    })),
    render: jest.fn(() => ({ promise: Promise.resolve(), cancel: jest.fn() })),
    commonObjs: { has: () => false, get: () => null },
    cleanup: jest.fn(),
  }));
  return {
    numPages: pages,
    getPage: jest.fn((number) => Promise.resolve(pageObjects[number - 1])),
    destroy: jest.fn(),
    pageObjects,
  };
}

const pdfFile = (name = 'sample.pdf') => new File(['%PDF-1.4'], name, { type: 'application/pdf' });

async function openSample({ pdf = fakePdf(), name } = {}) {
  openDocument.mockResolvedValue(pdf);
  render(<App />);
  userEvent.upload(screen.getByLabelText('PDF file'), pdfFile(name));
  const page = await screen.findByRole('region', { name: 'Page 1' });
  await waitFor(() => expect(within(page).queryByText('Page 1')).not.toBeInTheDocument());
  await act(async () => {});
  return { pdf, page, overlay: page.querySelector('.page-overlay') };
}

const pointer = (point) => ({ clientX: point.x * SCALE, clientY: point.y * SCALE, button: 0, pointerId: 1 });
const press = (overlay, point) => fireEvent.pointerDown(overlay, pointer(point));
const release = (overlay, point) => fireEvent.pointerUp(overlay, pointer(point));
const click = (overlay, point) => {
  press(overlay, point);
  release(overlay, point);
};
const drag = (overlay, from, to) => {
  press(overlay, from);
  fireEvent.pointerMove(overlay, pointer(to));
  release(overlay, to);
};

const button = (name) => screen.getByRole('button', { name });
const editor = () => screen.getByRole('textbox', { name: 'Edit text' });
const noEditor = () => screen.queryByRole('textbox', { name: 'Edit text' });
const shownTexts = (page) => Array.from(page.querySelectorAll('svg.edit-layer text')).map((node) => node.textContent);
const counts = () => screen.getByText(/ · \d+ edits?$/).textContent;
const zoomLevel = () => document.querySelector('.zoom-level').textContent;
const formatBar = (name = 'Editing text') => screen.getByRole('toolbar', { name: `${name} options` });

const typeAndApply = (text) => {
  fireEvent.change(editor(), { target: { value: text } });
  fireEvent.keyDown(editor(), { key: 'Enter' });
};

function serverResponse(overrides = {}) {
  return {
    ok: true,
    status: 200,
    text: async () => '',
    blob: async () => new Blob(['%PDF-edited']),
    headers: { get: () => null },
    ...overrides,
  };
}

let downloads;
// Requests to POST /api/apply. The font catalogue (GET /api/fonts) is answered separately: without it the editor
// offers the standard fonts.
let apply;

beforeEach(() => {
  apply = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
  global.fetch = jest.fn((url, options) => (
    url === '/api/fonts' ? Promise.resolve({ ok: false, status: 404 }) : apply(url, options)
  ));
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1032 });
  // Page boxes are not laid out in jsdom: let the overlay report the size the page has on screen.
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    const page = this.classList && this.classList.contains('page-overlay') ? this.closest('.page') : null;
    const width = page ? parseFloat(page.style.width) : 0;
    const height = page ? parseFloat(page.style.height) : 0;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height };
  });
  downloads = [];
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function record() {
    downloads.push(this.download);
  });
  URL.createObjectURL = jest.fn(() => 'blob:test');
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete document.documentElement.clientWidth;
  delete URL.createObjectURL;
  delete URL.revokeObjectURL;
  delete global.fetch;
});

describe('before a PDF is open', () => {
  test('offers the upload and keeps the editing controls disabled', () => {
    render(<App />);
    expect(screen.getAllByRole('button', { name: 'Upload PDF' })[0]).toBeEnabled();
    ['Edit text', 'Add text', 'Erase', 'Highlight', 'Add image', 'Undo', 'Redo', 'Export PDF', 'Export PNGs']
      .forEach((name) => expect(button(name)).toBeDisabled());
    expect(screen.getByText(/drop a PDF file anywhere/i)).toBeInTheDocument();
  });
});

describe('opening a PDF', () => {
  test('shows every page, fitted to the window, and releases the file input', async () => {
    const { page } = await openSample({ pdf: fakePdf({ pages: 3 }) });
    expect(screen.getAllByRole('region', { name: /^Page \d$/ })).toHaveLength(3);
    expect(page).toHaveStyle({ width: `${PAGE_WIDTH * SCALE}px`, height: `${PAGE_HEIGHT * SCALE}px` });
    expect(screen.getByText('150%')).toBeInTheDocument();
    expect(screen.getByText(/sample\.pdf · 3 pages · 0 edits/)).toBeInTheDocument();
    expect(button('Edit text')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Export PDF')).toBeEnabled();
    expect(screen.getByLabelText('PDF file').value).toBe('');
  });

  test('renders the page once the page is wanted', async () => {
    const { pdf } = await openSample();
    expect(pdf.pageObjects[0].render).toHaveBeenCalledTimes(1);
    expect(pdf.pageObjects[0].getTextContent).toHaveBeenCalledTimes(1);
  });

  test('explains why a file cannot be opened', async () => {
    render(<App />);
    openDocument.mockRejectedValue(Object.assign(new Error('x'), { name: 'PasswordException' }));
    userEvent.upload(screen.getByLabelText('PDF file'), pdfFile('secret.pdf'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/password protected/i);
    expect(screen.queryByRole('region', { name: 'Page 1' })).not.toBeInTheDocument();
  });

  test('rejects files that are not PDFs without trying to open them', async () => {
    render(<App />);
    userEvent.upload(screen.getByLabelText('PDF file'), new File(['hi'], 'notes.txt', { type: 'text/plain' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please choose a PDF file.');
    expect(openDocument).not.toHaveBeenCalled();
  });

  test('accepts a PDF dropped onto the window', async () => {
    openDocument.mockResolvedValue(fakePdf());
    render(<App />);
    const file = pdfFile('dropped.pdf');
    fireEvent.drop(window, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(await screen.findByRole('region', { name: 'Page 1' })).toBeInTheDocument();
    expect(screen.getByText(/dropped\.pdf/)).toBeInTheDocument();
  });
});

describe('editing text', () => {
  test('clicking a word opens an editor with its text, and Enter applies the change in place', async () => {
    const { pdf, page, overlay } = await openSample();

    click(overlay, FIRST_WORD);
    expect(editor()).toHaveValue('Hello world');
    expect(formatBar()).toBeInTheDocument();

    typeAndApply('Hello there');

    expect(noEditor()).not.toBeInTheDocument();
    expect(shownTexts(page)).toEqual(['Hello there']);
    expect(counts()).toMatch(/1 edit$/);
    // Editing never re-renders the page: that is what made the old editor flicker and lose edits.
    expect(pdf.pageObjects[0].render).toHaveBeenCalledTimes(1);
  });

  test('several quick edits are all kept', async () => {
    const { page, overlay } = await openSample();

    click(overlay, FIRST_WORD);
    typeAndApply('One');
    click(overlay, SECOND_WORD);
    typeAndApply('Two');

    expect(shownTexts(page)).toEqual(['One', 'Two']);
    expect(counts()).toMatch(/2 edits$/);
  });

  test('clicking somewhere else applies the open edit and carries on with that click', async () => {
    const { page, overlay } = await openSample();

    click(overlay, FIRST_WORD);
    fireEvent.change(editor(), { target: { value: 'Changed' } });
    fireEvent.pointerDown(overlay, pointer(SECOND_WORD)); // commits, then selects the next word
    expect(shownTexts(page)).toEqual(['Changed']);
    fireEvent.pointerUp(overlay, pointer(SECOND_WORD));
    expect(editor()).toHaveValue('Second line');
  });

  test('Escape drops the change', async () => {
    const { page, overlay } = await openSample();
    click(overlay, FIRST_WORD);
    fireEvent.change(editor(), { target: { value: 'Never mind' } });
    fireEvent.keyDown(editor(), { key: 'Escape' });
    expect(noEditor()).not.toBeInTheDocument();
    expect(shownTexts(page)).toEqual([]);
    expect(counts()).toMatch(/0 edits$/);
  });

  test('closing the editor without a change adds nothing', async () => {
    const { overlay } = await openSample();
    click(overlay, FIRST_WORD);
    fireEvent.keyDown(editor(), { key: 'Enter' });
    expect(counts()).toMatch(/0 edits$/);
  });

  test('Shift+Enter keeps editing', async () => {
    const { overlay } = await openSample();
    click(overlay, FIRST_WORD);
    fireEvent.keyDown(editor(), { key: 'Enter', shiftKey: true });
    expect(editor()).toBeInTheDocument();
  });

  test('emptying the text removes the original text', async () => {
    const { page, overlay } = await openSample();
    click(overlay, FIRST_WORD);
    typeAndApply('');
    expect(shownTexts(page)).toEqual([]);
    expect(counts()).toMatch(/1 edit$/);
    // The hidden word cannot be picked again.
    click(overlay, FIRST_WORD);
    expect(noEditor()).not.toBeInTheDocument();
  });

  test('the format bar changes how the text looks', async () => {
    const { page, overlay } = await openSample();
    click(overlay, FIRST_WORD);
    const bar = within(formatBar());
    userEvent.click(bar.getByRole('button', { name: 'Bold' }));
    userEvent.click(bar.getByRole('button', { name: /^Font: / }));
    userEvent.click(screen.getByRole('option', { name: /Times/ }));
    const size = bar.getByRole('textbox', { name: 'Font size' });
    fireEvent.focus(size);
    fireEvent.change(size, { target: { value: '20' } });
    fireEvent.keyDown(size, { key: 'Enter' });
    userEvent.click(bar.getByRole('button', { name: 'Underline' }));
    userEvent.click(bar.getByRole('button', { name: 'Align center' }));
    expect(editor()).toBeInTheDocument();
    fireEvent.keyDown(editor(), { key: 'Enter' });

    const text = page.querySelector('svg.edit-layer text');
    expect(text.style.fontWeight).toBe('700');
    expect(text).toHaveAttribute('font-size', '20');
    expect(text.style.fontFamily).toMatch(/serif/);
    expect(page.querySelectorAll('svg.edit-layer line.underline')).toHaveLength(1);
  });

  test('the Delete button of the editor erases the text', async () => {
    const { page, overlay } = await openSample();
    click(overlay, FIRST_WORD);
    userEvent.click(within(formatBar()).getByRole('button', { name: 'Delete' }));
    expect(noEditor()).not.toBeInTheDocument();
    expect(shownTexts(page)).toEqual([]);
    expect(counts()).toMatch(/1 edit$/);
  });

  test('text that was added can be edited again', async () => {
    const { page, overlay } = await openSample();
    userEvent.click(button('Add text'));
    click(overlay, BLANK_SPACE);
    typeAndApply('Note');
    click(overlay, { x: BLANK_SPACE.x + 5, y: BLANK_SPACE.y + 5 });
    expect(editor()).toHaveValue('Note');
    typeAndApply('Longer note');
    expect(shownTexts(page)).toEqual(['Longer note']);
    expect(counts()).toMatch(/1 edit$/);
  });

  test('added text that is emptied disappears', async () => {
    const { page, overlay } = await openSample();
    userEvent.click(button('Add text'));
    click(overlay, BLANK_SPACE);
    typeAndApply('Note');
    click(overlay, { x: BLANK_SPACE.x + 5, y: BLANK_SPACE.y + 5 });
    typeAndApply('');
    expect(shownTexts(page)).toEqual([]);
    expect(counts()).toMatch(/0 edits$/);
  });
});

describe('the other tools', () => {
  test('Add text puts new text where the page was clicked', async () => {
    const { page, overlay } = await openSample();
    userEvent.click(button('Add text'));
    expect(button('Add text')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Edit text')).toHaveAttribute('aria-pressed', 'false');

    click(overlay, BLANK_SPACE);
    expect(editor()).toHaveValue('');
    typeAndApply('Typed line');
    expect(shownTexts(page)).toEqual(['Typed line']);
  });

  test('Add text ignores empty input', async () => {
    const { overlay } = await openSample();
    userEvent.click(button('Add text'));
    click(overlay, BLANK_SPACE);
    fireEvent.keyDown(editor(), { key: 'Enter' });
    expect(counts()).toMatch(/0 edits$/);
  });

  test('Erase covers a dragged area, and a click on a word erases that word', async () => {
    const { page, overlay } = await openSample();
    userEvent.click(button('Erase'));
    drag(overlay, { x: 300, y: 300 }, { x: 400, y: 340 });
    click(overlay, FIRST_WORD);

    expect(counts()).toMatch(/2 edits$/);
    const covers = Array.from(page.querySelectorAll('svg.edit-layer rect:not([class])'));
    expect(covers).toHaveLength(2);
    expect(covers[0]).toHaveAttribute('width', '100');
    expect(covers[0]).toHaveAttribute('height', '40');
    expect(covers[0]).toHaveAttribute('fill', '#ffffff');
  });

  test('a tiny drag is not an erase', async () => {
    const { overlay } = await openSample();
    userEvent.click(button('Erase'));
    drag(overlay, { x: 300, y: 300 }, { x: 301, y: 301 });
    expect(counts()).toMatch(/0 edits$/);
  });

  test('Highlight multiplies its colour with the page', async () => {
    const { page, overlay } = await openSample();
    userEvent.click(button('Highlight'));
    click(overlay, SECOND_WORD);
    const mark = page.querySelector('svg.edit-layer rect:not([class])');
    expect(mark).toHaveAttribute('fill', '#ffff00');
    expect(mark.style.mixBlendMode).toBe('multiply');
  });

  test('the image tool places a picture that can then be deleted', async () => {
    const { page, overlay } = await openSample();
    loadImage.mockResolvedValue({ dataUrl: 'data:image/png;base64,QUJD', width: 200, height: 100, name: 'logo.png' });

    userEvent.upload(screen.getByLabelText('Image file'), new File(['x'], 'logo.png', { type: 'image/png' }));
    await waitFor(() => expect(button('Add image')).toHaveAttribute('aria-pressed', 'true'));

    click(overlay, { x: 300, y: 400 });
    const image = page.querySelector('svg.edit-layer image');
    expect(image).toHaveAttribute('width', '200');
    expect(image).toHaveAttribute('height', '100');
    expect(image).toHaveAttribute('x', '200');
    expect(button('Edit text')).toHaveAttribute('aria-pressed', 'true');
    expect(counts()).toMatch(/1 edit$/);

    fireEvent.keyDown(window, { key: 'Delete' });
    expect(page.querySelector('svg.edit-layer image')).toBeNull();
    expect(counts()).toMatch(/0 edits$/);
  });

  test('a picture is moved by dragging it, as a single undo step', async () => {
    const { page, overlay } = await openSample();
    loadImage.mockResolvedValue({ dataUrl: 'data:image/png;base64,QUJD', width: 200, height: 100, name: 'logo.png' });
    userEvent.upload(screen.getByLabelText('Image file'), new File(['x'], 'logo.png', { type: 'image/png' }));
    await waitFor(() => expect(button('Add image')).toHaveAttribute('aria-pressed', 'true'));
    click(overlay, { x: 300, y: 400 });

    drag(overlay, { x: 300, y: 400 }, { x: 350, y: 420 });
    const image = page.querySelector('svg.edit-layer image');
    expect(image).toHaveAttribute('x', '250');
    expect(image).toHaveAttribute('y', '370');

    userEvent.click(button('Undo'));
    expect(page.querySelector('svg.edit-layer image')).toHaveAttribute('x', '200');
  });

  test('Escape leaves the image tool', async () => {
    await openSample();
    loadImage.mockResolvedValue({ dataUrl: 'data:image/png;base64,QUJD', width: 20, height: 20, name: 'a.png' });
    userEvent.upload(screen.getByLabelText('Image file'), new File(['x'], 'a.png', { type: 'image/png' }));
    await waitFor(() => expect(button('Add image')).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(button('Edit text')).toHaveAttribute('aria-pressed', 'true');
  });

  test('an unreadable image is reported', async () => {
    await openSample();
    loadImage.mockRejectedValue(new Error('That file is not an image this browser can read.'));
    userEvent.upload(screen.getByLabelText('Image file'), new File(['x'], 'a.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not an image');
  });
});

describe('history and shortcuts', () => {
  test('undo and redo step through the edits', async () => {
    const { page, overlay } = await openSample();
    click(overlay, FIRST_WORD);
    typeAndApply('Changed');
    expect(button('Redo')).toBeDisabled();

    userEvent.click(button('Undo'));
    expect(shownTexts(page)).toEqual([]);
    expect(button('Undo')).toBeDisabled();
    expect(button('Redo')).toBeEnabled();

    userEvent.click(button('Redo'));
    expect(shownTexts(page)).toEqual(['Changed']);
  });

  test('Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y work from the keyboard', async () => {
    const { page, overlay } = await openSample();
    click(overlay, FIRST_WORD);
    typeAndApply('Changed');

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(shownTexts(page)).toEqual([]);
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(shownTexts(page)).toEqual(['Changed']);
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(shownTexts(page)).toEqual(['Changed']);
  });

  test('shortcuts leave text fields alone', async () => {
    const { page, overlay } = await openSample();
    click(overlay, FIRST_WORD);
    typeAndApply('Changed');
    click(overlay, SECOND_WORD);
    fireEvent.keyDown(editor(), { key: 'z', ctrlKey: true });
    expect(shownTexts(page)).toEqual(['Changed']);
  });

  test('hovering and clicking empty space does nothing', async () => {
    const { overlay } = await openSample();
    fireEvent.pointerMove(overlay, pointer(BLANK_SPACE));
    click(overlay, BLANK_SPACE);
    expect(noEditor()).not.toBeInTheDocument();
    expect(counts()).toMatch(/0 edits$/);
  });
});

describe('zoom', () => {
  test('steps through the zoom levels and resizes the pages', async () => {
    const { page } = await openSample();
    userEvent.click(button('Zoom in'));
    expect(zoomLevel()).toBe('200%');
    expect(page).toHaveStyle({ width: `${PAGE_WIDTH * 2}px` });
    userEvent.click(button('Zoom out')); // 150%
    userEvent.click(button('Zoom out')); // 125%
    userEvent.click(button('Zoom out')); // 100%
    expect(zoomLevel()).toBe('100%');
    userEvent.click(button('Fit'));
    expect(zoomLevel()).toBe('163%');
  });

  test('edits are placed correctly at any zoom', async () => {
    const { overlay } = await openSample();
    ['125%', '100%', '75%'].forEach((level) => {
      userEvent.click(button('Zoom out'));
      expect(zoomLevel()).toBe(level);
    });
    const atScale = (point) => ({ clientX: point.x * 0.75, clientY: point.y * 0.75, button: 0, pointerId: 1 });
    fireEvent.pointerDown(overlay, atScale(FIRST_WORD));
    fireEvent.pointerUp(overlay, atScale(FIRST_WORD));
    expect(editor()).toHaveValue('Hello world');
  });
});

describe('exporting', () => {
  test('without edits the original PDF is downloaded and the server is not involved', async () => {
    await openSample({ name: 'report.pdf' });
    userEvent.click(button('Export PDF'));
    expect(await screen.findByText('Saved report.pdf.')).toBeInTheDocument();
    expect(downloads).toEqual(['report.pdf']);
    expect(apply).not.toHaveBeenCalled();
  });

  test('all edits go to the server in one request and the result is downloaded', async () => {
    apply.mockResolvedValue(serverResponse());
    const { overlay } = await openSample({ name: 'report.pdf' });

    click(overlay, FIRST_WORD);
    typeAndApply('Hello there');
    userEvent.click(button('Erase'));
    drag(overlay, { x: 300, y: 300 }, { x: 400, y: 340 });
    userEvent.click(button('Highlight'));
    click(overlay, SECOND_WORD);

    userEvent.click(button('Export PDF'));
    expect(await screen.findByText('Saved report-edited.pdf.')).toBeInTheDocument();

    expect(apply).toHaveBeenCalledTimes(1);
    const [url, options] = apply.mock.calls[0];
    expect(url).toBe('/api/apply');
    const body = JSON.parse(options.body);
    expect(body.pdfBase64).toBe(Buffer.from('%PDF-1.4').toString('base64'));
    expect(body.edits.map((edit) => edit.type)).toEqual(['replace', 'erase', 'highlight']);
    expect(body.edits[0]).toMatchObject({
      page: 1, pageWidth: PAGE_WIDTH, pageHeight: PAGE_HEIGHT, text: 'Hello there', fontFamily: 'sans', bold: false,
      textX: 72, baseline: 92, backgroundColor: '#ffffff',
    });
    expect(body.edits[0]).not.toHaveProperty('id');
    expect(body.edits[1]).toMatchObject({ x: 300, y: 300, width: 100, height: 40 });
    expect(body.edits[2]).toMatchObject({ color: '#ffff00' });
    expect(downloads).toEqual(['report-edited.pdf']);
  });

  test('exports the edits made after an earlier export, too', async () => {
    apply.mockResolvedValue(serverResponse());
    const { overlay } = await openSample();
    click(overlay, FIRST_WORD);
    typeAndApply('First');
    userEvent.click(button('Export PDF'));
    await screen.findByText('Saved sample-edited.pdf.');

    click(overlay, SECOND_WORD);
    typeAndApply('Second');
    userEvent.click(button('Export PDF'));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(JSON.parse(apply.mock.calls[1][1].body).edits.map((edit) => edit.text)).toEqual(['First', 'Second']);
  });

  test('warnings of the server are shown next to the success message', async () => {
    const warnings = encodeURIComponent(JSON.stringify(['Edit 1: "中" is not available in any installed font']));
    apply.mockResolvedValue(serverResponse({
      headers: { get: (name) => (name === 'X-PDF-Warnings' ? warnings : null) },
    }));
    const { overlay } = await openSample();
    click(overlay, FIRST_WORD);
    typeAndApply('中');
    userEvent.click(button('Export PDF'));

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('Saved sample-edited.pdf.');
    expect(banner).toHaveTextContent('"中" is not available in any installed font');
    expect(downloads).toEqual(['sample-edited.pdf']);
  });

  test('a failing export keeps the edits and explains what happened', async () => {
    apply.mockResolvedValue(serverResponse({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ detail: 'Edit 1 (replace): page 9 does not exist' }),
    }));
    const { page, overlay } = await openSample();
    click(overlay, FIRST_WORD);
    typeAndApply('Changed');
    userEvent.click(button('Export PDF'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Edit 1 (replace): page 9 does not exist');
    expect(downloads).toEqual([]);
    expect(shownTexts(page)).toEqual(['Changed']);
    expect(button('Export PDF')).toBeEnabled();
  });

  test('an unreachable server is reported', async () => {
    const { overlay } = await openSample();
    click(overlay, FIRST_WORD);
    typeAndApply('Changed');
    userEvent.click(button('Export PDF'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not reach the server/);
  });

  test('exports one PNG per page', async () => {
    await openSample({ pdf: fakePdf({ pages: 2 }), name: 'slides.pdf' });
    userEvent.click(button('Export PNGs'));
    expect(await screen.findByText('Saved 2 PNG images.')).toBeInTheDocument();
    expect(downloads).toEqual(['slides-page-1.png', 'slides-page-2.png']);
  });

  test('the export buttons are unavailable while an export runs', async () => {
    let finish;
    apply.mockImplementation(() => new Promise((resolve) => { finish = () => resolve(serverResponse()); }));
    const { overlay } = await openSample();
    click(overlay, FIRST_WORD);
    typeAndApply('Changed');

    userEvent.click(button('Export PDF'));
    expect(await screen.findByRole('button', { name: 'Exporting…' })).toBeDisabled();
    expect(button('Export PNGs')).toBeDisabled();
    userEvent.click(button('Exporting…'));

    await waitFor(() => expect(apply).toHaveBeenCalled());
    await act(async () => finish());
    expect(await screen.findByText('Saved sample-edited.pdf.')).toBeInTheDocument();
    expect(apply).toHaveBeenCalledTimes(1);
  });
});

describe('replacing the document', () => {
  const unloadEvent = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event;
  };

  test('asks before unsaved edits are discarded', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    const { overlay } = await openSample();
    click(overlay, FIRST_WORD);
    typeAndApply('Changed');

    userEvent.upload(screen.getByLabelText('PDF file'), pdfFile('other.pdf'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('1 unsaved edit'));
    expect(openDocument).toHaveBeenCalledTimes(1);

    confirm.mockReturnValue(true);
    const second = fakePdf({ pages: 2 });
    openDocument.mockResolvedValue(second);
    userEvent.upload(screen.getByLabelText('PDF file'), pdfFile('other.pdf'));
    expect(await screen.findByText(/other\.pdf · 2 pages · 0 edits/)).toBeInTheDocument();
  });

  test('the previous document is released', async () => {
    const { pdf } = await openSample();
    openDocument.mockResolvedValue(fakePdf());
    userEvent.upload(screen.getByLabelText('PDF file'), pdfFile('other.pdf'));
    await screen.findByText(/other\.pdf/);
    await waitFor(() => expect(pdf.destroy).toHaveBeenCalled());
  });

  test('warns when the browser tab is closed with unsaved edits', async () => {
    const { overlay } = await openSample();
    expect(unloadEvent().defaultPrevented).toBe(false);
    click(overlay, FIRST_WORD);
    typeAndApply('Changed');
    expect(unloadEvent().defaultPrevented).toBe(true);
  });

  test('edits that were exported are not unsaved any more', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    apply.mockResolvedValue(serverResponse());
    const { overlay } = await openSample();
    click(overlay, FIRST_WORD);
    typeAndApply('Changed');
    expect(unloadEvent().defaultPrevented).toBe(true);

    userEvent.click(button('Export PDF'));
    await screen.findByText('Saved sample-edited.pdf.');
    expect(unloadEvent().defaultPrevented).toBe(false);

    openDocument.mockResolvedValue(fakePdf({ pages: 2 }));
    userEvent.upload(screen.getByLabelText('PDF file'), pdfFile('other.pdf'));
    expect(confirm).not.toHaveBeenCalled();
    expect(await screen.findByText(/other\.pdf · 2 pages · 0 edits/)).toBeInTheDocument();
  });

  test('only the edits made since the last export count as unsaved', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    apply.mockResolvedValue(serverResponse());
    const { overlay } = await openSample();
    click(overlay, FIRST_WORD);
    typeAndApply('First');
    userEvent.click(button('Export PDF'));
    await screen.findByText('Saved sample-edited.pdf.');

    click(overlay, SECOND_WORD);
    typeAndApply('Second');
    expect(unloadEvent().defaultPrevented).toBe(true);
    userEvent.upload(screen.getByLabelText('PDF file'), pdfFile('other.pdf'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('1 unsaved edit'));

    userEvent.click(button('Undo'));
    expect(unloadEvent().defaultPrevented).toBe(false);
  });
});

describe('rotated text', () => {
  test('cannot be edited, and the user is told what to do instead', async () => {
    const sideways = [{ str: 'Sideways', transform: [0, 12, -12, 0, 300, 600], width: 50, height: 12, fontName: 'f1' }];
    const { overlay } = await openSample({ pdf: fakePdf({ items: sideways }) });
    // The text runs upwards from (300, 600) in the PDF, i.e. from (300, 192) up the page.
    click(overlay, { x: 297, y: 170 });
    expect(noEditor()).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(/Erase it and add new text/);
  });
});
