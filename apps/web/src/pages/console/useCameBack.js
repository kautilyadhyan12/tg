import { useEffect, useRef } from 'react';

// STAFF CAME BACK TO THIS TAB OR WINDOW (ROADMAP 23a-ii, 23d). A page that waits on
// something set up elsewhere reads again when they return. Both events are listened for: a
// switch of tab does not always fire `focus` (Kd's click-through of 23d: a message stayed
// after he came back), and a switch of window does not fire `visibilitychange`. One return
// that fires both reads once.

const SAME_RETURN_MS = 500;

export function useCameBack(active, onBack) {
  // The newest callback, kept without listening again on every draw.
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });
  useEffect(() => {
    if (!active) return undefined;
    let last = 0;
    const back = () => {
      const now = Date.now();
      if (now - last < SAME_RETURN_MS) return;
      last = now;
      latest.current();
    };
    const shown = () => {
      if (document.visibilityState === 'visible') back();
    };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', shown);
    return () => {
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', shown);
    };
  }, [active]);
}
