import { readDataUrl } from './api';

// The backend embeds PNG and JPEG data and rejects pictures larger than 25 MB.
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const EMBEDDABLE = /^data:image\/(png|jpeg);base64,/;

function decode(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That file is not an image this browser can read.'));
    image.src = dataUrl;
  });
}

/**
 * Reads an image file. Formats the PDF engine cannot embed (GIF, WebP, SVG, ...) are converted to PNG.
 *
 * @returns {Promise<{dataUrl: string, width: number, height: number, name: string}>} natural size in pixels
 */
export async function loadImage(file) {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`The image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`);
  }
  let dataUrl = await readDataUrl(file);
  const image = await decode(dataUrl);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) {
    throw new Error('The image has no size.');
  }
  if (!EMBEDDABLE.test(dataUrl)) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    dataUrl = canvas.toDataURL('image/png');
  }
  return { dataUrl, width, height, name: file.name };
}
