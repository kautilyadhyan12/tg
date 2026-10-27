import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSaveQueue,
  onboardingResponseSchema,
  settleEdits,
  type OnboardingAnswers,
  type OnboardingResponse,
  type PatchOnboardingRequest,
  type PlanNumbers,
  type SetupAnswers,
} from "@app/shared";
import { useSession } from "../../session/SessionProvider";

// Setup's answers as the server stores them (GET and PATCH /v1/users/me/onboarding), with the
// taps still on their way laid over the top: the browser's own rule (`useOnboardingAnswers`).
// Every save goes through ONE queue, so the last tap is always the answer stored; the plan and
// the missing list are always the server's reply to the newest save that landed.

export const LOAD_FAILED = "Couldn’t load your answers. Check your connection and try again.";
export const SAVE_FAILED = "Couldn’t save that answer. Check your connection and try again.";

/** The phone's own time zone, so a finish date is counted in the person's own day; the day itself is never sent. */
export function setupPath(zone: string = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const z = zone.trim();
  return z === "" ? "/v1/users/me/onboarding" : `/v1/users/me/onboarding?timeZone=${encodeURIComponent(z)}`;
}

type Status = "loading" | "ready" | "failed";

interface State {
  status: Status;
  /** The answers as they stood when setup opened: where the person lands. */
  first: OnboardingAnswers | null;
  server: OnboardingAnswers | null;
  plan: PlanNumbers | null;
  missing: string[];
  edits: PatchOnboardingRequest;
  /** The last save the server did not take, in words, until the next one lands. */
  problem: string | null;
}

class NotSaved extends Error {}

export function useSetupAnswers({ onSaved }: { onSaved?: (answers: OnboardingAnswers) => void } = {}) {
  const { session } = useSession();
  const [state, setState] = useState<State>({
    status: "loading",
    first: null,
    server: null,
    plan: null,
    missing: [],
    edits: {},
    problem: null,
  });
  const heard = useRef(onSaved);
  useEffect(() => {
    heard.current = onSaved;
  });

  const take = useCallback((data: OnboardingResponse) => {
    setState((s) => ({ ...s, server: data.answers, plan: data.plan, missing: data.missing }));
    heard.current?.(data.answers);
  }, []);

  const [queue] = useState(() => {
    const q = createSaveQueue<PatchOnboardingRequest, OnboardingResponse>({
      send: async (patch) => {
        const answer = await session.signedIn({ method: "PATCH", path: setupPath(), body: patch }, onboardingResponseSchema);
        if (answer.kind !== "ok") throw new NotSaved();
        return answer.data;
      },
      onSaved: (data, sent) => {
        take(data);
        // Only an answer that lands clears the line: the read-back after a refusal is not one.
        setState((s) => ({ ...s, edits: settleEdits(s.edits, sent), problem: Object.keys(sent).length === 0 ? s.problem : null }));
      },
      onFailed: (_err, sent) => {
        // The tap goes back to what the server last said, and what it holds NOW is read back:
        // a save whose reply was lost may still have landed.
        setState((s) => ({ ...s, edits: settleEdits(s.edits, sent), problem: Object.keys(sent).length === 0 ? s.problem : SAVE_FAILED }));
        if (Object.keys(sent).length > 0) q.save({});
      },
    });
    return q;
  });

  const load = useCallback(async () => {
    const answer = await session.signedIn({ method: "GET", path: setupPath() }, onboardingResponseSchema);
    if (answer.kind !== "ok") {
      setState((s) => ({ ...s, status: "failed" }));
      return;
    }
    setState((s) => ({ ...s, status: "ready", first: s.first ?? answer.data.answers }));
    take(answer.data);
  }, [session, take]);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, status: "loading" }));
    void load();
  }, [load]);

  /** One answer: shown at once, stored in turn. */
  const save = useCallback(
    (patch: PatchOnboardingRequest) => {
      setState((s) => ({ ...s, edits: { ...s.edits, ...patch } }));
      queue.save(patch);
    },
    [queue],
  );

  const answers: SetupAnswers = { ...(state.server ?? {}), ...state.edits };
  return {
    status: state.status,
    first: state.first,
    answers,
    plan: state.plan,
    missing: state.missing,
    problem: state.problem,
    save,
    settled: queue.settled,
    retry,
  };
}
