import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  // The list stays inside the screen, 16 px from its edges: a ⋯ near the left of a narrow phone
  // (a folded phone's 280 px cover) would otherwise open it past the left edge, out of reach.
  const list = useRef(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open || list.current === null) {
      setShift(0);
      return;
    }
    const r = list.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    setShift(r.left < 16 ? 16 - r.left : r.right > vw - 16 ? Math.max(16 - r.left, vw - 16 - r.right) : 0);
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
          ref={list}
          role="menu"
          className={`absolute ${side} top-full mt-2 w-72 max-w-[calc(100vw-32px)] rounded-[14px] p-1.5 z-10 flex flex-col`}
          style={{ background: 'var(--sheet)', border: '1px solid var(--card-line)', boxShadow: 'var(--pop)', transform: shift === 0 ? undefined : `translateX(${String(Math.round(shift))}px)` }}
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
                {item.hint ? <span className="block c-s14 c-t3">{item.hint}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
