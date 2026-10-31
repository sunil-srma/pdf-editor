import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import SelectionFrame, { GuideLines } from './SelectionFrame';
import { MAX_TEXT_LENGTH } from './editModel';
import { familySupports, firstBaselineOffset, typeface } from './fonts';
import { handlesFor } from './frames';
import { blockFrame, layoutText, lineHeightOf } from './textLayout';
import useFrameGestures, { guideTargets } from './useFrameGestures';

// Room (screen pixels) after the longest line, so that the caret and rounding never scroll the field sideways.
const CARET_ROOM = 8;

const isComposing = (event) => event.nativeEvent.isComposing || event.keyCode === 229;

/**
 * The in-place text editor. A plain textarea is laid out (and turned) so that its first baseline sits exactly
 * where the block's text is drawn, so opening and closing it does not make the text move. Around it is the frame of
 * the block, by which it can be moved, resized and turned while it is being edited.
 *
 * The style and position of the block live in the editing session (App); changes to them go through
 * `actions.patchEditor`. The text lives here and is reported with `actions.setEditorText`.
 *
 * It applies when the user clicks anywhere outside it (or outside the format bar, which is marked with
 * `data-keep-editor`), on Enter, and when focus leaves it; Escape discards it.
 */
export default function InlineTextEditor({ session, scale, pageSize, guideEdits = [], actions }) {
  const rootRef = useRef(null);
  const fieldRef = useRef(null);
  const initialCaret = useRef(session.caretIndex);
  const latest = useRef({ actions });
  const [text, setText] = useState(session.text);

  useLayoutEffect(() => {
    latest.current = { actions };
  });

  const pointFor = (event) => {
    const rect = rootRef.current.getBoundingClientRect();
    const kx = rect.width ? pageSize.width / rect.width : 1 / scale;
    const ky = rect.height ? pageSize.height / rect.height : 1 / scale;
    return { x: (event.clientX - rect.left) * kx, y: (event.clientY - rect.top) * ky };
  };

  const { live, begin } = useFrameGestures({
    pageSize,
    scale,
    pointFor,
    targetsFor: () => guideTargets(guideEdits, pageSize, session.editId),
    onCommit: (_, patch) => actions.patchEditor(patch),
  });

  // Clicking anywhere outside the editor applies it; the same click then goes on to its target.
  useEffect(() => {
    const onPointerDown = (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-keep-editor]')) {
        return;
      }
      latest.current.actions.commitEditor();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  useEffect(() => {
    const field = fieldRef.current;
    field.focus({ preventScroll: true });
    const caret = Math.min(initialCaret.current ?? field.value.length, field.value.length);
    field.setSelectionRange(caret, caret);
  }, []);

  const block = { ...session, text, type: 'addText', id: 'editor' };
  const shown = live ? { ...block, ...live.patch } : block;
  const layout = layoutText(shown);
  const frame = blockFrame(shown, layout);

  const fontPx = layout.fontSize * scale;
  const pitchPx = layout.pitch * scale;
  const wraps = layout.boxWidth !== null;
  const contentWidth = (wraps ? layout.boxWidth : layout.width) * scale;
  const minHeight = layout.lines.length * pitchPx;

  // As tall as its text, measured before paint so that it never shows a scroll bar or flickers.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    field.style.height = '0px';
    field.style.height = `${Math.max(minHeight, field.scrollHeight)}px`;
  });

  const onChange = (event) => {
    setText(event.target.value);
    actions.setEditorText(event.target.value);
  };

  const toggle = (key) => {
    const supports = familySupports(session.fontFamily);
    if ((key === 'bold' && !supports.bold) || (key === 'italic' && !supports.italic)) {
      return;
    }
    actions.patchEditor({ [key]: !session[key] });
  };

  const onKeyDown = (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      actions.cancelEditor();
    } else if (event.key === 'Enter' && !event.shiftKey && !isComposing(event)) {
      event.preventDefault();
      actions.commitEditor();
    } else if (modifier && !event.altKey && ['b', 'i', 'u'].includes(key)) {
      event.preventDefault();
      toggle({ b: 'bold', i: 'italic', u: 'underline' }[key]);
    }
  };

  // Tabbing out of the editor applies it too; moving into the format bar does not.
  const onBlur = (event) => {
    const next = event.relatedTarget;
    if (next instanceof Element && !next.closest('[data-keep-editor]')) {
      actions.commitEditor();
    }
  };

  const decorations = [shown.underline && 'underline', shown.strikethrough && 'line-through'].filter(Boolean);
  const rotation = shown.rotation || 0;
  const cover = session.cover;

  return (
    <div ref={rootRef} className="inline-editor" data-keep-editor="">
      {cover && (
        <div
          className="editor-cover"
          style={{
            left: cover.x * scale,
            top: cover.y * scale,
            width: cover.width * scale,
            height: cover.height * scale,
            background: session.background,
          }}
        />
      )}
      <div
        className="editor-anchor"
        style={{
          left: shown.textX * scale,
          top: shown.baseline * scale,
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
        }}
      >
        <textarea
          ref={fieldRef}
          className="editor-text"
          aria-label="Edit text"
          data-editor-text=""
          wrap={wraps ? 'soft' : 'off'}
          rows={1}
          spellCheck={false}
          maxLength={MAX_TEXT_LENGTH}
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          style={{
            ...typeface(shown),
            top: -firstBaselineOffset(shown, fontPx, lineHeightOf(shown)),
            width: contentWidth,
            paddingRight: CARET_ROOM,
            fontSize: fontPx,
            lineHeight: `${pitchPx}px`,
            textAlign: layout.align,
            whiteSpace: wraps ? 'pre-wrap' : 'pre',
            textDecorationLine: decorations.length > 0 ? decorations.join(' ') : undefined,
            color: shown.color,
            caretColor: shown.color,
            opacity: shown.opacity ?? 1,
          }}
        />
      </div>
      {live && live.guides && <GuideLines guides={live.guides} pageSize={pageSize} scale={scale} />}
      <SelectionFrame
        frame={frame}
        scale={scale}
        className="editing"
        handles={handlesFor(block)}
        rotatable
        grip
        angle={live && live.kind === 'rotate' ? live.angle : null}
        label="Text being edited"
        onMoveStart={(event) => begin(event, block, 'move')}
        onResizeStart={(event, handle) => begin(event, block, 'resize', handle)}
        onRotateStart={(event) => begin(event, block, 'rotate')}
      />
    </div>
  );
}
