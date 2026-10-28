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
// log (POST /v1/users/me/consents); the plan screen's tick beside its own note too (14c). The browser's own rules (`useHealthScreening`,
// `useDisclaimerTap`): an answer shows at once and the server's reply replaces it; a save that
// fails puts back what the server holds, so the screen never keeps an answer it refused.

export const HEALTH_PATH = "/v1/users/me/health-screening";
export const CONSENTS_PATH = "/v1/users/me/consents";
export const NOTE_VERSION = CURRENT_DISCLAIMER_VERSION.health_step;
export const PLAN_NOTE_VERSION = CURRENT_DISCLAIMER_VERSION.plan_screen;
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
  /** The tick as it stood when setup opened: where the person lands, so a tick never moves them on. */
  firstTicked: boolean | null;
  /** Yes tapped and "Check first" not yet picked: nothing is saved, and the question is not answered. */
  pendingYes: boolean;
  ticking: boolean;
  /** The server holds this person's tick on today's plan note. */
  planTicked: boolean;
  planTicking: boolean;
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
    firstTicked: null,
    pendingYes: false,
    ticking: false,
    planTicked: false,
    planTicking: false,
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
    const has = (purpose: string, version: string) =>
      log.kind === "ok" && log.data.consents.some((c) => c.purpose === purpose && c.wordingVersion === version);
    const ticked = has("health_step", NOTE_VERSION);
    const planTicked = has("plan_screen", PLAN_NOTE_VERSION);
    const { healthScreening } = health.data;
    stored.current = healthScreening;
    setState((s) => ({
      ...s,
      status: "ready",
      first: s.first ?? healthScreening,
      screening: healthScreening,
      ticked: s.ticked || ticked,
      firstTicked: s.firstTicked ?? ticked,
      planTicked: s.planTicked || planTicked,
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
        pendingYes: false,
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

  /** The tick beside the health note, kept in the log the moment it is made. */
  const tick = useCallback(async () => {
    setState((s) => ({ ...s, ticking: true, problem: null }));
    const reply = await session.signedIn(
      { method: "POST", path: CONSENTS_PATH, body: { purpose: "health_step", wordingVersion: NOTE_VERSION, appVersion: appVersion() } },
      consentRecordResponseSchema,
    );
    setState((s) => ({ ...s, ticking: false, ticked: s.ticked || reply.kind === "ok", problem: reply.kind === "ok" ? null : TICK_FAILED }));
  }, [session]);

  /** The tick beside the plan's note, the same way. */
  const tickPlan = useCallback(async () => {
    setState((s) => ({ ...s, planTicking: true, problem: null }));
    const reply = await session.signedIn(
      { method: "POST", path: CONSENTS_PATH, body: { purpose: "plan_screen", wordingVersion: PLAN_NOTE_VERSION, appVersion: appVersion() } },
      consentRecordResponseSchema,
    );
    setState((s) => ({
      ...s,
      planTicking: false,
      planTicked: s.planTicked || reply.kind === "ok",
      problem: reply.kind === "ok" ? null : TICK_FAILED,
    }));
  }, [session]);

  /** Yes tapped over a stored No opens the two "Check first" answers; No or a save closes them. */
  const openYes = useCallback((open: boolean) => {
    setState((s) => ({ ...s, pendingYes: open }));
  }, []);

  /** A finish refused over the health question: the server holds no answer, whatever this
   *  screen believed (a reset on another device), so the stale one goes with the refusal. */
  const forget = useCallback(() => {
    const none: HealthScreening = { answered: false, hasCondition: null, checkFirst: null, safeMode: false, noCalorieCut: false, updatedAt: null };
    stored.current = none;
    setState((s) => ({ ...s, screening: none, pendingYes: false }));
  }, []);

  return { ...state, answer, tick, tickPlan, retry, openYes, forget };
}

export type HealthStep = ReturnType<typeof useHealthStep>;
