import * as pdfjsLib from 'pdfjs-dist';

const PUBLIC_URL = process.env.PUBLIC_URL || '';

const DOCUMENT_OPTIONS = {
  cMapUrl: `${PUBLIC_URL}/pdfjs/web/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${PUBLIC_URL}/pdfjs/web/standard_fonts/`,
};

let shared = null;

/**
 * One PDF.js worker thread serves every document. Its script comes from the npm package (so it always matches
 * the library version) and is bundled by webpack as a real worker. Emitting it as a plain asset through
 * `workerSrc` does not work here: the app's Babel pipeline rewrites it and injects `require` calls that a
 * standalone worker cannot resolve.
 */
function sharedWorker() {
  if (shared) {
    return shared;
  }
  const port = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url));
  const worker = new pdfjsLib.PDFWorker({ port });
  const failed = new Promise((resolve, reject) => {
    port.addEventListener('error', () => {
      if (shared && shared.worker === worker) {
        shared = null;
      }
      port.terminate();
      reject(new Error('The PDF engine could not be started. Reload the page and try again.'));
    });
  });
  failed.catch(() => {});
  shared = { worker, failed };
  return shared;
}

/**
 * Opens a PDF. PDF.js takes ownership of the array buffer it is given, so pass a copy if the bytes are
 * needed afterwards.
 */
export function openDocument(bytes) {
  const { worker, failed } = sharedWorker();
  const task = pdfjsLib.getDocument({ data: bytes, worker, ...DOCUMENT_OPTIONS });
  return Promise.race([task.promise, failed]).catch((error) => {
    task.destroy().catch(() => {});
    throw error;
  });
}
