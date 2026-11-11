// Suggested or My plan for running (ROADMAP Stage 5 item 37d-iii-b; spec Part 6 §16.6): the app's plan, or
// the person's own week, kept on the server, so the Dashboard, the Running page and a second phone show the
// same one. A gym's run plan joins with Stage 2's item 24.
import { useCallback, useEffect, useRef, useState } from "react";
import { runPlanResponseSchema, type PlanDay, type RunChoice, type RunPlanResponse } from "@app/shared";
import { ChoiceSwitch } from "../../look/ChoiceSwitch";
import { useSession } from "../../session/SessionProvider";
import { useRead } from "../dashboard/useRead";
import type { PlanRead } from "./RunPlanBox";

const RUN_PLAN_READ = "/v1/geo/run-plan";
export const RUN_CHOICE_PATH = "/v1/geo/run-plan/choice";
export const OWN_PLAN_PATH = "/v1/geo/run-plan/own";
const NO_CONNECTION = "No connection. Try again.";

/** The days of the plan the person picked: their own week where My plan is picked, else the app's. */
export function shownDays(data: RunPlanResponse): PlanDay[] | null {
  if (data.choice === "mine") return data.own?.days ?? null;
  return data.plan !== null && data.plan.kind !== "none" ? data.plan.days : null;
}

export const isSafeMode = (data: RunPlanResponse): boolean => data.plan?.kind === "none" && data.plan.why === "safe_mode";

/** The run plan read, and a reply the person's own change brought shown until a read begun after it lands. */
export function useRunPlan(fresh: number): { read: PlanRead; took: (data: RunPlanResponse) => void } {
  const { read, again, begun, shownFrom } = useRead(RUN_PLAN_READ, runPlanResponseSchema, fresh);
  const [answered, setAnswered] = useState<{ data: RunPlanResponse; after: number } | null>(null);
  useEffect(() => {
    if (answered !== null && shownFrom > answered.after) setAnswered(null);
  }, [answered, shownFrom]);
  const took = useCallback((data: RunPlanResponse) => { setAnswered({ data, after: begun() }); }, [begun]);
  const data = answered?.data ?? (read.kind === "ok" ? read.data : null);
  return { read: data !== null ? { kind: "ok", data } : read.kind === "failed" ? { kind: "failed", again } : { kind: "loading" }, took };
}

/** The pick shown: the one being sent, then the server's. A pick that gets no answer goes back, and says so. */
export function useRunChoice(read: PlanRead, took: (data: RunPlanResponse) => void) {
  const { session } = useSession();
  const [sending, setSending] = useState<RunChoice | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const away = useRef(false);
  const fromRead = read.kind === "ok" ? read.data.choice : null;
  const shown = sending ?? fromRead;
  const pick = useCallback(
    async (next: RunChoice) => {
      if (away.current || next === shown) return;
      away.current = true;
      setSending(next);
      setTrouble(null);
      const answer = await session.signedIn({ method: "PUT", path: RUN_CHOICE_PATH, body: { choice: next } }, runPlanResponseSchema);
      away.current = false;
      setSending(null);
      if (answer.kind === "ok") {
        took(answer.data);
        return;
      }
      setTrouble(answer.kind === "no_answer" || answer.message === "" ? NO_CONNECTION : answer.message);
    },
    [session, shown, took],
  );
  return { shown, pick, trouble };
}

export function RunChoiceRow({ shown, pick, trouble }: { shown: RunChoice; pick: (c: RunChoice) => Promise<void>; trouble: string | null }) {
  const choices: { key: RunChoice; label: string }[] = [
    { key: "suggested", label: "Suggested" },
    { key: "mine", label: "My plan" },
  ];
  return <ChoiceSwitch said="Whose run plan" trouble={trouble} choices={choices.map((c) => ({ key: c.key, label: c.label, on: shown === c.key, onPress: () => { void pick(c.key); } }))} />;
}
