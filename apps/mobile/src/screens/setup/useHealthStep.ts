import { useCallback, useEffect, useRef, useState } from "react";
import {
  CURRENT_DISCLAIMER_VERSION,
  consentListResponseSchema,
  consentRecordResponseSchema,
  deriveHealthFlags,
  healthScreeningResponseSchema,
  type HealthScreening,
  type PutHealthScreeningRequest,
} from "@app/shared";
import { appVersion } from "../../appExtra";
import { useSession } from "../../session/SessionProvider";

// Setup's health screen (ROADMAP Stage 5 item 14b): the one health question on its own route
// (GET and PUT /v1/users/me/health-screening), and the tick beside its note, kept in the consent
// log (POST /v1/users/me/consents). The browser's own rules (`useHealthScreening`,
// `useDisclaimerTap`): an answer shows at once and the server's reply replaces it; a save that
// fails puts back what the server holds, so the screen never keeps an answer it refused.

export const HEALTH_PATH = "/v1/users/me/health-screening";
export const CONSENTS_PATH = "/v1/users/me/consents";
export const NOTE_VERSION = CURRENT_DISCLAIMER_VERSION.health_step;
export const ANSWER_FAILED = "Couldn’t save that answer. Check your connection and try again.";
export const TICK_FAILED = "Couldn’t record that just now. Please try again.";

type Status = "loading" | "ready" | "failed";

interface State {
  status: Status;
  /** The answer as it stood when setup opened: where the person lands. */
  first: HealthScreening | null;
  screening: HealthScreening | null;
  saving: boolean;
  /** The server holds this person's tick on today's words. */
  ticked: boolean;
  ticking: boolean;
  problem: string | null;
}

export function useHealthStep() {
  const { session } = useSession();
  const [state, setState] = useState<State>({
    status: "loading",
    first: null,
    screening: null,
    saving: false,
    ticked: false,
    ticking: false,
    problem: null,
  });
  // What the SERVER last said, which a failed save falls back to.
  const stored = useRef<HealthScreening | null>(null);

  const load = useCallback(async () => {
    const [health, log] = await Promise.all([
      session.signedIn({ method: "GET", path: HEALTH_PATH }, healthScreeningResponseSchema),
      session.signedIn({ method: "GET", path: CONSENTS_PATH }, consentListResponseSchema),
    ]);
    if (health.kind !== "ok") {
      setState((s) => ({ ...s, status: "failed" }));
      return;
    }
    // A log that does not load only asks for the tick again.
    const ticked =
      log.kind === "ok" && log.data.consents.some((c) => c.purpose === "health_step" && c.wordingVersion === NOTE_VERSION);
    const { healthScreening } = health.data;
    stored.current = healthScreening;
    setState((s) => ({
      ...s,
      status: "ready",
      first: s.first ?? healthScreening,
      screening: healthScreening,
      ticked: s.ticked || ticked,
    }));
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, status: "loading" }));
    void load();
  }, [load]);

  /** One answer, the whole screening. True when the server stored it. */
  const answer = useCallback(
    async (body: PutHealthScreeningRequest): Promise<boolean> => {
      const checkFirst = body.checkFirst ?? null;
      setState((s) => ({
        ...s,
        saving: true,
        problem: null,
        screening: {
          answered: true,
          hasCondition: body.hasCondition,
          checkFirst,
          ...deriveHealthFlags({ hasCondition: body.hasCondition, checkFirst }),
          updatedAt: null,
        },
      }));
      const reply = await session.signedIn({ method: "PUT", path: HEALTH_PATH, body }, healthScreeningResponseSchema);
      if (reply.kind === "ok") {
        stored.current = reply.data.healthScreening;
        setState((s) => ({ ...s, saving: false, screening: reply.data.healthScreening }));
        return true;
      }
      setState((s) => ({ ...s, saving: false, screening: stored.current, problem: ANSWER_FAILED }));
      return false;
    },
    [session],
  );

  /** The tick beside the note, kept in the log the moment it is made. */
  const tick = useCallback(async () => {
    setState((s) => ({ ...s, ticking: true, problem: null }));
    const reply = await session.signedIn(
      { method: "POST", path: CONSENTS_PATH, body: { purpose: "health_step", wordingVersion: NOTE_VERSION, appVersion: appVersion() } },
      consentRecordResponseSchema,
    );
    setState((s) => ({ ...s, ticking: false, ticked: s.ticked || reply.kind === "ok", problem: reply.kind === "ok" ? null : TICK_FAILED }));
  }, [session]);

  return { ...state, answer, tick, retry };
}

export type HealthStep = ReturnType<typeof useHealthStep>;
