import { useEffect, useId, useRef, useState } from 'react';
import { findFamily, groupedFamilies, preloadFace } from './fonts';
import useDismiss from './useDismiss';

/**
 * A drop-down list of the font families, grouped by category and each shown in its own typeface. It works with
 * the keyboard like a list box: arrows (and Home/End) move, Enter chooses, Escape closes.
 *
 * @param restoreFocus called after a family was chosen, to give focus back to where the user was typing
 */
export default function FontPicker({ value, onChange, disabled = false, restoreFocus }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(value);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const prefix = useId();

  const groups = groupedFamilies();
  const families = groups.flatMap((group) => group.families);
  const current = findFamily(value);
  const optionId = (id) => `${prefix}-font-${id}`;

  const close = (reason) => {
    setOpen(false);
    if (reason === 'escape' && buttonRef.current) {
      buttonRef.current.focus();
    }
  };
  useDismiss(open, rootRef, close);

  useEffect(() => {
    if (!open) {
      return;
    }
    // Each family is shown in its own face, so their files are fetched when the list is first opened.
    families.forEach((family) => preloadFace({ fontFamily: family.id, bold: false, italic: false }, family.label));
    listRef.current.focus({ preventScroll: true });
    // Only when the list opens: the families do not change while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const option = document.getElementById(optionId(active));
    if (option && option.scrollIntoView) {
      option.scrollIntoView({ block: 'nearest' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  const toggle = () => {
    if (!open) {
      setActive(current.id);
    }
    setOpen(!open);
  };

  const choose = (id) => {
    setOpen(false);
    if (id !== value) {
      onChange(id);
    }
    if (restoreFocus) {
      restoreFocus();
    } else if (buttonRef.current) {
      buttonRef.current.focus();
    }
  };

  const onKeyDown = (event) => {
    const index = Math.max(0, families.findIndex((family) => family.id === active));
    const moveTo = (next) => {
      event.preventDefault();
      setActive(families[Math.min(families.length - 1, Math.max(0, next))].id);
    };
    switch (event.key) {
      case 'ArrowDown':
        moveTo(index + 1);
        break;
      case 'ArrowUp':
        moveTo(index - 1);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(families.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(active);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        if (event.key.length === 1 && /\S/.test(event.key)) {
          // Typing a letter jumps to the next family that starts with it.
          const letter = event.key.toLowerCase();
          const order = [...families.slice(index + 1), ...families.slice(0, index + 1)];
          const match = order.find((family) => family.label.toLowerCase().startsWith(letter));
          if (match) {
            event.preventDefault();
            setActive(match.id);
          }
        }
    }
  };

  return (
    <div className="picker font-picker" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="bar-button picker-button"
        aria-label={`Font: ${current.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Font"
        disabled={disabled}
        onClick={toggle}
        style={{ fontFamily: current.css }}
      >
        <span className="picker-value">{current.label}</span>
        <span className="chevron" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          ref={listRef}
          className="popover font-list"
          role="listbox"
          aria-label="Fonts"
          tabIndex={-1}
          aria-activedescendant={optionId(active)}
          onKeyDown={onKeyDown}
        >
          {groups.map((group) => (
            <div key={group.category} role="group" aria-labelledby={`${prefix}-group-${group.category}`}>
              <div className="font-group" id={`${prefix}-group-${group.category}`} role="presentation">
                {group.label}
              </div>
              {group.families.map((family) => (
                <div
                  key={family.id}
                  id={optionId(family.id)}
                  role="option"
                  aria-selected={family.id === value}
                  className={`font-option${family.id === active ? ' active' : ''}`}
                  style={{ fontFamily: family.css }}
                  onPointerMove={() => setActive(family.id)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(family.id)}
                >
                  {family.label}
                  {family.id === value && <span className="check" aria-hidden="true">✓</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
