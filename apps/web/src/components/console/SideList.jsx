import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

/* The side list for a long page (Reports, Settings; the second look's rule 7): the parts of
   the page down the side on a wide screen, a row across the top otherwise that scrolls on
   its own, never the page. The part shown is lit, and on the row it is kept in view. Each
   item is `{ id, label, icon?, to? }`: with `to` it opens that address in this same tab,
   otherwise pressing it calls `onPick(id)`. */
export default function SideList({ title, items, current, onPick = undefined, children }) {
  const listRef = useRef(null);

  useEffect(() => {
    const lit = listRef.current?.querySelector('[aria-current="true"]');
    if (lit instanceof HTMLElement && typeof lit.scrollIntoView === 'function') {
      lit.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [current]);

  return (
    <div className="c-side">
      <nav className="c-snav-wrap" aria-label={title}>
        <span className="c-snav-t" aria-hidden="true">
          {title}
        </span>
        <ul ref={listRef} className="c-snav">
          {items.map((item) => {
            const Icon = item.icon;
            const lit = item.id === current;
            const inside = (
              <>
                {Icon ? <Icon aria-hidden="true" /> : null}
                <span>{item.label}</span>
              </>
            );
            return (
              <li key={item.id}>
                {item.to !== undefined ? (
                  <Link to={item.to} aria-current={lit ? 'true' : undefined}>
                    {inside}
                  </Link>
                ) : (
                  <button type="button" aria-current={lit ? 'true' : undefined} onClick={() => onPick?.(item.id)}>
                    {inside}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="c-stack" style={{ minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}
