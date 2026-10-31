import { useEffect, useRef, useState } from 'react';
import ColorPicker from './ColorPicker';
import FontPicker from './FontPicker';
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from './editModel';
import { DEFAULT_LINE_HEIGHT, constrainStyle, familySupports } from './fonts';
import { normalizeDegrees } from './geometry';

export const SIZE_PRESETS = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72, 96];
export const LINE_HEIGHTS = [1, 1.15, DEFAULT_LINE_HEIGHT, 1.5, 2, 2.5, 3];

const roundSize = (size) => Math.round(size * 10) / 10;
const clampSize = (size) => Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, roundSize(size)));

/** The next preset size above (direction 1) or below (-1) a size, or the size itself at the end of the range. */
export function stepSize(size, direction) {
  if (direction > 0) {
    const next = SIZE_PRESETS.find((preset) => preset > size + 0.01);
    return next ?? clampSize(size + 12);
  }
  const previous = [...SIZE_PRESETS].reverse().find((preset) => preset < size - 0.01);
  return previous ?? clampSize(size - 1);
}

const formatNumber = (value) => String(Math.round(value * 10) / 10);

/**
 * A number field that keeps what the user is typing to itself and applies it on Enter or when it loses focus.
 * Escape puts back the current value.
 */
function NumberField({ value, onCommit, label, className, suffix, disabled }) {
  const [draft, setDraft] = useState(formatNumber(value));
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) {
      setDraft(formatNumber(value));
    }
  }, [value]);

  const commit = () => {
    if (!editing.current) {
      return;
    }
    editing.current = false;
    const number = Number(draft.replace(',', '.'));
    if (draft.trim() !== '' && Number.isFinite(number)) {
      onCommit(number);
    } else {
      setDraft(formatNumber(value));
    }
  };

  return (
    <span className={`number-field ${className || ''}`}>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        title={label}
        disabled={disabled}
        value={draft}
        onFocus={(event) => {
          editing.current = true;
          event.target.select();
        }}
        onChange={(event) => {
          editing.current = true;
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.target.blur();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            editing.current = false;
            setDraft(formatNumber(value));
            event.target.blur();
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            editing.current = false;
            onCommit(null, event.key === 'ArrowUp' ? 1 : -1);
          }
        }}
      />
      {suffix && <span className="suffix" aria-hidden="true">{suffix}</span>}
    </span>
  );
}

/** A toolbar button that does not take focus from the text being edited. */
function BarButton({ label, pressed, onClick, disabled, className = '', children, shortcut }) {
  return (
    <button
      type="button"
      className={`bar-button ${className}`}
      aria-label={label}
      aria-pressed={pressed}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const ALIGN_ICONS = {
  left: 'M2 3h12M2 6.5h8M2 10h12M2 13.5h8',
  center: 'M2 3h12M4 6.5h8M2 10h12M4 13.5h8',
  right: 'M2 3h12M6 6.5h8M2 10h12M6 13.5h8',
};

const TITLES = {
  editor: 'Editing text',
  text: 'Text',
  image: 'Image',
  region: 'Area',
  none: 'New text',
};

/**
 * The options of what is being worked on: the text in the editor, the selected text block or image, or, when
 * nothing is selected, the style of the next text added. Changes are reported with `onChange(patch, options)`;
 * a patch holds style fields, `rotation` or `opacity`. `options.coalesce` marks the changes made while one slider
 * is dragged, which should be one undo step.
 *
 * It is marked with `data-keep-editor`: using it does not close the text editor.
 */
export default function FormatBar({
  kind, style, rotation = 0, opacity = 1, canPaste, onChange, onCopy, onPaste, onDuplicate, onDelete, onDone,
  restoreFocus,
}) {
  const [opacityDraft, setOpacityDraft] = useState(null);
  const gesture = useRef(0);
  const textual = kind === 'editor' || kind === 'text' || kind === 'none';
  const placed = kind === 'text' || kind === 'image' || kind === 'editor';
  const selected = kind === 'text' || kind === 'image' || kind === 'region';

  const after = () => {
    if (kind === 'editor' && restoreFocus) {
      restoreFocus();
    }
  };
  const change = (patch, options) => {
    onChange(patch, options);
    after();
  };

  const supports = textual ? familySupports(style.fontFamily) : { bold: false, italic: false };
  const lineHeights = textual && !LINE_HEIGHTS.includes(style.lineHeight)
    ? [...LINE_HEIGHTS, style.lineHeight].sort((a, b) => a - b)
    : LINE_HEIGHTS;
  const shownOpacity = Math.round((opacityDraft ?? opacity) * 100);

  const startOpacityGesture = () => {
    gesture.current += 1;
  };
  const onOpacity = (event) => {
    const value = Number(event.target.value) / 100;
    setOpacityDraft(value);
    onChange({ opacity: value }, { coalesce: `opacity-${gesture.current}` });
  };
  const endOpacity = () => {
    setOpacityDraft(null);
    after();
  };

  return (
    <div className="format-bar" role="toolbar" aria-label={`${TITLES[kind]} options`} data-keep-editor="">
      <span className="format-title">{TITLES[kind]}</span>

      {textual && (
        <div className="bar-group" role="group" aria-label="Font">
          <FontPicker
            value={style.fontFamily}
            restoreFocus={kind === 'editor' ? restoreFocus : undefined}
            onChange={(fontFamily) => {
              const next = constrainStyle({ ...style, fontFamily });
              onChange({ fontFamily, bold: next.bold, italic: next.italic });
            }}
          />
          <span className="size-control">
            <BarButton label="Smaller text" onClick={() => change({ fontSize: stepSize(style.fontSize, -1) })}>
              <span aria-hidden="true">A−</span>
            </BarButton>
            <NumberField
              label="Font size"
              className="size-field"
              value={style.fontSize}
              onCommit={(size, direction) => {
                const next = direction ? stepSize(style.fontSize, direction) : clampSize(size);
                change({ fontSize: next });
              }}
            />
            <select
              className="size-presets"
              aria-label="Font size presets"
              title="Font size presets"
              value=""
              onChange={(event) => change({ fontSize: Number(event.target.value) })}
            >
              <option value="" disabled hidden> </option>
              {SIZE_PRESETS.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
            <BarButton label="Larger text" onClick={() => change({ fontSize: stepSize(style.fontSize, 1) })}>
              <span aria-hidden="true">A+</span>
            </BarButton>
          </span>
          <ColorPicker
            label="Text colour"
            value={style.color}
            restoreFocus={kind === 'editor' ? restoreFocus : undefined}
            onChange={(color) => onChange({ color })}
          />
        </div>
      )}

      {textual && (
        <div className="bar-group" role="group" aria-label="Text style">
          <BarButton
            label="Bold"
            shortcut="Ctrl+B"
            className="style-b"
            pressed={style.bold}
            disabled={!supports.bold}
            onClick={() => change({ bold: !style.bold })}
          >
            B
          </BarButton>
          <BarButton
            label="Italic"
            shortcut="Ctrl+I"
            className="style-i"
            pressed={style.italic}
            disabled={!supports.italic}
            onClick={() => change({ italic: !style.italic })}
          >
            I
          </BarButton>
          <BarButton
            label="Underline"
            shortcut="Ctrl+U"
            className="style-u"
            pressed={style.underline}
            onClick={() => change({ underline: !style.underline })}
          >
            U
          </BarButton>
          <BarButton
            label="Strikethrough"
            className="style-s"
            pressed={style.strikethrough}
            onClick={() => change({ strikethrough: !style.strikethrough })}
          >
            S
          </BarButton>
        </div>
      )}

      {textual && (
        <div className="bar-group" role="group" aria-label="Paragraph">
          {['left', 'center', 'right'].map((align) => (
            <BarButton
              key={align}
              label={`Align ${align}`}
              pressed={style.align === align}
              onClick={() => change({ align })}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path d={ALIGN_ICONS[align]} stroke="currentColor" strokeWidth="1.6" fill="none" />
              </svg>
            </BarButton>
          ))}
          <select
            className="line-height"
            aria-label="Line spacing"
            title="Line spacing"
            value={style.lineHeight}
            onChange={(event) => change({ lineHeight: Number(event.target.value) })}
          >
            {lineHeights.map((value) => (
              <option key={value} value={value}>{`↕ ${value}`}</option>
            ))}
          </select>
        </div>
      )}

      {(textual || kind === 'image') && (
        <label className="bar-group opacity-control" title="Opacity">
          <span className="control-label">Opacity</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            aria-label="Opacity"
            aria-valuetext={`${shownOpacity}%`}
            value={shownOpacity}
            onPointerDown={startOpacityGesture}
            onKeyDown={startOpacityGesture}
            onChange={onOpacity}
            onPointerUp={endOpacity}
            onKeyUp={endOpacity}
            onBlur={() => setOpacityDraft(null)}
          />
          <span className="control-value" aria-hidden="true">{`${shownOpacity}%`}</span>
        </label>
      )}

      {placed && (
        <div className="bar-group" role="group" aria-label="Rotation">
          <BarButton label="Rotate left 90°" onClick={() => change({ rotation: normalizeDegrees(rotation - 90) })}>
            <span aria-hidden="true">⟲</span>
          </BarButton>
          <NumberField
            label="Rotation in degrees"
            className="rotation-field"
            suffix="°"
            value={rotation}
            onCommit={(degrees, direction) => {
              const next = direction ? Math.round(rotation) + direction : degrees;
              change({ rotation: normalizeDegrees(next) });
            }}
          />
          <BarButton label="Rotate right 90°" onClick={() => change({ rotation: normalizeDegrees(rotation + 90) })}>
            <span aria-hidden="true">⟳</span>
          </BarButton>
        </div>
      )}

      <div className="bar-group bar-actions" role="group" aria-label="Edit">
        {(placed) && (
          <BarButton label="Copy" shortcut="Ctrl+C" onClick={onCopy}>Copy</BarButton>
        )}
        <BarButton label="Paste" shortcut="Ctrl+V" disabled={!canPaste} onClick={onPaste}>Paste</BarButton>
        {selected && kind !== 'region' && (
          <BarButton label="Duplicate" shortcut="Ctrl+D" onClick={onDuplicate}>Duplicate</BarButton>
        )}
        {(selected || kind === 'editor') && (
          <BarButton label="Delete" shortcut="Del" className="danger" onClick={onDelete}>Delete</BarButton>
        )}
        {kind === 'editor' && (
          <BarButton label="Done" shortcut="Enter" className="primary" onClick={onDone}>Done</BarButton>
        )}
      </div>
    </div>
  );
}
