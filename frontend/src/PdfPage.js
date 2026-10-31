import { memo, useEffect, useRef, useState } from 'react';
import InlineTextEditor from './InlineTextEditor';
import SelectionFrame, { GuideLines } from './SelectionFrame';
import {
  DECORATION_THICKNESS, STRIKETHROUGH_OFFSET, UNDERLINE_OFFSET, detectFontStyle, textWidth, typeface,
} from './fonts';
import {
  blockOf, createImageEdit, newId, normalizeStyle, sessionForEdit,
} from './editModel';
import { editFrame, findEditAt, handlesFor, isRotatable, isTextType } from './frames';
import { frameCorners, rotateVector } from './geometry';
import {
  boxBetween, buildTextItems, findItemAt, isCoveredByEdit, sampleColors,
} from './pdfText';
import { caretIndexAt, caretIndexAtPoint, layoutText } from './textLayout';
import useDrag from './useDrag';
import useFrameGestures, { guideTargets } from './useFrameGestures';

// Largest canvas (in pixels) a single page is rendered to; keeps memory in check at high zoom.
const MAX_CANVAS_PIXELS = 16000000;
// Pages are rendered when they come within this distance of the viewport and released far beyond it.
const RENDER_MARGIN = '1200px 0px';
const RELEASE_MARGIN = '4000px 0px';
// Pages that only flash by while scrolling quickly are not rendered.
const RENDER_DELAY_MS = 60;
const MIN_REGION = 2;
// How far (screen pixels) outside a block the pointer still counts as being on it.
const HIT_TOLERANCE_PX = 3;
// A band dragged flatter than this part of a line of text takes the height of the line.
const BAND_SNAP_RATIO = 0.8;

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
const round1 = (value) => Math.round(value * 10) / 10;
const DECORATIONS = [['underline', UNDERLINE_OFFSET], ['strikethrough', STRIKETHROUGH_OFFSET]];

function pdfFont(proxy, fontName) {
  try {
    return proxy.commonObjs.has(fontName) ? proxy.commonObjs.get(fontName) : null;
  } catch (error) {
    return null;
  }
}

const describeEdit = (edit) => {
  if (isTextType(edit)) {
    return `Text block "${edit.text.slice(0, 40)}"`;
  }
  return edit.type === 'addImage' ? 'Image' : `${edit.type === 'erase' ? 'Erased' : 'Highlighted'} area`;
};

/**
 * A block of text drawn the way the backend draws it: the lines of its layout, each moved by its alignment,
 * turned about the origin of the text, with an underline or a strikethrough per line.
 */
function TextShape({ edit }) {
  const layout = layoutText(edit);
  const rotation = edit.rotation || 0;
  const opacity = edit.opacity ?? 1;
  const thickness = DECORATION_THICKNESS * layout.fontSize;
  const decorations = DECORATIONS.filter(([key]) => edit[key]);
  return (
    <g
      transform={rotation ? `rotate(${rotation} ${edit.textX} ${edit.baseline})` : undefined}
      opacity={opacity < 1 ? opacity : undefined}
      data-edit-id={edit.id}
    >
      <text fill={edit.color} fontSize={layout.fontSize} style={{ ...typeface(edit), whiteSpace: 'pre' }}>
        {layout.lines.map((line, i) => (line === '' ? null : (
          <tspan key={i} x={edit.textX + layout.offsets[i]} y={edit.baseline + i * layout.pitch}>{line}</tspan>
        )))}
      </text>
      {decorations.flatMap(([key, offset]) => layout.lines.map((line, i) => {
        if (layout.widths[i] <= 0) {
          return null;
        }
        const x = edit.textX + layout.offsets[i];
        const y = edit.baseline + i * layout.pitch + offset * layout.fontSize;
        return (
          <line
            key={`${key}-${i}`}
            className={key}
            x1={x}
            y1={y}
            x2={x + layout.widths[i]}
            y2={y}
            stroke={edit.color}
            strokeWidth={thickness}
          />
        );
      }))}
    </g>
  );
}

function Shape({ edit }) {
  switch (edit.type) {
    case 'replace':
      return (
        <g>
          <rect x={edit.x} y={edit.y} width={edit.width} height={edit.height} fill={edit.backgroundColor} />
          <TextShape edit={edit} />
        </g>
      );
    case 'erase':
      return <rect x={edit.x} y={edit.y} width={edit.width} height={edit.height} fill={edit.backgroundColor} />;
    case 'highlight':
      return (
        <rect
          x={edit.x}
          y={edit.y}
          width={edit.width}
          height={edit.height}
          fill={edit.color}
          style={{ mixBlendMode: 'multiply' }}
        />
      );
    case 'addText':
      return <TextShape edit={edit} />;
    case 'addImage': {
      const rotation = edit.rotation || 0;
      const opacity = edit.opacity ?? 1;
      return (
        <image
          href={edit.imageUrl}
          x={edit.x}
          y={edit.y}
          width={edit.width}
          height={edit.height}
          preserveAspectRatio="none"
          opacity={opacity < 1 ? opacity : undefined}
          transform={rotation
            ? `rotate(${rotation} ${edit.x + edit.width / 2} ${edit.y + edit.height / 2})`
            : undefined}
          data-edit-id={edit.id}
        />
      );
    }
    default:
      return null;
  }
}

const polygonOf = (frame) => {
  const { tl, tr, br, bl } = frameCorners(frame);
  return [tl, tr, br, bl].map((corner) => `${corner.x},${corner.y}`).join(' ');
};

/**
 * One page of the document: the rendered PDF, a transparent layer of previews for the edits made on
 * it, and the pointer handling that creates and changes those edits. Edits are only previewed here; they
 * are applied to the PDF on the server when the document is exported.
 *
 * Text blocks, images and areas are pointed at, outlined, selected and moved by their frame (frames.js): the
 * box around what is really drawn, turned with it. A text that was edited into a longer one is therefore
 * pointed at as a whole, not by the original words it replaced.
 */
function PdfPage({
  page, scale, tool, edits, editor, selectedId, pendingImage, highlightColor, textStyle, actions,
}) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const pixelsPerUnit = useRef(0);
  const drag = useDrag();

  const [wantRender, setWantRender] = useState(() => typeof IntersectionObserver === 'undefined');
  const [ready, setReady] = useState(false);
  const [renderError, setRenderError] = useState(null);
  const [items, setItems] = useState(null);
  const [hover, setHover] = useState(null);
  const [band, setBand] = useState(null);
  const [cursorPoint, setCursorPoint] = useState(null);

  const widthPx = page.width * scale;
  const heightPx = page.height * scale;

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    let timer = null;
    const near = new IntersectionObserver((entries) => {
      clearTimeout(timer);
      if (entries[entries.length - 1].isIntersecting) {
        timer = setTimeout(() => setWantRender(true), RENDER_DELAY_MS);
      }
    }, { rootMargin: RENDER_MARGIN });
    const far = new IntersectionObserver((entries) => {
      if (!entries[entries.length - 1].isIntersecting) {
        clearTimeout(timer);
        setWantRender(false);
      }
    }, { rootMargin: RELEASE_MARGIN });
    near.observe(rootRef.current);
    far.observe(rootRef.current);
    return () => {
      clearTimeout(timer);
      near.disconnect();
      far.disconnect();
    };
  }, []);

  // Rendering goes to an off-screen canvas that is copied over the visible one when it is complete, so
  // the previous image stays on screen (and is simply stretched) while a new zoom level renders.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!wantRender) {
      canvas.width = 0;
      canvas.height = 0;
      pixelsPerUnit.current = 0;
      setReady(false);
      return undefined;
    }

    let cancelled = false;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const cap = Math.sqrt(MAX_CANVAS_PIXELS / (page.width * page.height));
    const viewport = page.proxy.getViewport({ scale: Math.min(scale * ratio, cap) });
    const buffer = document.createElement('canvas');
    buffer.width = Math.max(1, Math.floor(viewport.width));
    buffer.height = Math.max(1, Math.floor(viewport.height));
    const task = page.proxy.render({
      canvasContext: buffer.getContext('2d', { alpha: false }),
      viewport,
      background: '#ffffff',
    });

    task.promise.then(() => {
      if (cancelled) {
        return;
      }
      canvas.width = buffer.width;
      canvas.height = buffer.height;
      canvas.getContext('2d').drawImage(buffer, 0, 0);
      pixelsPerUnit.current = buffer.width / page.width;
      buffer.width = 0;
      buffer.height = 0;
      setRenderError(null);
      setReady(true);
    }).catch((error) => {
      if (!cancelled && !(error && error.name === 'RenderingCancelledException')) {
        console.error(`Page ${page.number} could not be rendered`, error);
        setRenderError(error);
      }
    });

    return () => {
      cancelled = true;
      task.cancel();
      buffer.width = 0;
      buffer.height = 0;
    };
  }, [wantRender, scale, page]);

  useEffect(() => {
    if (!wantRender || items !== null) {
      return undefined;
    }
    let cancelled = false;
    page.proxy.getTextContent()
      .then((content) => {
        if (!cancelled) {
          setItems(buildTextItems(content, page.transform));
        }
      })
      .catch((error) => {
        console.error(`Text of page ${page.number} could not be read`, error);
        if (!cancelled) {
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [wantRender, items, page]);

  const pointFor = (event) => {
    const rect = overlayRef.current.getBoundingClientRect();
    const kx = rect.width ? page.width / rect.width : 1 / scale;
    const ky = rect.height ? page.height / rect.height : 1 / scale;
    return { x: (event.clientX - rect.left) * kx, y: (event.clientY - rect.top) * ky };
  };
  const insidePage = (point) => ({ x: clamp(point.x, 0, page.width), y: clamp(point.y, 0, page.height) });

  const { live, begin } = useFrameGestures({
    pageSize: page,
    scale,
    pointFor,
    targetsFor: (edit) => guideTargets(edits, page, edit.id),
    onCommit: (edit, patch) => actions.updateEdit(edit.id, patch),
  });

  // The edits as they are drawn: without the one in the editor, and with the change of a running gesture.
  const hiddenId = editor && editor.mode === 'existing' ? editor.editId : null;
  const shown = edits
    .filter((edit) => edit.id !== hiddenId)
    .map((edit) => (live && live.id === edit.id ? { ...edit, ...live.patch } : edit));

  const itemAt = (point) => (items
    ? findItemAt(items, point.x, point.y, (item) => isCoveredByEdit(item.box, edits))
    : null);
  const editAt = (point, accept) => findEditAt(shown, point.x, point.y, accept, HIT_TOLERANCE_PX / scale);

  // What a click at this point would act on: a block of text or an image, a PDF text item, or an area.
  const pickAt = (point) => {
    if (tool === 'select' || tool === 'text') {
      const edit = editAt(point, (e) => isTextType(e) || (tool === 'select' && e.type === 'addImage'));
      if (edit) {
        return { kind: 'edit', id: edit.id, key: edit.id };
      }
    }
    if (tool === 'select' || tool === 'erase' || tool === 'highlight') {
      const item = itemAt(point);
      if (item) {
        return { kind: 'item', item, key: `item-${item.index}` };
      }
    }
    if (tool === 'select') {
      const edit = editAt(point, (e) => e.type === 'erase' || e.type === 'highlight');
      if (edit) {
        return { kind: 'region', id: edit.id, key: edit.id };
      }
    }
    return null;
  };

  const colorsAround = (box) => (canvasRef.current && pixelsPerUnit.current
    ? sampleColors(canvasRef.current, box, pixelsPerUnit.current)
    : null);

  const openReplaceEditor = (item, point) => {
    if (!item.horizontal) {
      actions.notify('Rotated text cannot be edited. Erase it and add new text instead.');
      return;
    }
    const font = pdfFont(page.proxy, item.fontName);
    const detected = detectFontStyle({
      cssFamily: item.cssFamily,
      fontName: font && font.name,
      bold: font && font.bold,
      italic: font && font.italic,
    });
    const sampled = colorsAround(item.box);
    const original = blockOf({
      ...detected,
      fontSize: round1(item.fontSize),
      color: (sampled && sampled.foreground) || '#000000',
      textX: item.x,
      baseline: item.baseline,
      rotation: 0,
      boxWidth: null,
    }, item.str);
    actions.openEditor({
      ...original,
      page: page.number,
      mode: 'replace',
      sourceIndex: item.index,
      cover: item.box,
      background: (sampled && sampled.background) || '#ffffff',
      original,
      caretIndex: caretIndexAt(original.text, point.x - item.x, (text) => textWidth(text, original, original.fontSize)),
    });
  };

  const openExistingEditor = (edit, point) => {
    // The point in the axes of the text: along its lines from its origin, and towards the next line.
    const local = rotateVector(point.x - edit.textX, point.y - edit.baseline, -(edit.rotation || 0));
    actions.openEditor(sessionForEdit(edit, caretIndexAtPoint(edit, local)));
  };

  const openNewEditor = (point) => {
    const style = normalizeStyle(textStyle);
    // The click marks the top left corner of the block.
    const { ascent } = layoutText({ ...style, text: '' });
    const original = blockOf({
      ...style, textX: point.x, baseline: point.y + ascent, rotation: 0, boxWidth: null,
    }, '');
    actions.openEditor({
      ...original,
      page: page.number,
      mode: 'new',
      cover: null,
      background: null,
      original,
      caretIndex: 0,
    });
  };

  const addRegionEdit = (box) => {
    if (box.width < MIN_REGION || box.height < MIN_REGION) {
      return;
    }
    const base = { id: newId(), page: page.number, x: box.x, y: box.y, width: box.width, height: box.height };
    if (tool === 'erase') {
      const sampled = colorsAround(box);
      actions.addEdit({ ...base, type: 'erase', backgroundColor: (sampled && sampled.background) || '#ffffff' });
    } else {
      actions.addEdit({ ...base, type: 'highlight', color: highlightColor });
    }
  };

  const startBand = (event, start, hit) => {
    drag.start(event, {
      onDrag: (move) => setBand(boxBetween(start, insidePage(pointFor(move)))),
      onEnd: (up, moved) => {
        setBand(null);
        if (!moved) {
          if (hit && hit.kind === 'item') {
            addRegionEdit(hit.item.box);
          }
          return;
        }
        const end = insidePage(pointFor(up));
        let box = boxBetween(start, end);
        // Dragging along a line of text gives a very flat box; use the height of the line instead.
        const line = itemAt(start) || itemAt(end);
        if (line && box.height < line.box.height * BAND_SNAP_RATIO) {
          box = { x: box.x, width: box.width, y: line.box.y, height: line.box.height };
        }
        addRegionEdit(box);
      },
      onCancel: () => setBand(null),
    });
  };

  const click = (hit, point) => {
    if (tool === 'select') {
      if (hit && hit.kind === 'item') {
        openReplaceEditor(hit.item, point);
      } else {
        actions.select(null);
      }
    } else if (tool === 'text') {
      openNewEditor(point);
    }
  };

  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    const point = pointFor(event);
    if (tool === 'erase' || tool === 'highlight') {
      startBand(event, point, pickAt(point));
      return;
    }
    if (tool === 'image') {
      drag.start(event, {
        onEnd: (up, moved) => {
          if (!moved && pendingImage) {
            const at = pointFor(up);
            actions.addEdit(createImageEdit(pendingImage, at, page.number, page), { select: true, placedImage: true });
          }
        },
      });
      return;
    }

    const hit = pickAt(point);
    const edit = hit && hit.id ? edits.find((e) => e.id === hit.id) : null;
    if (edit) {
      // Pressing a block selects it and dragging moves it; a click on text edits it.
      begin(event, edit, 'move', null, {
        onDragStart: () => actions.select(edit.id),
        onClick: (up) => {
          if (isTextType(edit)) {
            openExistingEditor(edit, pointFor(up));
          } else {
            actions.select(edit.id);
          }
        },
      });
      return;
    }
    drag.start(event, {
      onEnd: (up, moved) => {
        if (!moved) {
          click(hit, pointFor(up));
        }
      },
    });
  };

  const onPointerMove = (event) => {
    const point = pointFor(event);
    if (tool === 'image') {
      setCursorPoint(point);
      return;
    }
    const hit = pickAt(point);
    setHover((previous) => ((previous && previous.key) === (hit && hit.key) ? previous : hit));
  };

  const onPointerLeave = () => {
    setHover(null);
    setCursorPoint(null);
  };

  const busy = Boolean(live || band);
  const selected = tool === 'select' && !editor ? shown.find((edit) => edit.id === selectedId) : null;
  const selectedOriginal = selected ? edits.find((edit) => edit.id === selected.id) : null;

  let hoverShape = null;
  if (hover && !busy && !editor) {
    if (hover.kind === 'item') {
      hoverShape = (
        <rect
          className={`hover-outline ${tool}`}
          x={hover.item.box.x}
          y={hover.item.box.y}
          width={hover.item.box.width}
          height={hover.item.box.height}
        />
      );
    } else if (hover.id !== (selected && selected.id)) {
      const edit = shown.find((e) => e.id === hover.id);
      if (edit) {
        hoverShape = (
          <polygon className={`hover-outline ${tool}`} data-hover-id={edit.id} points={polygonOf(editFrame(edit))} />
        );
      }
    }
  }

  let cursor = 'default';
  if (tool === 'text') {
    cursor = 'text';
  } else if (tool === 'erase' || tool === 'highlight') {
    cursor = 'crosshair';
  } else if (tool === 'image') {
    cursor = pendingImage ? 'copy' : 'default';
  } else if (live && live.kind === 'move') {
    cursor = 'move';
  } else if (hover) {
    const edit = hover.id ? edits.find((e) => e.id === hover.id) : null;
    if (hover.kind === 'item' || (edit && isTextType(edit))) {
      cursor = 'text';
    } else {
      cursor = 'move';
    }
  }

  const imageGhost = tool === 'image' && pendingImage && cursorPoint
    ? createImageEdit(pendingImage, cursorPoint, page.number, page)
    : null;

  return (
    <section
      ref={rootRef}
      className="page"
      aria-label={`Page ${page.number}`}
      data-page={page.number}
      style={{ width: widthPx, height: heightPx }}
    >
      <canvas ref={canvasRef} className="page-canvas" style={{ width: widthPx, height: heightPx }} />
      {!ready && !renderError && <div className="page-status">Page {page.number}</div>}
      {renderError && <div className="page-status error" role="alert">Page {page.number} could not be rendered.</div>}

      <svg
        className="edit-layer"
        viewBox={`0 0 ${page.width} ${page.height}`}
        width={widthPx}
        height={heightPx}
        aria-hidden="true"
      >
        {shown.map((edit) => <Shape key={edit.id} edit={edit} />)}
        {imageGhost && (
          <image
            className="image-ghost"
            href={imageGhost.imageUrl}
            x={imageGhost.x}
            y={imageGhost.y}
            width={imageGhost.width}
            height={imageGhost.height}
            preserveAspectRatio="none"
            opacity="0.55"
          />
        )}
        {hoverShape}
        {band && (
          <rect className={`band ${tool}`} x={band.x} y={band.y} width={band.width} height={band.height} />
        )}
      </svg>

      <div
        ref={overlayRef}
        className="page-overlay"
        data-tool={tool}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onMouseDown={(event) => event.preventDefault()}
      />

      {live && live.guides && <GuideLines guides={live.guides} pageSize={page} scale={scale} />}

      {selected && (
        <SelectionFrame
          frame={editFrame(selected)}
          scale={scale}
          handles={handlesFor(selected)}
          rotatable={isRotatable(selected)}
          angle={live && live.kind === 'rotate' && live.id === selected.id ? live.angle : null}
          label={`${describeEdit(selected)} selected`}
          onMoveStart={(event) => begin(event, selectedOriginal, 'move')}
          onResizeStart={(event, handle) => begin(event, selectedOriginal, 'resize', handle)}
          onRotateStart={(event) => begin(event, selectedOriginal, 'rotate')}
        />
      )}

      {editor && (
        <InlineTextEditor
          key={editor.key}
          session={editor}
          scale={scale}
          pageSize={page}
          guideEdits={edits}
          actions={actions}
        />
      )}
    </section>
  );
}

export default memo(PdfPage);
