import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ConfirmInline } from './ConsoleStates';
import { fitsUnder, placeUnder } from './consoleBoxesView';

/* The four ways a box opens in the second look (spec Part 3 §17.10; the Main board): under
   its button, from the right, in the middle, and a page of its own (StepsPage). Each one
   floats over the page and never pushes it down; Escape and the X close it, keys stay
   inside it while it is open, and the press that opened it gets the keys back after. */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const COMPUTER = '(min-width: 768px)';

function isComputer() {
  return typeof window.matchMedia === 'function' && window.matchMedia(COMPUTER).matches;
}

/** Where a box is drawn: at the end of the console's own root, so it keeps the page's look
 *  (its colours are named on that root) and no box or scroll area around it can cut it. */
function useLookHost() {
  const here = useRef(null);
  const [host, setHost] = useState(null);
  useLayoutEffect(() => {
    setHost(here.current?.closest('.c-console') ?? document.body);
  }, []);
  const draw = (box) => (
    <>
      <span ref={here} hidden />
      {host !== null ? createPortal(box, host) : null}
    </>
  );
  return { ready: host !== null, draw };
}

/** Keys while a box is open: focus moves into it, Tab stays inside it, Escape asks to close
 *  it, and focus goes back to what had it when the box closes. */
function useBoxKeys(boxRef, onEscape, ready) {
  const escape = useRef(onEscape);
  useLayoutEffect(() => {
    escape.current = onEscape;
  });
  useEffect(() => {
    if (!ready) return undefined;
    const before = document.activeElement;
    const box = boxRef.current;
    if (box !== null) {
      const first = box.querySelector('[data-autofocus]') ?? box.querySelector(FOCUSABLE);
      (first ?? box).focus();
    }
    const onKey = (event) => {
      const el = boxRef.current;
      if (el === null) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        escape.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const all = [...el.querySelectorAll(FOCUSABLE)];
      if (all.length === 0) {
        event.preventDefault();
        el.focus();
        return;
      }
      const first = all[0];
      const last = all[all.length - 1];
      if (event.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, [boxRef, ready]);
}

/** The page behind a panel or a question stays where it is while the box is open. */
function useStillPage(on = true) {
  useEffect(() => {
    if (!on) return undefined;
    const root = document.documentElement;
    const was = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = was;
    };
  }, [on]);
}

function CloseButton({ onClick, label = 'Close' }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="c-icon-btn">
      <X aria-hidden="true" className="w-5 h-5" />
    </button>
  );
}

/** 1. Under its button: one to three questions (record a payment, add a tag, pick a day).
 *  `anchorRef` is the button that opened it. Pressing outside it or Escape closes it. */
export function OpenUnder({ anchorRef, label, onClose, children }) {
  const boxRef = useRef(null);
  const [place, setPlace] = useState(null);
  const moved = useRef(false);
  const { ready, draw } = useLookHost();
  useBoxKeys(boxRef, onClose, ready);
  useStillPage(!isComputer());

  const measure = useCallback(() => {
    const anchor = anchorRef?.current;
    const box = boxRef.current;
    if (!isComputer() || anchor == null || box === null) {
      setPlace(null);
      return;
    }
    const view = { width: window.innerWidth, height: window.innerHeight };
    let at = anchor.getBoundingClientRect();
    // A short window (a phone sideways, a laptop zoomed in): when the box fits neither under
    // nor over its button, the page moves the button up once, so the box opens whole.
    if (!moved.current && !fitsUnder(at, box.scrollHeight, view) && typeof anchor.scrollIntoView === 'function') {
      moved.current = true;
      anchor.scrollIntoView({ block: 'start', behavior: 'instant' });
      at = anchor.getBoundingClientRect();
    }
    setPlace(placeUnder(at, box.scrollHeight, view));
  }, [anchorRef]);

  useLayoutEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure, ready]);

  return draw(
    <>
      <div className="c-scrim c-pop-scrim" data-testid="box-outside" onClick={onClose} />
      <div
        ref={boxRef}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        className="c-pop"
        style={place === null ? undefined : { top: place.top, left: place.left, width: place.width, maxHeight: place.maxHeight }}
      >
        <span className="c-grab" aria-hidden="true" />
        {children}
      </div>
    </>
  );
}

/** 2. From the right: a form of four fields or more (edit details, add a membership). The
 *  panel scrolls as one page; only its foot stays, with Save and, while something is not
 *  saved, "You have changes that aren't saved." Closed by its X or Escape; with changes not
 *  saved it asks first, in place, and keeps what was typed until the answer. Pressing the
 *  page behind it does nothing. `formId` makes Save submit that form; otherwise `onSave`. */
export function SidePanel({
  title,
  sub = null,
  onClose,
  unsaved = false,
  saveLabel = 'Save',
  onSave = undefined,
  formId = undefined,
  busy = false,
  saveDisabled = false,
  foot = null,
  children,
}) {
  const boxRef = useRef(null);
  const titleId = useId();
  const [asking, setAsking] = useState(false);
  const { ready, draw } = useLookHost();
  const tryClose = () => {
    if (busy) return;
    if (unsaved) setAsking(true);
    else onClose();
  };
  useBoxKeys(boxRef, tryClose, ready);
  useStillPage();

  return draw(
    <>
      <div className="c-scrim" />
      <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="c-panel">
        <div className="c-panel-h">
          <div className="c-stack-xs flex-grow">
            <h2 id={titleId} className="c-h1" style={{ fontSize: 26, lineHeight: '32px' }}>
              {title}
            </h2>
            {sub !== null ? <p className="c-sub">{sub}</p> : null}
          </div>
          <CloseButton onClick={tryClose} />
        </div>
        <div className="c-panel-b">
          {asking ? (
            <div className="c-callout" role="group" aria-label="Close without saving?">
              <ConfirmInline
                newLook
                question="Your changes aren't saved. Close and lose them?"
                confirmLabel="Close without saving"
                cancelLabel="Keep editing"
                onConfirm={onClose}
                onCancel={() => setAsking(false)}
              />
            </div>
          ) : null}
          {children}
        </div>
        <div className="c-panel-f">
          <button
            type={formId !== undefined ? 'submit' : 'button'}
            form={formId}
            onClick={formId !== undefined ? undefined : onSave}
            disabled={busy || saveDisabled}
            className="c-btn c-btn-p c-btn-lg"
          >
            {busy ? 'Saving…' : saveLabel}
          </button>
          {foot}
          {unsaved ? (
            <span role="status" className="c-s14 c-t2">
              You have changes that aren't saved.
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** 3. In the middle: a question before a change to people or money (cancel, remove, give
 *  money back). `children` names who changes and what happens. The answer that takes
 *  something away is solid red, the only place solid red is used; Escape, pressing outside
 *  and the cancel answer change nothing. */
export function Question({
  title,
  confirmLabel,
  cancelLabel = 'Keep it',
  onConfirm,
  onCancel,
  busy = false,
  danger = true,
  error = null,
  children,
}) {
  const boxRef = useRef(null);
  const titleId = useId();
  const bodyId = useId();
  const cancel = () => {
    if (!busy) onCancel();
  };
  const { ready, draw } = useLookHost();
  useBoxKeys(boxRef, cancel, ready);
  useStillPage();

  return draw(
    <>
      <div className="c-scrim" data-testid="box-outside" onClick={cancel} />
      <div
        ref={boxRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className="c-ask"
      >
        <span className="c-grab" aria-hidden="true" />
        <h2 id={titleId} className="c-h2">
          {title}
        </h2>
        <div id={bodyId} className="c-stack-s">
          {children}
        </div>
        {error !== null ? (
          <p role="alert" className="c-err">
            {error}
          </p>
        ) : null}
        <div className="c-ask-a">
          <button type="button" onClick={onConfirm} disabled={busy} className={`c-btn c-btn-lg ${danger ? 'c-btn-ds' : 'c-btn-p'}`}>
            {confirmLabel}
          </button>
          <button type="button" onClick={cancel} disabled={busy} className="c-btn c-btn-lg c-btn-s" data-autofocus>
            {cancelLabel}
          </button>
        </div>
      </div>
    </>
  );
}

/** 4. A page of its own: a big setup (a membership type, a challenge, a new gym) in
 *  numbered parts, with a summary that fills in as they go. `summary` is a list of
 *  `{ label, value }`; a value not chosen yet reads `empty`. */
export function StepsPage({ parts, summaryTitle = 'Summary', summary, empty = 'Not set yet', foot = null }) {
  return (
    <div className="c-steps">
      <div className="c-stack-l">
        {parts.map((part, i) => (
          <section key={part.key} className="c-card c-part" style={{ padding: 24 }} aria-labelledby={`part-${part.key}`}>
            <div className="c-part-h">
              <span className="c-part-n" aria-hidden="true">
                {i + 1}
              </span>
              <h2 id={`part-${part.key}`} className="c-h2">
                {part.title}
              </h2>
            </div>
            {part.children}
          </section>
        ))}
        {foot}
      </div>
      <aside className="c-card c-steps-sum c-stack-m" style={{ padding: 24 }} aria-label={summaryTitle}>
        <h2 className="c-h2">{summaryTitle}</h2>
        <dl className="c-sum">
          {summary.map((line) => (
            <div key={line.label}>
              <dt>{line.label}</dt>
              {line.value === null || line.value === undefined || line.value === '' ? (
                <dd className="c-sum-none">{empty}</dd>
              ) : (
                <dd>{line.value}</dd>
              )}
            </div>
          ))}
        </dl>
      </aside>
    </div>
  );
}
