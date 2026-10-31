import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

const PLAIN = 'c-btn c-btn-s';
const SMALL = 'c-btn c-btn-s c-btn-sm';

/** "More ⋯": the rarer actions of a thing, as gym software keeps them out of the way. Each
 *  item says what it does in one line under its name, runs once and closes the menu.
 *  `label` null draws the ⋯ alone, small, for the end of a line; it then needs `ariaLabel`,
 *  which names the thing it is for. `alignRight` opens the list from the button's right edge.
 *  `compact`: a word on a button as small as the ⋯, for the end of a line. */
export default function MoreMenu({ items, disabled = false, label = 'More', ariaLabel, alignRight = false, compact = false }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (wrap.current !== null && !wrap.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const side = alignRight ? 'right-0' : 'right-0 sm:right-auto sm:left-0';
  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className={label === null || compact ? SMALL : PLAIN}
      >
        {label}
        <MoreHorizontal aria-hidden="true" className="w-4 h-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute ${side} top-full mt-2 w-72 max-w-[calc(100vw-32px)] rounded-[14px] p-1.5 z-10 flex flex-col`}
          style={{ background: 'var(--sheet)', border: '1px solid var(--card-line)', boxShadow: 'var(--pop)' }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onPick();
              }}
              className="w-full text-left rounded-[10px] px-3 py-2.5 min-h-[44px] flex items-start gap-3"
              style={{ color: item.danger ? 'var(--bad)' : 'var(--t1)' }}
            >
              {item.icon ? <item.icon aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <span className="w-4 flex-shrink-0" />}
              <span>
                <span className="block c-s15 c-w5">{item.label}</span>
                {item.hint ? <span className="block c-s13 c-t3">{item.hint}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
