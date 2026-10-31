import {
  APPLY_URL, WARNINGS_HEADER, applyEdits, bytesToBase64, describeFailure, downloadBlob, parseWarnings, readBytes,
} from './api';

const response = ({ ok = true, status = 200, text = '', blob = new Blob(['%PDF-edited']), headers = {} } = {}) => ({
  ok,
  status,
  text: async () => text,
  blob: async () => blob,
  headers: { get: (name) => headers[name] ?? null },
});

describe('parseWarnings', () => {
  test('decodes the URL-encoded JSON array of the header', () => {
    const header = encodeURIComponent(JSON.stringify(['Edit 1: no glyph for "中"', 'second ₹']));
    expect(parseWarnings(header)).toEqual(['Edit 1: no glyph for "中"', 'second ₹']);
  });

  test('understands the form encoding (plus for a space) as well', () => {
    expect(parseWarnings('%5B%22no+glyph+for+%E4%B8%AD+%2B+more%22%5D')).toEqual(['no glyph for 中 + more']);
  });

  test('ignores missing or malformed headers', () => {
    expect(parseWarnings(null)).toEqual([]);
    expect(parseWarnings('')).toEqual([]);
    expect(parseWarnings('%E0%A4%A')).toEqual([]);
    expect(parseWarnings('not json')).toEqual([]);
    expect(parseWarnings(encodeURIComponent('{"a":1}'))).toEqual([]);
  });
});

describe('describeFailure', () => {
  test('uses the detail of a problem document', async () => {
    const message = await describeFailure(response({
      ok: false, status: 400, text: JSON.stringify({ title: 'Bad Request', detail: 'Edit 2 (replace): page 9 does not exist' }),
    }));
    expect(message).toBe('Edit 2 (replace): page 9 does not exist');
  });

  test.each([
    [{ message: 'plain message' }, 'plain message'],
    [{ error: 'Internal Server Error' }, 'Internal Server Error'],
  ])('falls back to other JSON fields (%j)', async (body, expected) => {
    expect(await describeFailure(response({ ok: false, status: 500, text: JSON.stringify(body) }))).toBe(expected);
  });

  test('shows short plain-text bodies but never HTML error pages', async () => {
    expect(await describeFailure(response({ ok: false, status: 502, text: 'Bad gateway' }))).toBe('Bad gateway');
    expect(await describeFailure(response({ ok: false, status: 502, text: '<html><body>Bad gateway</body></html>' })))
      .toBe('The server could not process the PDF (HTTP 502).');
  });

  test('explains oversized requests', async () => {
    expect(await describeFailure(response({ ok: false, status: 413 }))).toBe('The PDF is too large for the server.');
  });

  test('always has something to say', async () => {
    expect(await describeFailure(response({ ok: false, status: 500 }))).toBe('The server could not process the PDF (HTTP 500).');
    expect(await describeFailure({ status: 503, text: async () => { throw new Error('boom'); } }))
      .toBe('The server could not process the PDF (HTTP 503).');
  });
});

describe('byte helpers', () => {
  test('readBytes and bytesToBase64 round-trip binary data', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 37, 80, 68, 70]);
    expect(Array.from(await readBytes(new Blob([bytes])))).toEqual(Array.from(bytes));
    expect(await bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});

describe('applyEdits', () => {
  const edits = [{ type: 'erase', page: 1, x: 1, y: 2, width: 3, height: 4, pageWidth: 612, pageHeight: 792 }];
  const pdf = new Uint8Array([37, 80, 68, 70, 45]);

  afterEach(() => {
    delete global.fetch;
  });

  test('posts the PDF and all edits in one request and returns the edited PDF', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({
      headers: { [WARNINGS_HEADER]: encodeURIComponent(JSON.stringify(['careful'])) },
    }));

    const result = await applyEdits(pdf, edits);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe(APPLY_URL);
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual({ pdfBase64: Buffer.from(pdf).toString('base64'), edits });
    expect(result.warnings).toEqual(['careful']);
    expect(await readBytes(result.blob)).toEqual(new Uint8Array(Buffer.from('%PDF-edited')));
  });

  test('reports server errors with their detail', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({
      ok: false, status: 400, text: JSON.stringify({ detail: 'Edit 1 (erase): width must be positive' }),
    }));
    await expect(applyEdits(pdf, edits)).rejects.toThrow('Edit 1 (erase): width must be positive');
  });

  test('reports an unreachable server in plain words', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(applyEdits(pdf, edits)).rejects.toThrow(/Could not reach the server/);
  });
});

describe('downloadBlob', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    URL.createObjectURL = jest.fn(() => 'blob:test');
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
  });

  test('clicks a temporary link and releases the object URL later', () => {
    const seen = [];
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function record() {
      seen.push({ href: this.getAttribute('href'), download: this.download, attached: document.body.contains(this) });
    });

    downloadBlob(new Blob(['x']), 'out.pdf');

    expect(click).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ href: 'blob:test', download: 'out.pdf', attached: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    jest.advanceTimersByTime(10000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
    click.mockRestore();
  });
});
