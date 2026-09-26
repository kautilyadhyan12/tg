import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { closureDateLabel } from '../../pages/console/hoursView';
import { dayAllowed, monthGrid, monthOf, monthTitle, openingMonth, shiftMonth, withYear, yearsBetween } from './datePickView';

// A date, picked from a month calendar in the console's colours and never
// typed (Kd, 17b-ii-b-ii-b's click-through). The button's value is the picked
// `YYYY-MM-DD`, or '' for none. The calendar opens in place, under the button,
// so a card that clips its edges never cuts it off.

const WEEKDAY_HEADS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const boxStyle = {
  background: '#0A0908',
  border: '1px solid rgba(255,255,255,0.10)',
  color: '#fff',
};

// `yearSelect` adds a list of the years between `min` and `max`, for a date many
// years back such as a date of birth; with it, an empty calendar opens on today's
// month rather than on the earliest allowed one. `newLook` draws it from `console.css`
// (spec Part 3 §17) on a page already restyled; other pages keep the old look until
// their own R-job.
export default function DatePick({
  label,
  value,
  min,
  max,
  today,
  onChange,
  disabled,
  emptyText,
  onClear,
  yearSelect,
  newLook = false,
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => openingMonth(value, yearSelect ? '' : min, today));
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (wrap.current !== null && !wrap.current.contains(e.target)) setOpen(false);
    };
    const escape = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const show = () => {
    if (disabled) return;
    setMonth(openingMonth(value, yearSelect ? '' : min, today));
    setOpen(!open);
  };
  const canBack = !min || shiftMonth(month, -1) >= monthOf(min);
  const canForward = !max || shiftMonth(month, 1) <= monthOf(max);
  const text = value ? closureDateLabel(value) : (emptyText ?? 'Pick a date');

  return (
    <div ref={wrap}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        value={value ?? ''}
        onClick={show}
        disabled={disabled}
        className={
          newLook
            ? `c-sel text-left ${value ? 'c-t1' : 'c-t3'}`
            : 'w-full rounded-lg px-3 py-2 text-sm inline-flex items-center justify-between gap-2 text-left'
        }
        style={
          newLook
            ? { opacity: disabled ? 0.5 : 1 }
            : { ...boxStyle, color: value ? '#fff' : 'rgba(255,255,255,0.45)', opacity: disabled ? 0.5 : 1 }
        }
      >
        <span>{text}</span>
        <Calendar
          aria-hidden="true"
          className="w-4 h-4 flex-shrink-0"
          style={{ color: newLook ? 'var(--link)' : '#FF8A1F' }}
        />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={`${label}: pick a date`}
          className={newLook ? 'c-sheet mt-2 w-80 max-w-full rounded-xl p-3' : 'mt-2 w-72 max-w-full rounded-xl p-3'}
          style={
            newLook
              ? { border: '1px solid var(--card-line)' }
              : { background: '#141210', border: '1px solid rgba(255,255,255,0.10)' }
          }
        >
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setMonth(shiftMonth(month, -1))}
              disabled={!canBack}
              className={newLook ? 'c-icon-btn' : 'rounded-lg p-1.5'}
              style={newLook ? { color: 'var(--link)', opacity: canBack ? 1 : 0.35 } : { color: canBack ? '#FF8A1F' : 'rgba(255,255,255,0.2)' }}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span
              className={newLook ? 'c-s15 c-w6 c-t1 flex items-center gap-2' : 'text-sm font-semibold flex items-center gap-2'}
              style={newLook ? undefined : { color: '#fff' }}
            >
              {yearSelect ? monthTitle(month).split(' ')[0] : monthTitle(month)}
              {yearSelect ? (
                <select
                  aria-label="Year"
                  value={Number(month.slice(0, 4))}
                  onChange={(e) => setMonth(withYear(month, e.target.value))}
                  className={newLook ? 'c-input c-s14' : 'rounded-md px-1 py-0.5 text-sm'}
                  style={newLook ? { width: 'auto', height: 36, padding: '0 8px' } : boxStyle}
                >
                  {yearsBetween(min, max).map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              ) : null}
            </span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setMonth(shiftMonth(month, 1))}
              disabled={!canForward}
              className={newLook ? 'c-icon-btn' : 'rounded-lg p-1.5'}
              style={
                newLook
                  ? { color: 'var(--link)', opacity: canForward ? 1 : 0.35 }
                  : { color: canForward ? '#FF8A1F' : 'rgba(255,255,255,0.2)' }
              }
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_HEADS.map((head) => (
              <span
                key={head}
                aria-hidden="true"
                className={newLook ? 'c-s12 c-t3 py-1' : 'text-[11px] py-1'}
                style={newLook ? undefined : { color: 'rgba(255,255,255,0.45)' }}
              >
                {head}
              </span>
            ))}
            {monthGrid(month)
              .flat()
              .map((day, i) => {
                if (day === null) return <span key={`blank-${String(i)}`} />;
                const allowed = dayAllowed(day, min, max);
                const picked = day === value;
                const isToday = day === today;
                return (
                  <button
                    key={day}
                    type="button"
                    aria-label={closureDateLabel(day)}
                    aria-pressed={picked}
                    disabled={!allowed}
                    onClick={() => {
                      onChange(day);
                      setOpen(false);
                    }}
                    className={newLook ? 'rounded-lg h-11 md:h-10 c-s14 c-num' : 'rounded-lg py-1.5 text-sm'}
                    style={
                      newLook
                        ? {
                            background: picked ? 'var(--accent)' : 'transparent',
                            color: picked ? 'var(--on-accent)' : 'var(--t1)',
                            opacity: allowed ? 1 : 0.3,
                            border: isToday && !picked ? '1px solid var(--accent)' : '1px solid transparent',
                            fontWeight: picked ? 600 : 400,
                          }
                        : {
                            background: picked ? '#FF8A1F' : 'transparent',
                            color: picked ? '#0A0908' : allowed ? '#fff' : 'rgba(255,255,255,0.2)',
                            border: isToday && !picked ? '1px solid rgba(255,138,31,0.5)' : '1px solid transparent',
                            fontWeight: picked ? 600 : 400,
                          }
                    }
                  >
                    {Number(day.slice(8))}
                  </button>
                );
              })}
          </div>
          {onClear && value ? (
            <button
              type="button"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              className={newLook ? 'c-btn c-btn-ghost mt-2 !px-0' : 'mt-2 text-sm'}
              style={newLook ? undefined : { color: 'rgba(255,255,255,0.65)' }}
            >
              {emptyText ?? 'Clear'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
