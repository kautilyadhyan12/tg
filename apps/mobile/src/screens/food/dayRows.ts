import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { mealPageSchema } from "@app/shared";
import { useZoneSaved } from "../../session/TimeZoneSync";
import { useSession } from "../../session/SessionProvider";
import { MEAL_PAGE_SIZE, inDay, walkDay } from "./day";
import type { OutboxView } from "./outbox";
import { serverRow, waitingRow, withChanges, type Row } from "./rows";

// The meals of a day, on the Food page and behind the Dashboard's Recommended box.

export type DayRead = { kind: "loading" } | { kind: "ok"; rows: Row[]; cut: boolean } | { kind: "failed" };

/** The day's meals from the server, read when the tab opens, when the day changes, when the app comes
 *  back, and each time the server takes a waiting meal; only the newest read is drawn. A read that
 *  comes back tells the outbox how many sends it began after (`settle`): until then a meal just sent
 *  is shown as the server answered it, and one just removed stays hidden. */
export function useDayMeals(day: Date, sent: number, settle: (upTo: number) => void): { read: DayRead; again: () => void } {
  const { session, state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const zone = useZoneSaved();
  const [read, setRead] = useState<DayRead>({ kind: "loading" });
  const latest = useRef(0);
  const shown = useRef<number | null>(null);
  const sentNow = useRef(sent);
  sentNow.current = sent;

  const again = useCallback(() => {
    if (me === null) return;
    latest.current += 1;
    const mine = latest.current;
    const upTo = sentNow.current;
    const dayKey = day.getTime();
    if (shown.current !== dayKey) setRead({ kind: "loading" });
    void walkDay(async (cursor) => {
      const query = cursor === null ? `limit=${String(MEAL_PAGE_SIZE)}` : `limit=${String(MEAL_PAGE_SIZE)}&cursor=${encodeURIComponent(cursor)}`;
      const answer = await session.signedIn({ method: "GET", path: `/v1/nutrition/meals?${query}` }, mealPageSchema);
      return answer.kind === "ok" ? answer.data : null;
    }, day).then((walked) => {
      if (latest.current !== mine) return;
      const now = session.state();
      if (now.kind !== "in" || now.user.id !== me) return;
      if (walked === null) {
        setRead((before) => (before.kind === "ok" && shown.current === dayKey ? before : { kind: "failed" }));
        return;
      }
      shown.current = dayKey;
      setRead({ kind: "ok", rows: walked.meals.map(serverRow), cut: walked.cut });
      settle(upTo);
    });
  }, [session, me, day, settle]);

  useEffect(() => {
    again();
  }, [again, sent, zone]);

  useEffect(() => {
    const heard = AppState.addEventListener("change", (next) => {
      if (next === "active") again();
    });
    return () => {
      heard.remove();
    };
  }, [again]);

  useFocusEffect(again);
  return { read, again };
}

/** The server's meals, less those removed here, each as the server last answered it where that came
 *  after this read began; the ones just sent that this read began before; the ones still waiting on
 *  the phone; and every change still waiting laid over them. */
export function dayRows(read: DayRead, view: Pick<OutboxView, "landed" | "waiting" | "removing" | "changing">, day: Date): Row[] | null {
  const landed = new Map(view.landed.map((m) => [m.id, m]));
  return read.kind === "ok"
    ? [
        ...read.rows.filter((r) => !view.removing.has(r.id)).map((r) => {
          const newer = landed.get(r.id);
          return newer === undefined ? r : serverRow(newer);
        }),
        // The newest answer for each meal: a meal saved and then changed has landed twice.
        ...[...landed.values()].filter((m) => !read.rows.some((r) => r.id === m.id)).map(serverRow),
        ...view.waiting.filter((m) => !read.rows.some((r) => r.id === m.id) && !landed.has(m.id)).map(waitingRow),
      ]
        .map((r) => withChanges(r, view.changing.get(r.id)))
        .filter((r) => inDay(r.takenAt, day))
        .sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt))
    : null;
}
