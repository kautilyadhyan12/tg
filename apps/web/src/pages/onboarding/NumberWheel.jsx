// A wheel of numbers to flick, with − and + beside it (Kd, 2026-09-10:
// nothing typed and nothing pre-filled). Until the person touches it a wheel
// rests on a display-only row, dimmed, and its question reads "Not set" — the
// Settings slider's rule: nothing is saved until it is moved. A tap on a
// number picks it, a flick picks the number it settles on, and the arrow keys
// step it.
import { useEffect, useRef } from 'react';
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
  const flicking = useRef(false); // set by the person's own gesture, never by code
  const timer = useRef(null);
  const last = values.length - 1;
  const pickAt = (i) => onPick(Math.max(0, Math.min(last, i)));

  // Keep the column on its row whenever the row changes from outside: a − or +
  // tap, a units switch, an answer arriving from the server.
  useEffect(() => {
    const el = ref.current;
    if (el && Math.abs(el.scrollTop - index * ROW_PX) > 1) el.scrollTop = index * ROW_PX;
  }, [index, values.length]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const settle = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const at = Math.max(0, Math.min(last, Math.round(el.scrollTop / ROW_PX)));
      if (flicking.current) {
        flicking.current = false;
        pickAt(at);
      } else if (at !== index) {
        // A scroll the person did not make (the code's own, or a stray key)
        // picks nothing: the column goes back to its row.
        el.scrollTop = index * ROW_PX;
      }
    }, SETTLE_MS);
  };
  const flick = () => {
    flicking.current = true;
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
        onScroll={settle}
        onWheel={flick}
        onTouchStart={flick}
        onPointerDown={flick}
        onKeyDown={(e) => {
          if (e.key in KEY_STEPS) {
            e.preventDefault();
            pickAt(index + KEY_STEPS[e.key]);
          } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            pickAt(e.key === 'Home' ? 0 : last);
          }
        }}
        className="no-scrollbar overflow-y-scroll snap-y snap-mandatory rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
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
              flicking.current = false;
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
