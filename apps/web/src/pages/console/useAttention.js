import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { attentionService, onConsoleChange } from '../../api/attentionApi';
import { useCameBack } from './useCameBack';
import { useLiveNews } from './liveNews';

// WHAT WAITS, read once for the whole console (ROADMAP V1-d). The shell reads it and hands it
// to the menu, the bell and More. It is read again when staff move to another page, open the
// bell, change something, come back to the window, or the business's live line says
// memberships or people changed; never on a timer ("Pages stay current by themselves"). A read that fails keeps
// the last answer, or none: a count is a nudge, and its page states its own case.

/** A press can write twice (a payment and its receipt); one read follows them both. */
const AFTER_CHANGE_MS = 400;

export const AttentionContext = createContext({ attention: null, counts: {}, reload: () => undefined });

/** The shell's one read. `attention` is null until it answers, and for another business's. */
export function useAttentionRead(gymId, active) {
  const [state, setState] = useState({ gymId: null, attention: null });
  const asked = useRef(0);
  const on = active && typeof gymId === 'string' && gymId !== '';

  const reload = useCallback(() => {
    if (!on) return;
    asked.current += 1;
    const mine = asked.current;
    attentionService.get(gymId).then(
      (attention) => {
        // Only the newest ask is drawn: an older answer arriving late never overwrites it.
        if (mine === asked.current) setState({ gymId, attention });
      },
      () => undefined,
    );
  }, [gymId, on]);

  // On arrival, and on every move to another page.
  const { pathname } = useLocation();
  useEffect(() => {
    reload();
  }, [reload, pathname]);
  useCameBack(on, reload);
  // After staff change something, once the changes of one press have landed.
  useEffect(() => {
    if (!on) return undefined;
    let timer = null;
    const stop = onConsoleChange(() => {
      clearTimeout(timer);
      timer = setTimeout(reload, AFTER_CHANGE_MS);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [on, reload]);
  useLiveNews(
    gymId,
    (message) => {
      if (message.what === 'memberships' || message.what === 'people') reload();
    },
    on,
  );

  return { attention: state.gymId === gymId ? state.attention : null, reload };
}

/** What the shell read, for a page inside it (More). */
export function useAttention() {
  return useContext(AttentionContext);
}
