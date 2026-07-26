import { useEffect, useState } from 'react';
import { gamificationService, readXpView } from '../api/gamificationApi';

/** The current user's XP/level block from GET /v1/gamification/me, or NULL.
 *
 *  Deliberately its OWN request rather than a value on AuthContext. XP changes
 *  on every workout sync, so a value read once at session adoption goes stale
 *  and would need a refresh mechanism — genuinely the Card-2/6 widening Kd
 *  ruled out of this card (2026-07-26). Three components mount this today
 *  (Sidebar always; GamificationStrip and Achievements on their pages), so a
 *  page load makes at most two requests; request-dedupe is on OWED.md rather
 *  than built here, because an unproven cache is worse than a cheap
 *  authenticated GET.
 *
 *  NO `loading` IS RETURNED, and that is the fix for T3 finding ④ rather than
 *  an oversight. The first version returned one that every consumer ignored, so
 *  an in-flight request rendered the same "XP unavailable" text as a failed one
 *  — a failure CLAIM during a healthy load, flashing on every visit. The
 *  formatters now render both states as a neutral em dash, which is honest for
 *  both ("we are not showing you a number") and asserts nothing false. With the
 *  wording neutral there is nothing left for a loading flag to change, and
 *  returning an unconsumed one is the dead surface R1 warns about.
 *
 *  A failed request is logged, never swallowed silently, and never surfaced as
 *  an error state: the callers have no error affordance and "unknown" is the
 *  honest rendering either way. */
export function useXp() {
  const [xp, setXp] = useState(null);

  useEffect(() => {
    let cancelled = false;
    gamificationService
      .getMe()
      .then((res) => {
        if (!cancelled) setXp(readXpView(res.data));
      })
      .catch((err) => {
        // Message only — the error object carries the request config (R3.10).
        console.error('xp read failed:', err?.message);
      });
    return () => { cancelled = true; };
  }, []);

  return { xp };
}
