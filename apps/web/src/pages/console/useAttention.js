import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { attentionService, onConsoleChange } from '../../api/attentionApi';
import { useCameBack } from './useCameBack';
import { useLiveNews } from './liveNews';

// WHAT WAITS, read once for the whole console (ROADMAP V1-d). The shell reads it and hands it
// to the menu, the bell and More. It is read again at once when staff open the bell or change
// something, or the business's live line says memberships or people changed; and when they
// move to another page or come back to the window, once the last read is 30 seconds old;
// never on a timer ("Pages stay current by themselves"). A read that fails keeps the last
// answer, or none: a count is a nudge, and its page states its own case.

/** A press can write twice (a payment and its receipt); one read follows them both. */
const AFTER_CHANGE_MS = 400;
/** How old the last read must be before a move to another page or a return reads again. */
export const SOON_MS = 30_000;

export const AttentionContext = createContext({ attention: null, counts: {}, reload: () => undefined });

/** The shell's one read. `attention` is null until it answers, and for another business's. */
export function useAttentionRead(gymId, active) {
  const [state, setState] = useState({ gymId: null, attention: null });
  const asked = useRef(0);
  const readAt = useRef(0);
  const on = active && typeof gymId === 'string' && gymId !== '';

  const reload = useCallback(() => {
    if (!on) return;
    asked.current += 1;
    readAt.current = Date.now();
    const mine = asked.current;
    attentionService.get(gymId).then(
      (attention) => {
        // Only the newest ask is drawn: an older answer arriving late never overwrites it.
        if (mine === asked.current) setState({ gymId, attention });
      },
      () => undefined,
    );
  }, [gymId, on]);

  // A move to another page, or coming back to the window, reads again only once the last read
  // is `SOON_MS` old: those happen many times a minute, and each read keeps the server busy for
  // about 43 ms at a business of 200 (`tools/measure-attention-cost.ts`).
  const ifOld = useCallback(() => {
    if (Date.now() - readAt.current >= SOON_MS) reload();
  }, [reload]);
  // On arrival (and another business), at once.
  useEffect(() => {
    reload();
  }, [reload]);
  const { pathname } = useLocation();
  const seenPath = useRef(pathname);
  useEffect(() => {
    if (seenPath.current === pathname) return;
    seenPath.current = pathname;
    ifOld();
  }, [ifOld, pathname]);
  useCameBack(on, ifOld);
  // After staff change something, once the changes of one press have landed.
  useEffect(() => {
    if (!on) return undefined;
    let timer = null;
    // A change among the writes of one moment always reads again; only visits alone wait 30 s.
    let changed = false;
    const stop = onConsoleChange((kind) => {
      if (kind !== 'visit') changed = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const any = changed;
        changed = false;
        if (any) reload();
        else ifOld();
      }, AFTER_CHANGE_MS);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [on, reload, ifOld]);
  useLiveNews(
    gymId,
    (message) => {
      if (message.what === 'memberships' || message.what === 'people') reload();
      // A check-in moves somebody off At risk; a busy desk is held to one read every 30 s.
      else if (message.what === 'visits') ifOld();
    },
    on,
  );

  return { attention: state.gymId === gymId ? state.attention : null, reload };
}

/** What the shell read, for a page inside it (More). */
export function useAttention() {
  return useContext(AttentionContext);
}
