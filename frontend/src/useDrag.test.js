import { act, fireEvent, renderHook } from '@testing-library/react';
import useDrag, { DRAG_THRESHOLD } from './useDrag';

const press = (x = 100, y = 100, pointerId = 1) => ({ pointerId, clientX: x, clientY: y });
const move = (x, y, pointerId = 1) => act(() => {
  fireEvent.pointerMove(window, { pointerId, clientX: x, clientY: y });
});
const release = (x, y, pointerId = 1) => act(() => {
  fireEvent.pointerUp(window, { pointerId, clientX: x, clientY: y });
});

function setup(options = {}) {
  const handlers = { onDrag: jest.fn(), onEnd: jest.fn(), onCancel: jest.fn(), ...options };
  const rendered = renderHook(() => useDrag());
  act(() => rendered.result.current.start(press(), handlers));
  return { ...rendered, handlers };
}

describe('useDrag', () => {
  test('a press that does not travel far enough is a click', () => {
    const { handlers } = setup();
    move(100 + DRAG_THRESHOLD - 1, 100);
    expect(handlers.onDrag).not.toHaveBeenCalled();
    release(101, 100);
    expect(handlers.onEnd).toHaveBeenCalledTimes(1);
    expect(handlers.onEnd.mock.calls[0][1]).toBe(false);
  });

  test('moving on past the threshold is a drag that is followed until the button is released', () => {
    const { handlers } = setup();
    move(100 + DRAG_THRESHOLD, 100);
    move(130, 90);
    expect(handlers.onDrag).toHaveBeenCalledTimes(2);
    expect(handlers.onDrag.mock.calls[1][0]).toMatchObject({ clientX: 130, clientY: 90 });
    release(140, 90);
    expect(handlers.onEnd).toHaveBeenCalledWith(expect.objectContaining({ clientX: 140 }), true);
    expect(handlers.onCancel).not.toHaveBeenCalled();
  });

  test('once it has become a drag it stays one when the pointer comes back', () => {
    const { handlers } = setup();
    move(150, 100);
    move(100, 100);
    expect(handlers.onDrag).toHaveBeenCalledTimes(2);
    release(100, 100);
    expect(handlers.onEnd.mock.calls[0][1]).toBe(true);
  });

  test('a threshold of zero follows the pointer at once', () => {
    const { handlers } = setup({ threshold: 0 });
    move(100, 100);
    expect(handlers.onDrag).toHaveBeenCalledTimes(1);
  });

  test('nothing happens after the end', () => {
    const { handlers } = setup();
    release(100, 100);
    move(200, 200);
    release(200, 200);
    expect(handlers.onDrag).not.toHaveBeenCalled();
    expect(handlers.onEnd).toHaveBeenCalledTimes(1);
  });

  test('other pointers are ignored', () => {
    const { handlers } = setup();
    move(200, 200, 2);
    release(200, 200, 2);
    expect(handlers.onDrag).not.toHaveBeenCalled();
    expect(handlers.onEnd).not.toHaveBeenCalled();
    release(100, 100);
    expect(handlers.onEnd).toHaveBeenCalledTimes(1);
  });

  test('Escape cancels the gesture and nothing else', () => {
    const { handlers } = setup();
    const seen = jest.fn();
    document.addEventListener('keydown', seen);
    move(150, 100);
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    document.removeEventListener('keydown', seen);
    expect(seen).not.toHaveBeenCalled();
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    release(150, 100);
    move(300, 300);
    expect(handlers.onEnd).not.toHaveBeenCalled();
    expect(handlers.onDrag).toHaveBeenCalledTimes(1);
  });

  test('other keys do not matter', () => {
    const { handlers } = setup();
    act(() => {
      fireEvent.keyDown(document.body, { key: 'a' });
    });
    expect(handlers.onCancel).not.toHaveBeenCalled();
  });

  test('a cancelled pointer cancels the gesture', () => {
    const { handlers } = setup();
    act(() => {
      fireEvent.pointerCancel(window, { pointerId: 1 });
    });
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    release(100, 100);
    expect(handlers.onEnd).not.toHaveBeenCalled();
  });

  test('starting a gesture cancels the one that is running', () => {
    const { result, handlers } = setup();
    const second = { onDrag: jest.fn(), onEnd: jest.fn(), onCancel: jest.fn() };
    act(() => result.current.start(press(), second));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    release(100, 100);
    expect(handlers.onEnd).not.toHaveBeenCalled();
    expect(second.onEnd).toHaveBeenCalledTimes(1);
  });

  test('the gesture ends with the component', () => {
    const { unmount, handlers } = setup();
    unmount();
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    release(100, 100);
    expect(handlers.onEnd).not.toHaveBeenCalled();
  });

  test('the callbacks are optional', () => {
    const { result } = renderHook(() => useDrag());
    act(() => result.current.start(press()));
    move(200, 200);
    release(200, 200);
    act(() => result.current.start(press()));
    act(() => result.current.cancel());
  });

  test('the hook gives the same functions on every render', () => {
    const { result, rerender } = renderHook(() => useDrag());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
