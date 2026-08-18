import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Dark dropdown that replaces the native <select>.
 *
 * WHY THIS EXISTS: a native <select>'s popup list is drawn by the OS, not the
 * page. Windows paints the hovered row with the system accent colour (a blue
 * bar) which no CSS can override, so the list always clashed with this UI —
 * `color-scheme: dark` fixes the background but not that highlight (Kd smoke
 * finding, Card 7). Rendering our own list is the only way to control it.
 *
 * API mirrors a select: `value`, `onChange(value)`, `options: [{value, label}]`.
 * Values may be strings OR numbers (compared with ===), so a numeric field can
 * pass numbers and get numbers back.
 */
export default function Select({
  value, onChange, options, className = '', style, ariaLabel,
  // Shown when NOTHING is selected. Defaults to '' so every existing caller
  // behaves exactly as before; the console's country picker is the first field
  // here that deliberately starts empty, and a blank box with no words in it is
  // not a control a person can use.
  placeholder = '',
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = options.find((o) => o.value === value);

  // Close on outside click or Escape — a dropdown that can only be dismissed by
  // picking something is a trap.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey  = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="w-full rounded-xl px-4 py-3 text-sm flex items-center justify-between gap-2 text-left"
        style={style}
      >
        <span
          className="truncate"
          style={current === undefined ? { color: 'rgba(255,255,255,0.40)' } : undefined}
        >
          {current?.label ?? placeholder}
        </span>
        <ChevronDown className="w-4 h-4 flex-shrink-0"
                     style={{ color: 'rgba(255,255,255,0.45)' }} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-50 mt-1 w-full rounded-xl overflow-hidden py-1"
          style={{
            background: '#0A0908',
            border: '1px solid rgba(255,138,31,0.30)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.60)',
          }}
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className="w-full text-left px-4 py-2 text-sm transition-colors"
                style={{
                  background: active ? 'rgba(255,138,31,0.18)' : 'transparent',
                  color:      active ? '#FF8A1F' : 'rgba(255,255,255,0.85)',
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = 'rgba(255,138,31,0.10)';
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = 'transparent';
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
