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
// month rather than on the earliest allowed one.
export default function DatePick({ label, value, min, max, today, onChange, disabled, emptyText, onClear, yearSelect }) {
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
        className="w-full rounded-lg px-3 py-2 text-sm inline-flex items-center justify-between gap-2 text-left"
        style={{ ...boxStyle, color: value ? '#fff' : 'rgba(255,255,255,0.45)', opacity: disabled ? 0.5 : 1 }}
      >
        <span>{text}</span>
        <Calendar aria-hidden="true" className="w-4 h-4 flex-shrink-0" style={{ color: '#FF8A1F' }} />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={`${label}: pick a date`}
          className="mt-2 w-72 max-w-full rounded-xl p-3"
          style={{ background: '#141210', border: '1px solid rgba(255,255,255,0.10)' }}
        >
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setMonth(shiftMonth(month, -1))}
              disabled={!canBack}
              className="rounded-lg p-1.5"
              style={{ color: canBack ? '#FF8A1F' : 'rgba(255,255,255,0.2)' }}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold flex items-center gap-2" style={{ color: '#fff' }}>
              {yearSelect ? monthTitle(month).split(' ')[0] : monthTitle(month)}
              {yearSelect ? (
                <select
                  aria-label="Year"
                  value={Number(month.slice(0, 4))}
                  onChange={(e) => setMonth(withYear(month, e.target.value))}
                  className="rounded-md px-1 py-0.5 text-sm"
                  style={boxStyle}
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
              className="rounded-lg p-1.5"
              style={{ color: canForward ? '#FF8A1F' : 'rgba(255,255,255,0.2)' }}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_HEADS.map((head) => (
              <span key={head} aria-hidden="true" className="text-[11px] py-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
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
                    className="rounded-lg py-1.5 text-sm"
                    style={{
                      background: picked ? '#FF8A1F' : 'transparent',
                      color: picked ? '#0A0908' : allowed ? '#fff' : 'rgba(255,255,255,0.2)',
                      border: isToday && !picked ? '1px solid rgba(255,138,31,0.5)' : '1px solid transparent',
                      fontWeight: picked ? 600 : 400,
                    }}
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
              className="mt-2 text-sm"
              style={{ color: 'rgba(255,255,255,0.65)' }}
            >
              {emptyText ?? 'Clear'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
