// Client for the backend edit API (see PdfController): all edits are sent in a single request together with
// the original PDF, and the edited PDF comes back as a download.

export const APPLY_URL = '/api/apply';
export const WARNINGS_HEADER = 'X-PDF-Warnings';

/** Reads a file into a Uint8Array (Blob#arrayBuffer is missing in older browsers and in jsdom). */
export function readBytes(blob) {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error || new Error('The file could not be read.'));
    reader.readAsArrayBuffer(blob);
  });
}

/** Reads a blob as a data URL. */
export function readDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('The file could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/** Base64 of a byte array. FileReader avoids building a huge intermediate string for large PDFs. */
export async function bytesToBase64(bytes) {
  const url = await readDataUrl(new Blob([bytes]));
  return url.slice(url.indexOf(',') + 1);
}

/** Decodes the URL-encoded JSON array the server puts into the warnings header. */
export function parseWarnings(headerValue) {
  if (!headerValue) {
    return [];
  }
  try {
    const warnings = JSON.parse(decodeURIComponent(headerValue.replace(/\+/g, ' ')));
    return Array.isArray(warnings) ? warnings.map(String) : [];
  } catch (error) {
    return [];
  }
}

/** A message that can be shown to the user for a failed response. */
export async function describeFailure(response) {
  let detail = '';
  try {
    const text = await response.text();
    try {
      const body = JSON.parse(text);
      detail = body.detail || body.message || body.error || '';
    } catch (error) {
      detail = text.trim().startsWith('<') ? '' : text.trim().slice(0, 300);
    }
  } catch (error) {
    detail = '';
  }
  if (detail) {
    return detail;
  }
  if (response.status === 413) {
    return 'The PDF is too large for the server.';
  }
  return `The server could not process the PDF (HTTP ${response.status}).`;
}

/**
 * Applies the edits to the PDF on the server.
 *
 * @param pdfBytes the original PDF
 * @param edits    edits in the backend's format (see toPayload)
 * @returns {Promise<{blob: Blob, warnings: string[]}>} the edited PDF and non-fatal warnings
 *   (for example characters that no installed font can draw)
 */
export async function applyEdits(pdfBytes, edits) {
  const body = JSON.stringify({ pdfBase64: await bytesToBase64(pdfBytes), edits });

  let response;
  try {
    response = await fetch(APPLY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/pdf, application/problem+json' },
      body,
    });
  } catch (error) {
    throw new Error('Could not reach the server. Make sure the application is running and try again.');
  }

  if (!response.ok) {
    throw new Error(await describeFailure(response));
  }
  return {
    blob: await response.blob(),
    warnings: parseWarnings(response.headers.get(WARNINGS_HEADER)),
  };
}

/** Starts a browser download of the blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
