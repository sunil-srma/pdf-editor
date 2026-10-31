import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import useDismiss from './useDismiss';

export const PALETTE = [
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff',
  '#c00000', '#ff0000', '#ff9900', '#ffd966', '#00b050', '#38761d',
  '#00b0f0', '#0070c0', '#1f3864', '#7030a0', '#c27ba0', '#a64d79',
];
const RECENT_KEY = 'pdf-editor.recent-colors';
const MAX_RECENT = 6;
const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

/** A colour typed by the user as a #rrggbb string, or null. Accepts "f00", "#f00", "ff0000" and "#ff0000". */
export function parseHex(text) {
  const match = HEX.exec(String(text).trim());
  if (!match) {
    return null;
  }
  const digits = match[1].length === 3 ? match[1].replace(/./g, (c) => c + c) : match[1];
  return `#${digits.toLowerCase()}`;
}

function readRecent() {
  try {
    const list = JSON.parse(window.localStorage.getItem(RECENT_KEY));
    return Array.isArray(list) ? list.map(parseHex).filter(Boolean).slice(0, MAX_RECENT) : [];
  } catch (error) {
    return [];
  }
}

function saveRecent(list) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch (error) {
    // Storage may be full or disabled; recent colours are only a convenience.
  }
}

const swatchName = (color) => color.toUpperCase();

/**
 * A colour button with a drop-down: a palette, the colours used lately, a hex field and the system colour
 * dialog.
 *
 * @param label what the colour is for, e.g. "Text colour"
 * @param restoreFocus called after a colour was chosen, to give focus back to where the user was typing
 */
export default function ColorPicker({ value, onChange, label = 'Colour', disabled = false, restoreFocus }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [recent, setRecent] = useState(readRecent);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const firstSwatchRef = useRef(null);
  const nativeRef = useRef(null);
  const applyRef = useRef(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useDismiss(open, rootRef, (reason) => {
    setOpen(false);
    if (reason === 'escape' && buttonRef.current) {
      buttonRef.current.focus();
    }
  });

  useEffect(() => {
    if (open && firstSwatchRef.current) {
      firstSwatchRef.current.focus({ preventScroll: true });
    }
  }, [open]);

  const apply = (color, { close = true } = {}) => {
    const hex = parseHex(color);
    if (!hex) {
      setDraft(value);
      return;
    }
    const list = [hex, ...recent.filter((entry) => entry !== hex)].slice(0, MAX_RECENT);
    setRecent(list);
    saveRecent(list);
    if (close) {
      setOpen(false);
      if (restoreFocus) {
        restoreFocus();
      }
    }
    if (hex !== value) {
      onChange(hex);
    }
  };

  useLayoutEffect(() => {
    applyRef.current = apply;
  });

  // The system colour dialog reports every move as an input; only its final choice (the change event) is applied,
  // so that picking a colour is one step in the history.
  useEffect(() => {
    const input = nativeRef.current;
    if (!open || !input) {
      return undefined;
    }
    const onNativeChange = () => applyRef.current(input.value, { close: false });
    input.addEventListener('change', onNativeChange);
    return () => input.removeEventListener('change', onNativeChange);
  }, [open, value]);

  const swatch = (color, ref) => (
    <button
      key={color}
      ref={ref}
      type="button"
      className={`swatch${color === value ? ' current' : ''}`}
      style={{ background: color }}
      title={swatchName(color)}
      aria-label={swatchName(color)}
      aria-pressed={color === value}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => apply(color)}
    />
  );

  return (
    <div className="picker color-picker" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="bar-button picker-button color-button"
        aria-label={`${label}: ${swatchName(value)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <span className="color-chip" style={{ background: value }} aria-hidden="true" />
        <span className="chevron" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="popover color-popover" role="dialog" aria-label={label}>
          <div className="swatches" role="group" aria-label="Palette">
            {PALETTE.map((color, index) => swatch(color, index === 0 ? firstSwatchRef : undefined))}
          </div>
          {recent.length > 0 && (
            <>
              <div className="popover-heading">Recent</div>
              <div className="swatches" role="group" aria-label="Recent colours">
                {recent.map((color) => swatch(color))}
              </div>
            </>
          )}
          <div className="color-custom">
            <input
              key={value}
              ref={nativeRef}
              type="color"
              aria-label="Pick any colour"
              defaultValue={value}
            />
            <input
              type="text"
              className="hex-input"
              aria-label="Hex colour"
              spellCheck={false}
              maxLength={7}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  apply(draft);
                }
              }}
              onBlur={() => {
                if (parseHex(draft) && parseHex(draft) !== value) {
                  apply(draft, { close: false });
                } else {
                  setDraft(value);
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
