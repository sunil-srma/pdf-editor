import { frameBounds, handleDirection, resizeCursor } from './geometry';

// Space (screen pixels) between a block and the outline drawn around it, so that the handles do not cover it.
export const FRAME_PADDING = 4;
// Below this size (screen pixels) a side has no handle in its middle: it would cover the corner handles.
const MIN_SIDE_FOR_HANDLE = 28;

const stop = (handler) => (event) => {
  event.stopPropagation();
  event.preventDefault();
  if (handler) {
    handler(event);
  }
};

/**
 * The outline of a selected block with its handles: drag the border or the grip to move it, a handle to resize
 * it and the knob above it to turn it. `frame` is in page units ({cx, cy, width, height, rotation}).
 *
 * The frame itself lets the pointer through, so that the block under it can still be clicked (to edit text) and
 * dragged.
 */
export default function SelectionFrame({
  frame, scale, handles = [], rotatable = false, grip = false, angle = null, label = 'Selected block',
  className = '', onMoveStart, onResizeStart, onRotateStart,
}) {
  const width = frame.width * scale + 2 * FRAME_PADDING;
  const height = frame.height * scale + 2 * FRAME_PADDING;
  const rotation = frame.rotation || 0;
  const shown = handles.filter((handle) => {
    const [dx, dy] = handleDirection(handle);
    if (dx !== 0 && dy !== 0) {
      return true;
    }
    return dx === 0 ? width >= MIN_SIDE_FOR_HANDLE : height >= MIN_SIDE_FOR_HANDLE;
  });
  const bounds = angle !== null ? frameBounds(frame) : null;

  return (
    <>
      <div
        className={`selection-frame ${className}`.trim()}
        role="group"
        aria-label={label}
        data-keep-editor=""
        style={{
          left: (frame.cx - frame.width / 2) * scale - FRAME_PADDING,
          top: (frame.cy - frame.height / 2) * scale - FRAME_PADDING,
          width,
          height,
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
        }}
      >
        {onMoveStart && ['top', 'right', 'bottom', 'left'].map((side) => (
          <div
            key={side}
            className={`frame-border ${side}`}
            title="Drag to move"
            onPointerDown={stop(onMoveStart)}
          />
        ))}
        {onMoveStart && grip && (
          <div
            className="frame-grip"
            title="Drag to move"
            aria-hidden="true"
            onPointerDown={stop(onMoveStart)}
          >
            <svg viewBox="0 0 16 16" width="12" height="12">
              <path d="M8 1l2.5 2.5h-1.75v3.75h3.75v-1.75l2.5 2.5-2.5 2.5v-1.75h-3.75v3.75h1.75L8 15l-2.5-2.5h1.75v-3.75H3.5v1.75L1 8l2.5-2.5v1.75h3.75V3.5H5.5z" />
            </svg>
          </div>
        )}
        {rotatable && onRotateStart && (
          <>
            <div className="frame-stem" aria-hidden="true" />
            <div
              className="frame-rotate"
              data-handle="rotate"
              title="Drag to rotate (Shift: steps of 15°)"
              aria-hidden="true"
              onPointerDown={stop(onRotateStart)}
            >
              <svg viewBox="0 0 16 16" width="10" height="10">
                <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5h1.5" fill="none" strokeWidth="2" />
                <path d="M8.5 0l3 2.5-3 2.5z" />
              </svg>
            </div>
          </>
        )}
        {onResizeStart && shown.map((handle) => (
          <div
            key={handle}
            className={`frame-handle ${handle}`}
            data-handle={handle}
            title="Drag to resize"
            aria-hidden="true"
            style={{ cursor: resizeCursor(handle, rotation) }}
            onPointerDown={stop((event) => onResizeStart(event, handle))}
          />
        ))}
      </div>
      {bounds && (
        <div
          className="frame-angle"
          role="status"
          style={{ left: (bounds.x + bounds.width / 2) * scale, top: bounds.y * scale - 34 }}
        >
          {`${Math.round(angle)}°`}
        </div>
      )}
    </>
  );
}

/** The lines a moving block has snapped to, across the whole page. */
export function GuideLines({ guides, pageSize, scale }) {
  if (!guides || (guides.x === null && guides.y === null)) {
    return null;
  }
  return (
    <svg
      className="guide-lines"
      width={pageSize.width * scale}
      height={pageSize.height * scale}
      viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}
      aria-hidden="true"
    >
      {guides.x !== null && (
        <line x1={guides.x} y1={0} x2={guides.x} y2={pageSize.height} vectorEffect="non-scaling-stroke" />
      )}
      {guides.y !== null && (
        <line x1={0} y1={guides.y} x2={pageSize.width} y2={guides.y} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}
