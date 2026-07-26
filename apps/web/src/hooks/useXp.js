import { useEffect, useState } from 'react';
import { gamificationService, readXpView } from '../api/gamificationApi';

/** The current user's XP/level block from GET /v1/gamification/me, or NULL.
 *
 *  Deliberately its OWN request rather than a value on AuthContext — but NOT
 *  for the reason first written here. That comment said an AuthContext value
 *  "read once at session adoption goes stale on every sync", implying this hook
 *  does better. **It does not, and round 2 was right to call it:** the effect
 *  has `[]` deps and `Sidebar` mounts in `AppLayout` and never unmounts across
 *  navigation, so the sidebar level is equally stale after a sync until a full
 *  reload. The two options differ only in WHEN the single read happens.
 *
 *  The honest reason to keep it here: it is CONTAINED. AuthContext is shared by
 *  every screen and its session-adoption sequence is load-bearing (flush timing,
 *  the onboarding gate), so adding a read there is Card-2/6 work Kd ruled out of
 *  this card. The staleness is real either way and is recorded on OWED.md as
 *  its own line rather than papered over here.
 *
 *  Three components mount this today (Sidebar always; GamificationStrip and
 *  Achievements on their pages), so a page load makes at most two requests;
 *  request-dedupe is on OWED.md rather than built here, because an unproven
 *  cache is worse than a cheap authenticated GET.
 *
 *  `status` IS RETURNED, and the history matters because it has been wrong in
 *  both directions. The FIRST version returned a `loading` flag every consumer
 *  ignored, so an in-flight request rendered the same "XP unavailable" text as a
 *  failed one — a failure CLAIM during a healthy load (T3 ④). Round 1 removed
 *  the flag and neutralised the wording, which fixed that. But round 4 F7 caught
 *  what removing it cost: `{xp}` alone collapses THREE states into two, exactly
 *  the defect round 3 F2 had just fixed on the OLD payload via oldPayloadState.
 *  Both consumers then wrote `loading && !xp`, where `loading` is the OLD read's
 *  — so with the old backend accepting the connection and never answering (mlApi
 *  sets no timeout — verified, nutritionApi is the only client in src/api that
 *  sets one) and the XP read failing, Achievements spun forever and the strip
 *  returned null forever: no dash, no notice, no header.
 *
 *  Three states, never two — the same shape as oldPayloadState, for the same
 *  reason. The em-dash rendering stays: 'loading' and 'failed' both show a dash,
 *  because both mean "we are not showing you a number". `status` exists so a
 *  caller can tell whether anything is still COMING, which is a different
 *  question from what to print, and is the one the spinner gates need.
 *
 *  A failed request is logged, never swallowed silently, and never surfaced as
 *  a user-facing error: the callers have no error affordance and "unknown" is
 *  the honest rendering either way. */
export function useXp() {
  const [xp, setXp]         = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    gamificationService
      .getMe()
      .then((res) => {
        if (cancelled) return;
        // A 200 whose `xp` block is missing or malformed is a FAILED read, not a
        // ready one — readXpView returning null means we have no number, and
        // saying "ready" about it would re-create the ④ claim in reverse.
        const view = readXpView(res.data);
        setXp(view);
        setStatus(view === null ? 'failed' : 'ready');
      })
      .catch((err) => {
        // Message only — the error object carries the request config (R3.10).
        console.error('xp read failed:', err?.message);
        if (!cancelled) setStatus('failed');
      });
    return () => { cancelled = true; };
  }, []);

  return { xp, status };
}
