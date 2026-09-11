// A wheel of numbers to flick, with − and + beside it (Kd, 2026-09-10:
// nothing typed and nothing pre-filled). Until the person touches it a wheel
// rests on a display-only row, dimmed, and its question reads "Not set" — the
// Settings slider's rule: nothing is saved until it is moved. A tap on a
// number picks it, a flick picks the number it settles on, and the arrow keys
// step it.
//
// A column turns under a flick only once the person has tapped or focused it,
// and a press anywhere else lets it go. An untouched column lets a scroll pass
// to the page: the wheels are full width and screen 2 is taller than a phone,
// so a column that took every scroll over it would set an answer while the
// person was only scrolling down the page.
import { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

const ROW_PX = 40;
const VISIBLE_ROWS = 5;
const PAD_PX = ((VISIBLE_ROWS - 1) / 2) * ROW_PX;
const SETTLE_MS = 120;
const KEY_STEPS = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 };

/** One column. `index` is the row on show: the answer's, or the resting row
 *  while `active` is false. */
function WheelColumn({ label, values, index, active, format, onPick }) {
  const ref = useRef(null);
  // The person's own gesture on a column they have touched, from its start
  // until the scroll it made settles, or until it ends without one. Never set
  // by code, so a scroll the code makes (a units switch) picks nothing.
  const gesture = useRef(false);
  const moved = useRef(false); // a scroll arrived during that gesture
  // A finger is on the column. A slow drag can rest for longer than SETTLE_MS
  // and then go on, so a gesture never settles while a finger is down.
  const down = useRef(false);
  const timer = useRef(null);
  const [engaged, setEngaged] = useState(false);
  const last = values.length - 1;
  const pickAt = (i) => onPick(Math.max(0, Math.min(last, i)));

  // Keep the column on its row whenever the row changes from outside: a − or +
  // tap, a units switch, an answer arriving from the server.
  useEffect(() => {
    const el = ref.current;
    if (el && Math.abs(el.scrollTop - index * ROW_PX) > 1) el.scrollTop = index * ROW_PX;
  }, [index, values.length]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // A press anywhere else lets the column go, whether or not the browser moves
  // the focus (a phone's browser may not).
  useEffect(() => {
    if (!engaged) return undefined;
    const away = (e) => {
      if (!ref.current?.contains(e.target)) setEngaged(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [engaged]);

  /** Runs once the column has been still for SETTLE_MS with no finger on it:
   *  a gesture that scrolled picks the row it stopped on, a gesture that did
   *  not simply ends, and any other scroll goes back to its row. */
  const settle = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = ref.current;
      if (!el || down.current) return;
      const at = Math.max(0, Math.min(last, Math.round(el.scrollTop / ROW_PX)));
      const flicked = gesture.current && moved.current;
      gesture.current = false;
      moved.current = false;
      if (flicked) pickAt(at);
      else if (at !== index) el.scrollTop = index * ROW_PX;
    }, SETTLE_MS);
  };
  const begin = () => {
    if (engaged) gesture.current = true;
  };
  // Touch events, not pointer events, say when the finger lifts: once the
  // browser takes a drag over to scroll it cancels the pointer at the start,
  // but the touch runs on to the lift.
  const touch = () => {
    down.current = true;
    begin();
  };
  const lift = () => {
    down.current = false;
    settle();
  };

  return (
    <div className="relative flex-1 min-w-0">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 rounded-xl"
        style={{
          top: PAD_PX,
          height: ROW_PX,
          background: active ? 'rgba(255,138,31,0.12)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${active ? 'rgba(255,138,31,0.45)' : 'rgba(255,255,255,0.08)'}`,
        }}
      />
      <div
        ref={ref}
        role="spinbutton"
        aria-label={label}
        aria-valuetext={active ? format(values[index]) : 'Not set'}
        aria-valuenow={active ? values[index] : undefined}
        aria-valuemin={values[0]}
        aria-valuemax={values[last]}
        tabIndex={0}
        onFocus={() => setEngaged(true)}
        onBlur={() => setEngaged(false)}
        onScroll={() => {
          if (gesture.current) moved.current = true;
          settle();
        }}
        onWheel={() => {
          begin();
          settle(); // a wheel that scrolls nothing (at an end) still ends the gesture
        }}
        onTouchStart={touch}
        onPointerDown={begin}
        onTouchEnd={lift}
        onTouchCancel={lift}
        onPointerUp={settle}
        onPointerCancel={settle}
        onKeyDown={(e) => {
          if (e.key in KEY_STEPS) {
            e.preventDefault();
            pickAt(index + KEY_STEPS[e.key]);
          } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            pickAt(e.key === 'Home' ? 0 : last);
          }
        }}
        className={`no-scrollbar ${engaged ? 'overflow-y-scroll' : 'overflow-y-hidden'} snap-y snap-mandatory rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500`}
        style={{
          height: ROW_PX * VISIBLE_ROWS,
          paddingBlock: PAD_PX,
          opacity: active ? 1 : 0.45,
          maskImage: 'linear-gradient(transparent, black 30%, black 70%, transparent)',
          WebkitMaskImage: 'linear-gradient(transparent, black 30%, black 70%, transparent)',
        }}
      >
        {values.map((v, i) => (
          <div
            key={`${label}-${v}`}
            onClick={() => {
              gesture.current = false;
              moved.current = false;
              setEngaged(true);
              ref.current?.focus({ preventScroll: true });
              pickAt(i);
            }}
            className={`snap-center flex items-center justify-center tabular-nums cursor-pointer select-none ${
              i === index ? 'text-white text-lg font-bold' : 'text-gray-500'
            }`}
            style={{ height: ROW_PX }}
          >
            {format(v)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A question answered on a wheel of one or more columns: the answer (or "Not
 *  set") beside the question, − and + either side. `onStep(-1 | 1)` is the
 *  screen's, because only it knows what one step is (a year, a kilo, an inch). */
export default function NumberWheel({ id, question, shown, isSet, unit, stepLabel, onStep, columns }) {
  const stepButton = (by, Icon, words) => (
    <button
      type="button"
      aria-label={`${stepLabel}: ${words}`}
      onClick={() => onStep(by)}
      className="w-12 h-12 flex-shrink-0 rounded-xl border-2 border-white/10 bg-dark-100 hover:border-white/20 flex items-center justify-center text-white"
    >
      <Icon className="w-5 h-5" strokeWidth={2} />
    </button>
  );
  return (
    <div role="group" aria-labelledby={`${id}-question`}>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p id={`${id}-question`} className="text-sm font-semibold text-white">
          {question}
        </p>
        <p
          aria-live="polite"
          className="text-sm tabular-nums whitespace-nowrap"
          style={{ color: isSet ? '#FFB347' : 'rgba(255,255,255,0.45)' }}
        >
          {shown}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {stepButton(-1, Minus, 'one less')}
        <div className="flex-1 flex items-center gap-1 min-w-0">
          {columns.map((c) => (
            <WheelColumn key={`${id}-${c.label}`} {...c} active={isSet} />
          ))}
          {unit && <span className="text-gray-400 text-sm px-1 flex-shrink-0">{unit}</span>}
        </div>
        {stepButton(1, Plus, 'one more')}
      </div>
    </div>
  );
}
