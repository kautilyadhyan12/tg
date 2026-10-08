import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// A LINK TO ONE SECTION OF A LONG PAGE (ROADMAP 23a-ii, 23b): "/settings#opening-hours" opens
// Settings with When we're open in view. The sections above it load after the page
// draws and push it down, so it is brought into view again as they settle, and never once
// the person has scrolled, pressed a key or touched the page themselves.
//
// Returns the section the address names (its element's id), or null, so the page can also
// open it.

const AGAIN_MS = [0, 400, 1200];
const THEIR_OWN = ['wheel', 'touchstart', 'pointerdown', 'keydown'];

/** The section an address names: "#staff" is "staff". */
export function sectionOf(hash) {
  if (typeof hash !== 'string' || hash.length < 2 || !hash.startsWith('#')) return null;
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return null;
  }
}

export function useSectionLink(ready) {
  // `key` is new on every press of a link, also one to the address already open.
  const { hash, key } = useLocation();
  const id = sectionOf(hash);
  useEffect(() => {
    if (!ready || id === null) return undefined;
    let theirs = false;
    const stop = () => {
      theirs = true;
    };
    for (const event of THEIR_OWN) window.addEventListener(event, stop, { passive: true });
    const timers = AGAIN_MS.map((ms) =>
      setTimeout(() => {
        if (!theirs) document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
      }, ms),
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
      for (const event of THEIR_OWN) window.removeEventListener(event, stop);
    };
  }, [ready, id, key]);
  return id;
}
