import {
  useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore,
} from 'react';
import './App.css';
import FormatBar from './FormatBar';
import PdfPage from './PdfPage';
import { applyEdits, downloadBlob, readBytes } from './api';
import {
  BLOCK_MIME, clipOfBlock, clipOfEdit, clipOfSelection, clipOfText, createClipEntry, nextPasteSteps, parseClip,
  pasteEdit, serializeClip,
} from './clipboard';
import {
  DEFAULT_TEXT_STYLE, MAX_TEXT_LENGTH, blockOf, createImageEdit, historyReducer, initialHistory, normalizeStyle,
  normalizeText, resolveCommit, sessionForEdit, styleOf, toPayload,
} from './editModel';
import { fontEpoch, loadFontCatalogue, subscribeToFonts } from './fonts';
import { isTextType, moveEditPatch, rotateEditPatch } from './frames';
import { loadImage } from './images';
import { openDocument } from './pdfjs';
import { layoutText } from './textLayout';

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
// Horizontal room around the pages (the padding of .pages).
const PAGES_PADDING = 32;
const MAX_PNG_SIDE = 8000;
const PNG_DOWNLOAD_GAP_MS = 150;
const MESSAGE_LIFETIME_MS = 7000;
const NO_EDITS = [];
// How far the arrow keys move the selection, in page units (with Shift: BIG_NUDGE).
const NUDGE = 1;
const BIG_NUDGE = 10;
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const TOOLS = [
  {
    id: 'select',
    label: 'Edit text',
    hint: 'Click any text to edit it. Drag a text block or image to move it; select it to resize or rotate it.',
  },
  { id: 'text', label: 'Add text', hint: 'Click where the text should go, then type.' },
  { id: 'erase', label: 'Erase', hint: 'Drag over an area, or click a word, to erase it.' },
  { id: 'highlight', label: 'Highlight', hint: 'Drag over an area, or click a word, to highlight it.' },
  { id: 'image', label: 'Add image', hint: 'Click on the page where the image should go. Esc cancels.' },
];
const EDITING_HINT = 'Enter applies · Shift+Enter adds a line · Esc cancels · Drag the frame to move the text, '
  + 'its corners to resize it, the round handle to rotate it';
const SELECTION_HINT = 'Drag to move (Alt: no snapping) · Handles resize · Round handle rotates (Shift: 15° steps) '
  + '· Arrows nudge · Enter edits · Ctrl+C / Ctrl+V / Ctrl+D · Del deletes';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isPdfFile = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
const baseName = (filename) => (filename || '').replace(/\.pdf$/i, '') || 'document';
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const isTypingTarget = (target) => target instanceof Element
  && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
const isEditorField = (target) => target instanceof Element && target.matches('[data-editor-text]');

let clipSequence = 0;
function clipToken() {
  clipSequence += 1;
  return `clip-${Date.now().toString(36)}-${clipSequence}`;
}

// Images are not put on the system clipboard, only a marker that points at the copy kept in the editor.
function markerToken(data) {
  try {
    const value = JSON.parse(data);
    return value && typeof value.internal === 'string' ? value.internal : null;
  } catch (error) {
    return null;
  }
}

function openErrorMessage(error) {
  switch (error && error.name) {
    case 'PasswordException':
      return 'This PDF is password protected. Remove the password and open it again.';
    case 'InvalidPDFException':
      return 'This file is not a valid PDF, or it is damaged.';
    default:
      return `The PDF could not be opened${error && error.message ? `: ${error.message}` : '.'}`;
  }
}

function fitScale(pages) {
  const widest = Math.max(...pages.map((page) => page.width));
  const available = document.documentElement.clientWidth - PAGES_PADDING;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.floor((available / widest) * 100) / 100));
}

/** The number of the page that takes up most of the window, or 1. */
function mostVisiblePage() {
  let best = 1;
  let bestHeight = 0;
  document.querySelectorAll('[data-page]').forEach((element) => {
    const rect = element.getBoundingClientRect();
    const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    if (visible > bestHeight) {
      bestHeight = visible;
      best = Number(element.dataset.page) || 1;
    }
  });
  return best;
}

/** The middle of the part of a page that is in the window, in page units. */
function visibleCentre(pageNumber, page) {
  const element = document.querySelector(`[data-page="${pageNumber}"]`);
  const rect = element ? element.getBoundingClientRect() : null;
  if (!rect || rect.width === 0 || rect.height === 0) {
    return { x: page.width / 2, y: page.height / 2 };
  }
  const middle = (low, high, start, size) => (high > low ? (low + high) / 2 : start + size / 2);
  const cx = middle(Math.max(rect.left, 0), Math.min(rect.right, window.innerWidth), rect.left, rect.width);
  const cy = middle(Math.max(rect.top, 0), Math.min(rect.bottom, window.innerHeight), rect.top, rect.height);
  return {
    x: Math.min(page.width, Math.max(0, ((cx - rect.left) * page.width) / rect.width)),
    y: Math.min(page.height, Math.max(0, ((cy - rect.top) * page.height) / rect.height)),
  };
}

// Pages only re-render when their own edits change, so every list keeps its identity while it is unchanged.
function useEditsByPage(edits) {
  const cache = useRef(new Map());
  return useMemo(() => {
    const grouped = new Map();
    edits.forEach((edit) => {
      if (grouped.has(edit.page)) {
        grouped.get(edit.page).push(edit);
      } else {
        grouped.set(edit.page, [edit]);
      }
    });
    const next = new Map();
    grouped.forEach((list, page) => {
      const previous = cache.current.get(page);
      const same = previous && previous.length === list.length && previous.every((edit, i) => edit === list[i]);
      next.set(page, same ? previous : list);
    });
    cache.current = next;
    return next;
  }, [edits]);
}

export default function App() {
  const [doc, setDoc] = useState(null);
  const [history, dispatch] = useReducer(historyReducer, initialHistory);
  // The edits as they were when they were last exported. Edits that are part of that file are not "unsaved".
  const [savedEdits, setSavedEdits] = useState(null);
  const [tool, setTool] = useState('select');
  const [scale, setScale] = useState(1);
  const [editor, setEditor] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [pendingImage, setPendingImage] = useState(null);
  const [highlightColor, setHighlightColor] = useState('#ffff00');
  const [textStyle, setTextStyle] = useState(DEFAULT_TEXT_STYLE);
  const [busy, setBusy] = useState(null);
  const [banner, setBanner] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [canPaste, setCanPaste] = useState(false);
  // Changes when fonts arrive, so that text is measured and drawn again with them.
  const epoch = useSyncExternalStore(subscribeToFonts, fontEpoch);

  const fileInput = useRef(null);
  const imageInput = useRef(null);
  const zoomAnchor = useRef(null);
  const editorKey = useRef(0);
  const loadId = useRef(0);
  const exporting = useRef(false);
  const latest = useRef({});
  // The editing session and its text are also kept here, up to date at once, so that a session is never
  // applied twice and handlers see the text as it is typed (without re-rendering the app on every key).
  const editorRef = useRef(null);
  const editorTextRef = useRef('');
  // What was copied last: {token, entry, serialized, text}.
  const clipRef = useRef(null);
  const copiedRef = useRef(false);

  const edits = history.present;
  const unsavedCount = useMemo(() => {
    const exported = new Set(savedEdits);
    return edits.filter((edit) => !exported.has(edit)).length;
  }, [edits, savedEdits]);
  const editsByPage = useEditsByPage(edits);
  const selectedEdit = !editor && selectedId ? edits.find((edit) => edit.id === selectedId) : null;

  // Event handlers that must not change identity (they are handed to memoised pages) read the current
  // state from here.
  useLayoutEffect(() => {
    latest.current = { doc, edits, unsavedCount, selectedId, pendingImage, textStyle };
  });

  useEffect(() => {
    loadFontCatalogue();
  }, []);

  // The document is released once it is no longer shown.
  useEffect(() => {
    if (!doc) {
      return undefined;
    }
    return () => {
      doc.proxy.destroy();
    };
  }, [doc]);

  useEffect(() => {
    if (!banner || banner.kind === 'error' || banner.kind === 'warning') {
      return undefined;
    }
    const timer = setTimeout(() => setBanner(null), MESSAGE_LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [banner]);

  const hasUnsaved = unsavedCount > 0;
  useEffect(() => {
    if (!hasUnsaved) {
      return undefined;
    }
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsaved]);

  // Keep the middle of the view in place while the page sizes change with the zoom.
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    zoomAnchor.current = null;
    const root = document.documentElement;
    if (anchor !== null && root.scrollHeight > 0) {
      window.scrollTo(0, anchor * root.scrollHeight - window.innerHeight / 2);
    }
  }, [scale]);

  const zoomTo = useCallback((next) => {
    const root = document.documentElement;
    if (root.scrollHeight > 0) {
      zoomAnchor.current = (window.scrollY + window.innerHeight / 2) / root.scrollHeight;
    }
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(next * 100) / 100)));
  }, []);

  const loadPdf = useCallback(async (file) => {
    if (exporting.current) {
      setBanner({ kind: 'info', text: 'Please wait until the export has finished.' });
      return;
    }
    loadId.current += 1;
    const id = loadId.current;
    setBusy('load');
    setBanner(null);
    let proxy = null;
    try {
      const bytes = await readBytes(file);
      proxy = await openDocument(bytes.slice());
      if (proxy.numPages < 1) {
        throw new Error('This PDF has no pages.');
      }
      const proxies = await Promise.all(Array.from({ length: proxy.numPages }, (_, i) => proxy.getPage(i + 1)));
      const pages = proxies.map((pageProxy, i) => {
        const viewport = pageProxy.getViewport({ scale: 1 });
        return {
          number: i + 1,
          proxy: pageProxy,
          width: viewport.width,
          height: viewport.height,
          transform: viewport.transform,
        };
      });
      if (id !== loadId.current) {
        proxy.destroy();
        return;
      }
      dispatch({ type: 'reset' });
      setSavedEdits(null);
      editorRef.current = null;
      setEditor(null);
      setSelectedId(null);
      setPendingImage(null);
      setTool('select');
      setScale(Math.min(1.5, fitScale(pages)));
      setDoc({ id, name: file.name || 'document.pdf', bytes, proxy, pages });
      if (window.scrollY > 0) {
        window.scrollTo(0, 0);
      }
    } catch (error) {
      if (proxy) {
        proxy.destroy();
      }
      if (id === loadId.current) {
        console.error('Could not open the PDF', error);
        setBanner({ kind: 'error', text: openErrorMessage(error) });
      }
    } finally {
      if (id === loadId.current) {
        setBusy(null);
      }
    }
  }, []);

  const requestOpen = useCallback((file) => {
    if (!isPdfFile(file)) {
      setBanner({ kind: 'error', text: 'Please choose a PDF file.' });
      return;
    }
    const count = latest.current.unsavedCount;
    if (count > 0 && !window.confirm(`Opening another PDF discards your ${plural(count, 'unsaved edit')}. Continue?`)) {
      return;
    }
    loadPdf(file);
  }, [loadPdf]);

  useEffect(() => {
    let depth = 0;
    const carriesFiles = (event) => Boolean(event.dataTransfer) && Array.from(event.dataTransfer.types || []).includes('Files');
    const onEnter = (event) => {
      if (carriesFiles(event)) {
        depth += 1;
        setDragging(true);
      }
    };
    const onLeave = (event) => {
      if (carriesFiles(event)) {
        depth = Math.max(0, depth - 1);
        if (depth === 0) {
          setDragging(false);
        }
      }
    };
    const onOver = (event) => {
      if (carriesFiles(event)) {
        event.preventDefault();
      }
    };
    const onDrop = (event) => {
      if (!carriesFiles(event)) {
        return;
      }
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const file = Array.from(event.dataTransfer.files).find(isPdfFile);
      if (file) {
        requestOpen(file);
      } else {
        setBanner({ kind: 'error', text: 'Please drop a PDF file.' });
      }
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [requestOpen]);

  const actions = useMemo(() => {
    const setSession = (next) => {
      editorRef.current = next;
      setEditor(next);
    };

    const commitEditor = () => {
      const session = editorRef.current;
      if (!session) {
        return;
      }
      setSession(null);
      const text = editorTextRef.current;
      const existing = session.mode === 'existing'
        ? latest.current.edits.find((edit) => edit.id === session.editId)
        : null;
      const result = resolveCommit(session, text, existing);
      if (result && result.type === 'add') {
        dispatch({ type: 'add', edit: result.edit });
      } else if (result && result.type === 'update') {
        dispatch({ type: 'update', id: result.id, patch: result.patch });
      } else if (result) {
        dispatch({ type: 'remove', id: result.id });
      }
      // New text gets the style of the text the user wrote last.
      const own = session.mode === 'new' || (existing && existing.type === 'addText');
      if (own && text.trim() !== '') {
        setTextStyle(styleOf(blockOf(session, text)));
      }
    };

    return {
      openEditor: (session) => {
        commitEditor();
        editorKey.current += 1;
        editorTextRef.current = session.text;
        setSelectedId(null);
        setSession({ ...session, key: editorKey.current });
      },
      commitEditor,
      cancelEditor: () => setSession(null),
      patchEditor: (patch) => {
        if (editorRef.current) {
          setSession({ ...editorRef.current, ...patch });
        }
      },
      setEditorText: (text) => {
        editorTextRef.current = text;
      },
      addEdit: (edit, options = {}) => {
        dispatch({ type: 'add', edit });
        setSelectedId(options.select ? edit.id : null);
        if (options.placedImage) {
          setPendingImage(null);
          setTool('select');
        }
      },
      updateEdit: (id, patch, options = {}) => dispatch({ type: 'update', id, patch, coalesce: options.coalesce }),
      removeEdit: (id) => {
        dispatch({ type: 'remove', id });
        setSelectedId((current) => (current === id ? null : current));
      },
      select: (id) => setSelectedId(id),
      notify: (text) => setBanner({ kind: 'info', text }),
    };
  }, []);

  // Copy and paste of whole blocks with their style, through the system clipboard (so that the browser's own
  // shortcuts and menus work) and a copy kept here (for images, and for browsers that drop custom formats).
  const clipboard = useMemo(() => {
    const remember = (clip, serialized) => {
      const token = clipToken();
      clipRef.current = {
        token,
        entry: createClipEntry(clip),
        serialized: serialized ?? serializeClip(clip),
        text: clip.kind === 'text' ? clip.text : null,
      };
      setCanPaste(true);
      return clipRef.current;
    };

    const place = (entry, pageNumber) => {
      const page = latest.current.doc && latest.current.doc.pages[pageNumber - 1];
      if (!page) {
        return;
      }
      const steps = nextPasteSteps(entry, pageNumber);
      const edit = pasteEdit(entry.clip, { page: pageNumber, pageSize: page, steps });
      dispatch({ type: 'add', edit });
      setSelectedId(edit.id);
      setPendingImage(null);
      setTool('select');
    };

    // Pasting goes onto the page of the selection or of the editor, or else onto the page in view.
    const targetPage = () => {
      const { selectedId: selection, edits: list, doc: current } = latest.current;
      const selected = selection && list.find((edit) => edit.id === selection);
      if (selected) {
        return selected.page;
      }
      if (editorRef.current) {
        return editorRef.current.page;
      }
      return Math.min(current.pages.length, mostVisiblePage());
    };

    // What there is to copy: the text selected in the editor, the block in the editor, or the selected edit.
    const currentClip = (field) => {
      const session = editorRef.current;
      if (session) {
        const text = editorTextRef.current;
        if (field && field.selectionStart !== field.selectionEnd) {
          return clipOfSelection(session, text.slice(field.selectionStart, field.selectionEnd));
        }
        return text.trim() === '' ? null : clipOfBlock(session, text);
      }
      const { selectedId: selection, edits: list } = latest.current;
      const selected = selection && list.find((edit) => edit.id === selection);
      return selected ? clipOfEdit(selected) : null;
    };

    const onCopy = (event) => {
      const target = event.target;
      const inEditor = Boolean(editorRef.current) && isEditorField(target);
      if (!inEditor && (isTypingTarget(target) || !latest.current.selectedId || editorRef.current)) {
        return;
      }
      const clip = currentClip(inEditor ? target : null);
      if (!clip || !event.clipboardData) {
        return;
      }
      if (event.type === 'cut' && inEditor) {
        // Cutting text in the editor is left to the browser; what it cuts is remembered with its style.
        if (target.selectionStart !== target.selectionEnd) {
          remember(clip);
          copiedRef.current = true;
        }
        return;
      }
      event.preventDefault();
      const entry = remember(clip);
      if (clip.kind === 'text') {
        event.clipboardData.setData('text/plain', clip.text);
      }
      event.clipboardData.setData(BLOCK_MIME, entry.serialized || JSON.stringify({ internal: entry.token }));
      copiedRef.current = true;
      if (event.type === 'cut') {
        actions.removeEdit(latest.current.selectedId);
      }
    };

    // What the clipboard holds: {entry} for a block, {file} for a picture, {text} for other text, or null.
    const resolvePaste = (data) => {
      const internal = clipRef.current;
      const custom = data.getData(BLOCK_MIME);
      if (custom) {
        if (internal && (custom === internal.serialized || markerToken(custom) === internal.token)) {
          return { entry: internal.entry };
        }
        const clip = parseClip(custom);
        if (clip) {
          return { entry: remember(clip, custom).entry };
        }
      }
      const file = Array.from(data.files || []).find((item) => item.type && item.type.startsWith('image/'));
      if (file) {
        return { file };
      }
      const text = data.getData('text/plain') || '';
      if (internal && internal.text !== null && normalizeText(text) === internal.text) {
        return { entry: internal.entry };
      }
      if (text.trim() !== '') {
        return { text };
      }
      // A copied image whose marker the browser did not keep.
      if (text === '' && internal && internal.entry.clip.kind === 'image') {
        return { entry: internal.entry };
      }
      return null;
    };

    const pasteText = (text, pageNumber) => {
      const page = latest.current.doc.pages[pageNumber - 1];
      const clip = clipOfText(text.slice(0, MAX_TEXT_LENGTH), latest.current.textStyle, visibleCentre(pageNumber, page));
      const layout = layoutText(clip);
      const centred = { ...clip, textX: clip.textX - layout.width / 2, baseline: clip.baseline - layout.height / 2 };
      place(remember(centred).entry, pageNumber);
    };

    const pasteImageFile = (file, pageNumber) => {
      const current = latest.current.doc;
      loadImage(file).then((image) => {
        if (latest.current.doc !== current) {
          return;
        }
        const page = current.pages[pageNumber - 1];
        const edit = createImageEdit(image, visibleCentre(pageNumber, page), pageNumber, page);
        dispatch({ type: 'add', edit });
        setSelectedId(edit.id);
        setPendingImage(null);
        setTool('select');
      }).catch((error) => setBanner({ kind: 'error', text: error.message }));
    };

    const onPaste = (event) => {
      const target = event.target;
      const inEditor = Boolean(editorRef.current) && isEditorField(target);
      if (!latest.current.doc || !event.clipboardData || (!inEditor && isTypingTarget(target))) {
        return;
      }
      const found = resolvePaste(event.clipboardData);
      if (!found) {
        return;
      }
      // In the editor, text is typed in; a whole block or a picture becomes a new block next to it.
      if (inEditor && (found.text !== undefined || (found.entry && found.entry.clip.fragment))) {
        return;
      }
      event.preventDefault();
      const pageNumber = targetPage();
      actions.commitEditor();
      if (found.entry) {
        place(found.entry, pageNumber);
      } else if (found.file) {
        pasteImageFile(found.file, pageNumber);
      } else {
        pasteText(found.text, pageNumber);
      }
    };

    // The Copy button: the browser's copy command (which runs onCopy), or else the copy kept here.
    const copyFromBar = () => {
      copiedRef.current = false;
      try {
        if (typeof document.execCommand === 'function') {
          document.execCommand('copy');
        }
      } catch (error) {
        // Not allowed here; the copy is kept here only.
      }
      if (copiedRef.current) {
        return;
      }
      const field = editorRef.current ? document.querySelector('[data-editor-text]') : null;
      const clip = currentClip(field);
      if (!clip) {
        return;
      }
      remember(clip);
      if (clip.kind === 'text' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(clip.text).catch(() => {});
      }
    };

    const pasteFromBar = () => {
      if (!clipRef.current || !latest.current.doc) {
        return;
      }
      const pageNumber = targetPage();
      actions.commitEditor();
      place(clipRef.current.entry, pageNumber);
    };

    const duplicate = (edit) => {
      const clip = edit && clipOfEdit(edit);
      if (clip) {
        place(createClipEntry(clip), edit.page);
      }
    };

    return { onCopy, onPaste, copyFromBar, pasteFromBar, duplicate };
  }, [actions]);

  useEffect(() => {
    document.addEventListener('copy', clipboard.onCopy);
    document.addEventListener('cut', clipboard.onCopy);
    document.addEventListener('paste', clipboard.onPaste);
    return () => {
      document.removeEventListener('copy', clipboard.onCopy);
      document.removeEventListener('cut', clipboard.onCopy);
      document.removeEventListener('paste', clipboard.onPaste);
    };
  }, [clipboard]);

  useEffect(() => {
    const onKeyDown = (event) => {
      // Already handled, e.g. by the text editor or a drop-down.
      if (event.defaultPrevented) {
        return;
      }
      const { doc: current, edits: list, pendingImage: image, selectedId: selection } = latest.current;
      const session = editorRef.current;
      if (event.key === 'Escape') {
        if (session) {
          actions.cancelEditor();
        } else if (image) {
          setPendingImage(null);
          setTool('select');
        } else if (selection) {
          setSelectedId(null);
        }
        return;
      }
      if (!current || isTypingTarget(event.target)) {
        return;
      }
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const selected = !session && selection ? list.find((edit) => edit.id === selection) : null;
      if (modifier && key === 'z') {
        event.preventDefault();
        if (!session) {
          dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
        }
      } else if (modifier && key === 'y') {
        event.preventDefault();
        if (!session) {
          dispatch({ type: 'redo' });
        }
      } else if (!selected) {
        // The keys below act on the selection.
      } else if (modifier && key === 'd') {
        event.preventDefault();
        clipboard.duplicate(selected);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        actions.removeEdit(selected.id);
      } else if (event.key === 'Enter' && isTextType(selected) && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        setTool('select');
        actions.openEditor(sessionForEdit(selected));
      } else if (ARROWS[event.key] && !modifier && !event.altKey) {
        event.preventDefault();
        const step = event.shiftKey ? BIG_NUDGE : NUDGE;
        const [dx, dy] = ARROWS[event.key];
        actions.updateEdit(selected.id, moveEditPatch(selected, dx * step, dy * step));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions, clipboard]);

  const restoreEditorFocus = useCallback(() => {
    const field = document.querySelector('[data-editor-text]');
    if (field) {
      field.focus({ preventScroll: true });
    }
  }, []);

  const chooseTool = (id) => {
    setTool(id);
    setSelectedId(null);
    if (id !== 'image') {
      setPendingImage(null);
    }
  };

  const onImageChosen = async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    try {
      const image = await loadImage(file);
      setPendingImage(image);
      setSelectedId(null);
      setTool('image');
      setBanner(null);
    } catch (error) {
      setBanner({ kind: 'error', text: error.message });
    }
  };

  const onFileChosen = (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (file) {
      requestOpen(file);
    }
  };

  const zoomIn = () => zoomTo(ZOOM_STEPS.find((step) => step > scale + 0.001) ?? MAX_SCALE);
  const zoomOut = () => zoomTo([...ZOOM_STEPS].reverse().find((step) => step < scale - 0.001) ?? MIN_SCALE);

  // Only one export runs at a time.
  const runExport = async (kind, task) => {
    if (exporting.current) {
      return;
    }
    exporting.current = true;
    setBusy(kind);
    setBanner(null);
    try {
      await task();
    } catch (error) {
      console.error('Export failed', error);
      setBanner({ kind: 'error', text: error.message || 'The export failed.' });
    } finally {
      exporting.current = false;
      setBusy(null);
    }
  };

  const editedPdf = async () => {
    if (edits.length === 0) {
      return { blob: new Blob([doc.bytes], { type: 'application/pdf' }), warnings: [] };
    }
    return applyEdits(doc.bytes, edits.map((edit) => toPayload(edit, doc.pages[edit.page - 1])));
  };

  const report = (text, warnings) => {
    if (warnings.length > 0) {
      setBanner({ kind: 'warning', text: `${text} Some content could not be reproduced exactly:`, details: warnings });
    } else {
      setBanner({ kind: 'success', text });
    }
  };

  const exportPdf = () => runExport('pdf', async () => {
    const { blob, warnings } = await editedPdf();
    const filename = `${baseName(doc.name)}${edits.length > 0 ? '-edited' : ''}.pdf`;
    downloadBlob(blob, filename);
    setSavedEdits(edits);
    report(`Saved ${filename}.`, warnings);
  });

  const exportPngs = () => runExport('png', async () => {
    const { blob, warnings } = await editedPdf();
    const exported = await openDocument(await readBytes(blob));
    try {
      const digits = String(exported.numPages).length;
      for (let number = 1; number <= exported.numPages; number += 1) {
        setBanner({ kind: 'info', text: `Exporting page ${number} of ${exported.numPages}…` });
        const page = await exported.getPage(number);
        const natural = page.getViewport({ scale: 1 });
        const pageScale = Math.min(2, MAX_PNG_SIDE / Math.max(natural.width, natural.height));
        const viewport = page.getViewport({ scale: pageScale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({
          canvasContext: canvas.getContext('2d', { alpha: false }),
          viewport,
          background: '#ffffff',
        }).promise;
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
        if (!blob) {
          throw new Error(`Page ${number} is too large to be converted to an image.`);
        }
        downloadBlob(blob, `${baseName(doc.name)}-page-${String(number).padStart(digits, '0')}.png`);
        await delay(PNG_DOWNLOAD_GAP_MS);
      }
      setSavedEdits(edits);
      report(`Saved ${plural(exported.numPages, 'PNG image')}.`, warnings);
    } finally {
      exported.destroy();
    }
  });

  // What the format bar works on.
  let format;
  if (editor) {
    format = { kind: 'editor', style: normalizeStyle(editor), rotation: editor.rotation || 0, opacity: editor.opacity ?? 1 };
  } else if (selectedEdit && isTextType(selectedEdit)) {
    format = {
      kind: 'text',
      style: normalizeStyle(selectedEdit),
      rotation: selectedEdit.rotation || 0,
      opacity: selectedEdit.opacity ?? 1,
    };
  } else if (selectedEdit && selectedEdit.type === 'addImage') {
    format = { kind: 'image', rotation: selectedEdit.rotation || 0, opacity: selectedEdit.opacity ?? 1 };
  } else if (selectedEdit) {
    format = { kind: 'region' };
  } else {
    format = { kind: 'none', style: normalizeStyle(textStyle) };
  }
  const formatKey = editor ? `editor-${editor.key}` : (selectedEdit && selectedEdit.id) || 'none';

  const onFormatChange = (patch, options = {}) => {
    const session = editorRef.current;
    if (session) {
      actions.patchEditor('rotation' in patch
        ? rotateEditPatch({ ...blockOf(session, editorTextRef.current), type: 'addText' }, patch.rotation)
        : patch);
    } else if (selectedEdit) {
      actions.updateEdit(
        selectedEdit.id,
        'rotation' in patch ? rotateEditPatch(selectedEdit, patch.rotation) : patch,
        options,
      );
    } else {
      setTextStyle((current) => normalizeStyle({ ...current, ...patch }));
    }
  };

  const onFormatDelete = () => {
    if (editorRef.current) {
      // An emptied block is removed (or, for original text, erased) when it is applied.
      editorTextRef.current = '';
      actions.commitEditor();
    } else if (selectedEdit) {
      actions.removeEdit(selectedEdit.id);
    }
  };

  let hint = TOOLS.find((item) => item.id === tool).hint;
  if (editor) {
    hint = EDITING_HINT;
  } else if (selectedEdit && tool === 'select') {
    hint = SELECTION_HINT;
  }
  const disabled = !doc || Boolean(busy);

  return (
    <div className="app">
      <header className="app-header">
        <div className="toolbar" role="toolbar" aria-label="PDF editor">
          <h1 className="app-title">PDF Editor</h1>
          <button
            type="button"
            className="btn primary"
            onClick={() => fileInput.current.click()}
            disabled={busy === 'load' || busy === 'pdf' || busy === 'png'}
          >
            Upload PDF
          </button>

          <div className="tool-group" role="group" aria-label="Tools">
            {TOOLS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="btn"
                aria-pressed={tool === item.id}
                title={item.hint}
                disabled={disabled}
                onClick={() => (item.id === 'image' ? imageInput.current.click() : chooseTool(item.id))}
              >
                {item.label}
              </button>
            ))}
            <input
              type="color"
              className="color-input"
              aria-label="Highlight color"
              title="Highlight color"
              value={highlightColor}
              disabled={disabled}
              onChange={(event) => setHighlightColor(event.target.value)}
            />
          </div>

          <div className="tool-group" role="group" aria-label="History">
            <button
              type="button"
              className="btn"
              title="Undo (Ctrl+Z)"
              disabled={disabled || history.past.length === 0}
              onClick={() => dispatch({ type: 'undo' })}
            >
              Undo
            </button>
            <button
              type="button"
              className="btn"
              title="Redo (Ctrl+Shift+Z)"
              disabled={disabled || history.future.length === 0}
              onClick={() => dispatch({ type: 'redo' })}
            >
              Redo
            </button>
          </div>

          <div className="tool-group" role="group" aria-label="Zoom">
            <button type="button" className="btn" aria-label="Zoom out" disabled={disabled || scale <= MIN_SCALE} onClick={zoomOut}>
              −
            </button>
            <span className="zoom-level" aria-live="polite">{Math.round(scale * 100)}%</span>
            <button type="button" className="btn" aria-label="Zoom in" disabled={disabled || scale >= MAX_SCALE} onClick={zoomIn}>
              +
            </button>
            <button type="button" className="btn" disabled={disabled} onClick={() => zoomTo(fitScale(doc.pages))}>
              Fit
            </button>
          </div>

          <div className="tool-group" role="group" aria-label="Export">
            <button type="button" className="btn primary" disabled={disabled} onClick={exportPdf}>
              {busy === 'pdf' ? 'Exporting…' : 'Export PDF'}
            </button>
            <button type="button" className="btn" disabled={disabled} onClick={exportPngs}>
              {busy === 'png' ? 'Exporting…' : 'Export PNGs'}
            </button>
          </div>

          <input
            ref={fileInput}
            type="file"
            hidden
            accept="application/pdf,.pdf"
            aria-label="PDF file"
            onChange={onFileChosen}
          />
          <input
            ref={imageInput}
            type="file"
            hidden
            accept="image/*"
            aria-label="Image file"
            onChange={onImageChosen}
          />
        </div>

        {doc && (
          <FormatBar
            key={formatKey}
            kind={format.kind}
            style={format.style}
            rotation={format.rotation}
            opacity={format.opacity}
            canPaste={canPaste && !busy}
            onChange={onFormatChange}
            onCopy={clipboard.copyFromBar}
            onPaste={clipboard.pasteFromBar}
            onDuplicate={() => clipboard.duplicate(selectedEdit)}
            onDelete={onFormatDelete}
            onDone={actions.commitEditor}
            restoreFocus={restoreEditorFocus}
          />
        )}

        <div className="status-row">
          <span className="hint">
            {busy === 'load' ? 'Opening PDF…' : doc ? hint : 'Open a PDF to start editing.'}
          </span>
          {doc && (
            <span className="doc-info" title={doc.name}>
              {doc.name} · {plural(doc.pages.length, 'page')} · {plural(edits.length, 'edit')}
            </span>
          )}
        </div>

        {banner && (
          <div className={`banner ${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}>
            <div className="banner-text">
              <span>{banner.text}</span>
              {banner.details && (
                <ul>
                  {banner.details.map((detail, i) => <li key={i}>{detail}</li>)}
                </ul>
              )}
            </div>
            <button type="button" className="banner-close" aria-label="Dismiss message" onClick={() => setBanner(null)}>
              ×
            </button>
          </div>
        )}
      </header>

      <main className="workspace" aria-busy={busy === 'load'}>
        {doc ? (
          <div className="pages">
            {doc.pages.map((page) => (
              <PdfPage
                key={`${doc.id}-${page.number}`}
                page={page}
                scale={scale}
                tool={tool}
                edits={editsByPage.get(page.number) || NO_EDITS}
                editor={editor && editor.page === page.number ? editor : null}
                selectedId={selectedEdit && selectedEdit.page === page.number ? selectedEdit.id : null}
                pendingImage={pendingImage}
                highlightColor={highlightColor}
                textStyle={textStyle}
                fontEpoch={epoch}
                actions={actions}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h2>Edit a PDF in your browser</h2>
            <p>
              Change text, erase or highlight areas, and add text or images. Move, resize, rotate and restyle what you
              add. Your edits are applied when you export.
            </p>
            <button type="button" className="btn primary large" onClick={() => fileInput.current.click()} disabled={busy === 'load'}>
              Upload PDF
            </button>
            <p className="muted">or drop a PDF file anywhere on this page</p>
          </div>
        )}
      </main>

      {dragging && <div className="drop-overlay" aria-hidden="true">Drop a PDF to open it</div>}
    </div>
  );
}
