// THE WORKOUT AND MEAL REMINDERS, SENT (ROADMAP Stage 5 item 19e-i). Every minute the worker works out
// each person's clock, reads the reminders owed near now, and for each person sends at most ONE
// notification: the reminders due now, with any due within the next hour (`remindersToSend`) once one due
// now is going; a workout reminder never goes in Safe mode. Never
// bombarded (Kd, 2026-11-05): each goes at most once a day (claimed on its row before anything is sent,
// so a second run sends nothing twice); one already done today (a workout or a visit; that meal logged)
// is skipped; and somebody who has not opened the app for a week gets none: what came due pauses itself.
import {
  REMINDER_BUNDLE_MINUTES,
  REMINDER_DUE_MINUTES,
  REMINDER_PAUSE_DAYS,
  TRAINING_REMINDERS_CHANNEL,
  mealTypeAtHour,
  reminderNotification,
  remindersDueNow,
  remindersToSend,
  type ReminderKind,
} from "@app/shared";
import type { Sql } from "postgres";
import type { PushSender } from "../push/fcm.adapter.js";
import * as push from "../push/repo.js";
import { getPlanHealth } from "../users/service.js";
import type { PushSweepResult } from "../push/sweep.js";
import { localClock, localHourOf, reminderZone } from "./clock.js";
import * as repo from "./repo.js";

const AT_ONCE = 10;
const DAY_MS = 86_400_000;

export async function sendTrainingReminders(deps: {
  sql: Sql;
  sender: PushSender;
  now: () => Date;
  /** For tests on a shared database. */
  userIds?: readonly string[];
  onError?: (err: unknown) => void;
}): Promise<PushSweepResult> {
  const { sql, sender } = deps;
  const now = deps.now();
  const onError = deps.onError ?? (() => undefined);
  const result: PushSweepResult = { sent: 0, skipped: 0, waiting: 0, failed: 0 };

  const zones = await repo.liveZones(sql, deps.userIds);
  const clocks = zones.map((zone) => ({ zone, ...localClock(zone === "" ? null : zone, now) }));
  const owed = await repo.owedNear(sql, { clocks, before: REMINDER_DUE_MINUTES - 1, ahead: REMINDER_BUNDLE_MINUTES, userIds: deps.userIds });
  const byPerson = new Map<string, repo.OwedRow[]>();
  for (const row of owed) byPerson.set(row.userId, [...(byPerson.get(row.userId) ?? []), row]);
  const clockOf = new Map(clocks.map((c) => [c.zone, c]));

  const handle = async (userId: string, rows: repo.OwedRow[]): Promise<void> => {
    const first = rows[0];
    const clock = first === undefined ? undefined : clockOf.get(first.zone);
    if (first === undefined || clock === undefined) return;
    // Only a reminder whose own time is now starts a notification; one due later in the hour joins it only
    // once that one is going, so nothing ever arrives early on its own.
    const dueNow = remindersDueNow(rows, clock.minute);
    if (dueNow.length === 0) {
      result.waiting += 1;
      return;
    }
    const taken = await repo.claim(sql, userId, dueNow, clock.day);
    if (taken.length === 0) return;
    const later: repo.Taken[] = [];
    let reached = false;
    try {
      const zone = reminderZone(first.zone === "" ? null : first.zone);
      // Not opened for a week: nothing goes, and what came due pauses itself until they turn it on. The
      // pause holds it, not today's mark: turned on for later today, it goes then.
      if (!(await repo.openedSince(sql, userId, new Date(now.getTime() - REMINDER_PAUSE_DAYS * DAY_MS)))) {
        await repo.pause(sql, userId, taken.map((t) => t.kind), now);
        await repo.unclaim(sql, userId, taken, clock.day);
        result.skipped += 1;
        return;
      }
      const safeMode = (await getPlanHealth(sql, userId))?.safeMode === true;
      const going = await notDone(sql, userId, zone, clock.day, taken.map((t) => t.kind), now, safeMode);
      if (going.length === 0) {
        result.skipped += 1;
        return;
      }
      // Due later within the hour, not done: joins this one, and is had for today.
      const joining = remindersToSend(rows, clock.minute).filter((kind) => !dueNow.includes(kind));
      const joinable = await notDone(sql, userId, zone, clock.day, joining, now, safeMode);
      later.push(...(await repo.claim(sql, userId, joinable, clock.day)));
      const left = await repo.stillOn(sql, userId, [...going, ...later.map((t) => t.kind)]);
      // Switched off meanwhile: the later ones go at their own time, never early on their own.
      if (!left.some((kind) => going.includes(kind))) {
        await repo.unclaim(sql, userId, later, clock.day);
        later.length = 0;
        result.skipped += 1;
        return;
      }
      const shown = reminderNotification(left);
      const tokens = shown === null ? [] : await push.liveTokens(sql, userId, now, "training");
      if (shown === null || tokens.length === 0) {
        result.skipped += 1;
        return;
      }
      let failed = false;
      for (const token of tokens) {
        const sent = await sender.send({
          token,
          userId,
          title: shown.title,
          body: shown.body,
          tag: "training-reminder",
          channelId: TRAINING_REMINDERS_CHANNEL.id,
          data: { kind: "training_reminder", open: left.includes("workout") ? "workout" : "food" },
        });
        if (sent === "sent") {
          result.sent += 1;
          reached = true;
        } else if (sent === "gone") {
          await push.forgetToken(sql, userId, token);
        } else {
          result.failed += 1;
          failed = true;
        }
      }
      if (reached) await push.noteReached(sql, userId, now).catch(onError);
      if (failed && !reached) await repo.unclaim(sql, userId, [...taken, ...later], clock.day);
    } catch (err) {
      // A failure after the claim: owed again unless a phone already has it; the rest of the run goes on.
      onError(err);
      result.failed += 1;
      if (!reached) await repo.unclaim(sql, userId, [...taken, ...later], clock.day).catch(onError);
    }
  };

  const people = [...byPerson.entries()];
  for (let i = 0; i < people.length; i += AT_ONCE) {
    await Promise.all(people.slice(i, i + AT_ONCE).map(([userId, rows]) => handle(userId, rows).catch(onError)));
  }
  return result;
}

/** The reminders still worth sending: a workout reminder unless the person trained today or is in Safe mode
 *  (no workout until a professional clears them), a meal's unless they logged it today. A meal with no kind
 *  chosen counts where the Food screen shows it, by its hour. */
async function notDone(
  sql: Sql,
  userId: string,
  zone: string,
  day: string,
  kinds: readonly ReminderKind[],
  now: Date,
  safeMode: boolean,
): Promise<ReminderKind[]> {
  if (kinds.length === 0) return [];
  const since = new Date(now.getTime() - 2 * DAY_MS);
  const trained = kinds.includes("workout") && !safeMode ? await repo.trainedOn(sql, userId, zone, day, since) : false;
  const meals = kinds.some((kind) => kind !== "workout") ? await repo.recentMeals(sql, userId, since) : [];
  const logged = new Set(
    meals
      .filter((meal) => localClock(zone, meal.takenAt).day === day)
      .map((meal) => meal.mealType ?? mealTypeAtHour(localHourOf(zone, meal.takenAt))),
  );
  return kinds.filter((kind) => (kind === "workout" ? !safeMode && !trained : !logged.has(kind)));
}
