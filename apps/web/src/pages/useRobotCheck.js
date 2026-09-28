import { useCallback, useEffect, useRef, useState } from 'react';

// Cloudflare Turnstile's box on a gym page's form (ROADMAP 20c-iv-a). Its script is
// loaded once, from Cloudflare, only on the pages that show the form; the box gives a
// token the server checks once. A token is spent by a send, so after any send that
// did not go through the box is reset for a new one.

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading = null;

function loadTurnstile() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading === null) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('no turnstile')));
      script.onerror = () => {
        loading = null;
        reject(new Error('turnstile did not load'));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

/** `{ boxRef, token, failed, blocked, reset }`: put `boxRef` on an empty div. `blocked`:
 *  Cloudflare's script never loaded (a blocker), so trying again cannot help. */
export function useRobotCheck(siteKey) {
  const boxRef = useRef(null);
  const widgetId = useRef(null);
  const [token, setToken] = useState(null);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!siteKey || boxRef.current === null) return undefined;
    let gone = false;
    loadTurnstile().then(
      (turnstile) => {
        if (gone || boxRef.current === null) return;
        widgetId.current = turnstile.render(boxRef.current, {
          sitekey: siteKey,
          action: 'enquiry',
          callback: (value) => {
            setFailed(false);
            setToken(value);
          },
          'expired-callback': () => setToken(null),
          'error-callback': () => {
            setToken(null);
            setFailed(true);
          },
        });
      },
      () => {
        if (!gone) setBlocked(true);
      },
    );
    return () => {
      gone = true;
      if (widgetId.current !== null && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  const reset = useCallback(() => {
    setToken(null);
    if (widgetId.current !== null && window.turnstile) window.turnstile.reset(widgetId.current);
  }, []);

  return { boxRef, token, failed, blocked, reset };
}
