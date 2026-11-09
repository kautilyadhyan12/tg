// A run's elevation gain on its summary (ROADMAP Stage 5 item 37b-ii). The heights are the server's
// (its height map, apps/api/src/modules/geo/heights.adapter.ts), so the summary asks it with the very
// points Save will send; the server keeps nothing of the ask. With no answer yet, "--".
import { useEffect, useRef, useState } from "react";
import { runClimbResponseSchema, type RunClimbRequest, type Units } from "@app/shared";
import type { Session } from "../../session/session";

/** While a piece of the map is still coming, or there is no signal, the summary asks again this often
 *  (CLAUDE.md §4: every 30 seconds while waiting, for at most 15 minutes). */
export const CLIMB_ASK_AGAIN_MS = 30_000;
export const CLIMB_ASK_FOR_MS = 15 * 60_000;

/** `hills`: the line behind the pace chart (37c-iii), at the pace line's places. */
export type ClimbShown = { kind: "asking" } | { kind: "done"; m: number; hills: readonly number[] } | { kind: "none" };

const FEET_PER_METRE = 1 / 0.3048;

/** "28 m", or "92 ft" for a person who runs in miles; "--" with no number. */
export function climbWords(climb: ClimbShown, units: Units): string {
  if (climb.kind !== "done") return "--";
  return units === "imperial" ? `${String(Math.round(climb.m * FEET_PER_METRE))} ft` : `${String(climb.m)} m`;
}

/** The run's climb, as the server works it out from `ask`; asked again while it is not known yet. */
export function useRunClimb(session: Session | null, ask: RunClimbRequest): ClimbShown {
  const [climb, setClimb] = useState<ClimbShown>({ kind: "asking" });
  // The run the summary shows: its points do not change after Finish.
  const asked = useRef(ask);
  useEffect(() => {
    if (session === null) return undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const again = () => {
      if (Date.now() - startedAt + CLIMB_ASK_AGAIN_MS > CLIMB_ASK_FOR_MS) return;
      timer = setTimeout(() => void once(), CLIMB_ASK_AGAIN_MS);
    };
    const once = async () => {
      const answer = await session.signedIn({ method: "POST", path: "/v1/geo/runs/climb", body: asked.current, waitMs: 60_000 }, runClimbResponseSchema);
      if (stopped) return;
      if (answer.kind === "ok") {
        if (answer.data.climb.state === "done") setClimb({ kind: "done", m: answer.data.climb.m, hills: answer.data.climb.hills });
        else if (answer.data.climb.state === "none") setClimb({ kind: "none" });
        else again();
        return;
      }
      // A lost connection, a sign-in being renewed, too many at once, or a fault of the server's: again.
      if (answer.kind === "no_answer" || answer.status === 401 || answer.status === 429 || answer.status >= 500) again();
      else setClimb({ kind: "none" });
    };
    void once();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [session]);
  return climb;
}
