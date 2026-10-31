// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// jsdom has no PointerEvent. The page overlay relies on its pointer id, type and button.
if (typeof window.PointerEvent === 'undefined') {
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId === undefined ? 1 : init.pointerId;
      this.pointerType = init.pointerType || 'mouse';
      this.isPrimary = init.isPrimary === undefined ? true : init.isPrimary;
    }
  };
}

// Pointer capture is not implemented either.
Element.prototype.setPointerCapture = Element.prototype.setPointerCapture || (() => {});
Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture || (() => {});
Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture || (() => false);

// There is no canvas in jsdom. A stand-in that can measure text (half a font size per character, 0.9 / 0.2
// ascent / descent) and hand out white pixels is enough here.
HTMLCanvasElement.prototype.getContext = function getContext() {
  const context = {
    font: '10px sans-serif',
    fillRect: () => {},
    clearRect: () => {},
    drawImage: () => {},
    getImageData: (x, y, width, height) => ({
      data: new Uint8ClampedArray(width * height * 4).fill(255),
      width,
      height,
    }),
    measureText: (text) => {
      const match = /([\d.]+)px/.exec(context.font);
      const size = match ? parseFloat(match[1]) : 10;
      return { width: text.length * size * 0.5, fontBoundingBoxAscent: size * 0.9, fontBoundingBoxDescent: size * 0.2 };
    },
  };
  return context;
};
HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
  callback(new Blob(['png'], { type: 'image/png' }));
};
