import { createContext, useCallback, useContext, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
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

/** The boxes open now, the newest last: only the newest takes Escape and Tab (a member's page opened
 *  from a box in the middle, over it). */
const OPEN_BOXES = [];

/** Keys while a box is open: focus moves into it, Tab stays inside it, Escape asks to close
 *  it, and focus goes back to what had it when the box closes. */
/** `opener`: what had the keys when the box was first drawn, where that was read before the page changed under it. */
function useBoxKeys(boxRef, onEscape, ready, opener = null) {
  const escape = useRef(onEscape);
  useLayoutEffect(() => {
    escape.current = onEscape;
  });
  useEffect(() => {
    if (!ready) return undefined;
    const before = opener ?? document.activeElement;
    const me = {};
    OPEN_BOXES.push(me);
    const box = boxRef.current;
    if (box !== null) {
      const first = box.querySelector('[data-autofocus]') ?? box.querySelector(FOCUSABLE);
      (first ?? box).focus();
    }
    const onKey = (event) => {
      const el = boxRef.current;
      if (el === null || OPEN_BOXES[OPEN_BOXES.length - 1] !== me) return;
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
      OPEN_BOXES.splice(OPEN_BOXES.indexOf(me), 1);
      if (!(before instanceof HTMLElement)) return;
      if (before.isConnected) {
        before.focus();
        return;
      }
      // The button that opened it was drawn again while it was open (a ⋯ on a row): the keys go to the one by its name.
      const name = before.getAttribute('aria-label');
      if (name === null) return;
      requestAnimationFrame(() => {
        [...document.querySelectorAll('button[aria-label]')].find((el) => el.getAttribute('aria-label') === name)?.focus();
      });
    };
  }, [boxRef, ready, opener]);
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
 *  page behind it does nothing. `formId` makes Save submit that form; otherwise `onSave`.
 *  `saveLabel` null draws no Save (a question in the panel has its own buttons);
 *  `cancelLabel` draws a button at the foot that closes it as the X does, asking first.
 *  `closeRef.current.close()` is that same close, for a button in the form that leaves it;
 *  `leave(then)` asks the same, and goes to `then` in place of `onClose`; `unsaved` is read
 *  by the page's own ways out (the browser's Back). */
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
  cancelLabel = null,
  testId = undefined,
  closeRef = null,
  children,
}) {
  const boxRef = useRef(null);
  const titleId = useId();
  const [asking, setAsking] = useState(false);
  // Where "Close without saving" goes: the panel's own close, or the place `leave` was given.
  const leaveTo = useRef(null);
  const { ready, draw } = useLookHost();
  const tryClose = () => {
    if (busy) return;
    leaveTo.current = null;
    if (unsaved) setAsking(true);
    else onClose();
  };
  const tryLeave = (then) => {
    if (busy) return;
    leaveTo.current = then;
    if (unsaved) setAsking(true);
    else then();
  };
  useBoxKeys(boxRef, tryClose, ready);
  useStillPage();
  useImperativeHandle(closeRef, () => ({ close: tryClose, leave: tryLeave, unsaved }));

  return draw(
    <>
      <div className="c-scrim" />
      <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="c-panel" data-testid={testId}>
        <div className="c-panel-h">
          <div className="c-stack-xs flex-grow">
            <h2 id={titleId} className="c-h1" style={{ fontSize: 26, lineHeight: '32px' }}>
              {title}
            </h2>
            {sub !== null ? <p className="c-sub">{sub}</p> : null}
          </div>
          <CloseButton onClick={tryClose} />
        </div>
        <div className="c-panel-b">{children}</div>
        <div className="c-panel-f">
          {/* At the foot, which is always on screen, whichever close was pressed. */}
          {asking ? (
            <div className="c-callout w-full" role="group" aria-label="Close without saving?">
              <ConfirmInline
                newLook
                question="Your changes aren't saved. Close and lose them?"
                confirmLabel="Close without saving"
                cancelLabel="Keep editing"
                onConfirm={() => (leaveTo.current ?? onClose)()}
                onCancel={() => setAsking(false)}
              />
            </div>
          ) : null}
          {saveLabel !== null ? (
            <button
              type={formId !== undefined ? 'submit' : 'button'}
              form={formId}
              onClick={formId !== undefined ? undefined : onSave}
              disabled={busy || saveDisabled}
              className="c-btn c-btn-p c-btn-lg"
            >
              {busy ? 'Saving…' : saveLabel}
            </button>
          ) : null}
          {foot}
          {cancelLabel !== null ? (
            <button type="button" onClick={tryClose} disabled={busy} className="c-btn c-btn-s c-btn-lg">
              {cancelLabel}
            </button>
          ) : null}
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

const InMiddle = createContext(false);

/** 3a. In the middle, around a question box a page already draws (a `c-inbox`, with its own
 *  buttons): the same box, its fields and buttons unchanged, over the page. Escape and pressing
 *  outside do what its own Keep it does (`onClose`), never while it is sending. `error` is said
 *  inside it, as the page behind is covered. A box inside one already in the middle is drawn
 *  where it is, so a question that turns into another stays one box. `wide`: for two records side by side (Merge duplicate). */
export function MiddleBox({ label, onClose, busy = false, error = null, testId, role = 'alertdialog', wide = false, children }) {
  const inside = useContext(InMiddle);
  if (inside) return children;
  return (
    <MiddleShell label={label} onClose={onClose} busy={busy} error={error} testId={testId} role={role} wide={wide}>
      {children}
    </MiddleShell>
  );
}

function MiddleShell({ label, onClose, busy, error, testId, role, wide, children }) {
  const boxRef = useRef(null);
  const cancel = () => {
    if (!busy) onClose();
  };
  const { ready, draw } = useLookHost();
  // What had the keys as the box is first drawn, before the page draws again under it: a ⋯ on a row is gone by then.
  const [opener] = useState(() => document.activeElement);
  useBoxKeys(boxRef, cancel, ready, opener);
  useStillPage();
  // The box is named by its question, the first `c-inbox-t` in it, read each time it is drawn; by `label` while it
  // has none (still reading), as a name given by aria-labelledby comes before aria-label.
  const titleId = useId();
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    const title = box.querySelector('.c-inbox-t');
    if (title === null) {
      box.removeAttribute('aria-labelledby');
      return;
    }
    if (title.id === '') title.id = titleId;
    box.setAttribute('aria-labelledby', title.id);
  });
  // A question that turns into another (the bookings a cancel ends, the Terminal's wait) unmounts the button that had
  // the keys: they go to its Keep it or Back, or the box, never to the page behind.
  const shown = useRef(false);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!ready || box === null) return;
    // Not on its first draw: useBoxKeys has not yet noted the button that opened it, to give the keys back to.
    if (!shown.current) {
      shown.current = true;
      return;
    }
    if (box.contains(document.activeElement)) return;
    (box.querySelector('[data-autofocus]') ?? box).focus();
  });
  return draw(
    <InMiddle.Provider value>
      <div className="c-scrim" data-testid="box-outside" onClick={cancel} />
      <div ref={boxRef} role={role} aria-modal="true" aria-label={label} tabIndex={-1} className={wide ? "c-ask c-ask-wide" : "c-ask"} data-testid={testId}>
        <span className="c-grab" aria-hidden="true" />
        {error !== null ? (
          <p role="alert" className="c-err m-0">
            {error}
          </p>
        ) : null}
        {children}
      </div>
    </InMiddle.Provider>,
  );
}

/** 3b. In the middle, a box with a title, a close X and a foot that stays (V3a-ii, the Members
 *  bar's boxes): its words scroll between them. `wide`: a list of people in columns (Invite to
 *  app). Escape, pressing outside and the X do what `onClose` does, never while `busy`. */
export function AskSheet({ title, testId, onClose, footer, busy = false, wide = false, children }) {
  const cancel = () => {
    if (!busy) onClose();
  };
  return (
    <MiddleBox label={title} onClose={onClose} busy={busy} testId={testId} role="dialog" wide={wide}>
      <div className="c-ask-head">
        <h2 className="c-h2 c-ask-title">{title}</h2>
        <button type="button" aria-label="Close" onClick={cancel} disabled={busy} className="c-icon-btn">
          <X aria-hidden="true" className="w-5 h-5" />
        </button>
      </div>
      <div className="flex flex-col gap-5">{children}</div>
      <div className="c-ask-a c-ask-foot">{footer}</div>
    </MiddleBox>
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
