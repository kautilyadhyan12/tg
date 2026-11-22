// A page drawn over the page it was opened from (spec Part 3 §17.11, a member's page, V2a): it
// takes the page's place under the bar across the top, beside the menu, while the page under it
// stays as it was, hidden, and comes back as it was when this one closes. The console's shell
// gives the place (`slot`) and the name of the page it is opened from (`label`, for "← Members &
// staff"); outside the shell there is none, and the page draws over the whole window instead.
import { createContext, useContext, useEffect, useRef, useState } from 'react';

export const PageOverContext = createContext(null);

export const usePageOver = () => useContext(PageOverContext);

/** The menu's name for the page at `pathname`: the line whose address it is, or starts with. */
export function pageLabelFor(pages, pathname) {
  let best = null;
  for (const page of pages) {
    const to = typeof page.to === 'string' ? page.to.split(/[?#]/)[0] : '';
    if (to === '') continue;
    const fits = pathname === to || (page.end !== true && pathname.startsWith(`${to}/`));
    if (fits && (best === null || to.length > best.to.length)) best = { to, label: page.label };
  }
  return best === null ? null : best.label;
}

/** The shell's side of it: the place a page draws into, how many are open (the page under them is
 *  hidden while any is), and what the shell keeps right while one is open.
 *  - The window scrolls: a box under it that locked the window's scrolling (Invite to app opens a
 *    person's page from inside its own box) gets its lock back when the page closes.
 *  - A page left by a link (a menu line, a name under Payer) leaves its step of the browser's history
 *    behind the new page; Back or Forward onto that step goes on past it, the way the person was going. */
export function usePageOverShell(label) {
  const [slot, setSlot] = useState(null);
  const [open, setOpen] = useState(0);
  const openNow = useRef(0);
  const lastIdx = useRef(null);
  useEffect(() => {
    openNow.current = open;
  });
  // Where the browser's history stood before the last move: read after every drawing of the shell.
  useEffect(() => {
    lastIdx.current = typeof window.history.state?.idx === 'number' ? window.history.state.idx : null;
  });
  useEffect(() => {
    const onMove = () => {
      const state = window.history.state;
      const idx = typeof state?.idx === 'number' ? state.idx : null;
      if (openNow.current === 0 && typeof state?.personPage === 'string') {
        // The step a page that is no longer open stood for: the same place as the page under it.
        if (idx !== null && lastIdx.current !== null && idx < lastIdx.current) window.history.back();
        else window.history.forward();
        return;
      }
      lastIdx.current = idx;
    };
    window.addEventListener('popstate', onMove);
    return () => window.removeEventListener('popstate', onMove);
  }, []);
  const anyOpen = open > 0;
  useEffect(() => {
    if (!anyOpen) return undefined;
    const was = document.body.style.overflow;
    document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = was;
    };
  }, [anyOpen]);
  return {
    setSlot,
    hidden: anyOpen,
    pageOver: {
      slot,
      label,
      open: () => {
        setOpen((n) => n + 1);
        return () => setOpen((n) => n - 1);
      },
    },
  };
}
