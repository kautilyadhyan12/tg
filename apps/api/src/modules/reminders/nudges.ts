// THE STREAK REMINDER, BADGES AND THE SUNDAY SUMMARY, SENT (ROADMAP Stage 5 item 19e-ii). Every minute the
// worker works out each zone's clock, reads who may be owed one, and for each person sends at most one.
// Never bombarded (Kd, 2026-11-05 and 2026-11-06): one of the three a day at most (claimed on the person
// before anything is sent, so a second run sends nothing twice), none from 9:30 pm to 8 am, none within 2
// hours of any other notification reaching the phone, none on a day 3 already have, none to somebody who
// has not opened the app for a week. The summary first on a Sunday at 6 pm, and it tells the week's new
// badges; then the streak reminder at 7 pm; else waiting badges, told together. Nothing tells somebody in
// Safe mode to train: their streak reminder does not go.
import {
  BADGE_TELL_DAYS,
  NUDGE_DUE_MINUTES,
  NUDGE_FIRST_MINUTE,
  NUDGE_LAST_MINUTE,
  REMINDER_PAUSE_DAYS,
  STREAK_REMINDER_LEAST,
  STREAK_REMINDER_MINUTE,
  STREAK_SEEN_AFTER_MINUTE,
  SUMMARY_MINUTE,
  TRAINING_PROGRESS_CHANNEL,
  badgeNotification,
  nudgeDue,
  roomForNudge,
  streakNotification,
  summaryNotification,
  summaryWorthSending,
  type NudgeKind,
  type TrainingNudgePushData,
} from "@app/shared";
import type { Sql } from "postgres";
import { RUN_COUNTS_FROM_M, reconcile } from "../gamification/service.js";
import type { PushSender } from "../push/fcm.adapter.js";
import * as push from "../push/repo.js";
import type { PushSweepResult } from "../push/sweep.js";
import { getPlanHealth } from "../users/service.js";
import { localClock, reminderZone, type LocalClock } from "./clock.js";
import * as repo from "./nudgesRepo.js";

const AT_ONCE = 10;
const DAY_MS = 86_400_000;

const mondayOf = (clock: LocalClock): string => {
  const d = new Date(Date.parse(`${clock.day}T00:00:00Z`) - (clock.weekday - 1) * DAY_MS);
  return d.toISOString().slice(0, 10);
};

interface Shown {
  kind: NudgeKind;
  title: string;
  body: string;
  open: TrainingNudgePushData["open"];
  monday: string | null;
  badges: string[];
}

export async function sendTrainingNudges(deps: {
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
  const badgesSince = new Date(now.getTime() - BADGE_TELL_DAYS * DAY_MS);

  await repo.dropStaleBadges(sql, badgesSince, deps.userIds);
  const zones = await repo.nudgeZones(sql, deps.userIds);
  const clocks = zones.map((zone) => {
    const clock = localClock(zone === "" ? null : zone, now);
    return { zone, ...clock, monday: mondayOf(clock) };
  });
  const clockOf = new Map(clocks.map((c) => [c.zone, c]));
  const owed = await repo.owedNudges(sql, {
    clocks,
    streakFrom: STREAK_REMINDER_MINUTE,
    summaryFrom: SUMMARY_MINUTE,
    due: NUDGE_DUE_MINUTES,
    open: NUDGE_FIRST_MINUTE,
    close: NUDGE_LAST_MINUTE,
    streakLeast: STREAK_REMINDER_LEAST,
    badgesSince,
    userIds: deps.userIds,
  });

  const weekOf = async (person: repo.NudgePerson, clock: repo.NudgeClock, zone: string) => {
    const { thisWeek, lastWeek } = await repo.twoWeeks(sql, person.userId, zone, clock.monday, RUN_COUNTS_FROM_M);
    return {
      workouts: thisWeek.workouts,
      runs: thisWeek.runs,
      visits: thisWeek.visits,
      lastWeekWorkouts: lastWeek.workouts,
      lastWeekRuns: lastWeek.runs,
      lastWeekVisits: lastWeek.visits,
      streak: reconcile(person.streak, clock.day).current,
    };
  };

  /** Which of the three this person gets now, if any. Writes only a skipped summary. */
  const pick = async (person: repo.NudgePerson, clock: repo.NudgeClock, zone: string): Promise<Shown | null> => {
    const summaryOwed = person.pushSummary && clock.weekday === 7 && (person.summaryWeek === null || person.summaryWeek < clock.monday);
    if (summaryOwed && nudgeDue(SUMMARY_MINUTE, clock.minute)) {
      const week = { ...(await weekOf(person, clock, zone)), badges: person.untold };
      const shown = summaryNotification(week);
      if (!summaryWorthSending(week) || shown === null) {
        // Two weeks with nothing done: no summary this week, and the day stays free for a badge.
        await repo.skipSummary(sql, person.userId, clock.monday);
      } else {
        return { kind: "summary", ...shown, open: "dashboard", monday: clock.monday, badges: person.untold };
      }
    }
    if (person.pushStreak && nudgeDue(STREAK_REMINDER_MINUTE, clock.minute)) {
      const shown = await streakShown(person, clock, zone);
      if (shown !== null) return shown;
    }
    // A badge earned on a Sunday before the summary is told in it.
    const summaryLater = summaryOwed && clock.minute < SUMMARY_MINUTE + NUDGE_DUE_MINUTES;
    if (person.pushBadges && person.untold.length > 0 && !summaryLater) {
      const shown = badgeNotification(person.untold);
      if (shown !== null) return { kind: "badges", ...shown, open: "achievements", monday: null, badges: person.untold };
    }
    return null;
  };

  const streakShown = async (person: repo.NudgePerson, clock: repo.NudgeClock, zone: string): Promise<Shown | null> => {
    const streak = reconcile(person.streak, clock.day);
    if (streak.current < STREAK_REMINDER_LEAST || streak.lastActivityDate === clock.day) return null;
    // Opened the app after 5 pm today: they know.
    const seen = localClock(zone, person.lastActiveAt);
    if (seen.day === clock.day && seen.minute >= STREAK_SEEN_AFTER_MINUTE) return null;
    // Safe mode: nothing tells them to train until a professional clears them.
    if ((await getPlanHealth(sql, person.userId))?.safeMode === true) return null;
    if (await repo.activeOn(sql, person.userId, zone, clock.day, new Date(now.getTime() - 2 * DAY_MS), RUN_COUNTS_FROM_M)) return null;
    const shown = streakNotification({ days: streak.current, freeze: streak.freezesAvailable > 0 });
    return shown === null ? null : { kind: "streak", ...shown, open: "workout", monday: null, badges: [] };
  };

  const handle = async (person: repo.NudgePerson): Promise<void> => {
    const clock = clockOf.get(person.zone);
    if (clock === undefined) return;
    const zone = reminderZone(person.zone === "" ? null : person.zone);
    // Not opened for a week: none of the three.
    if (person.lastActiveAt.getTime() < now.getTime() - REMINDER_PAUSE_DAYS * DAY_MS) {
      result.skipped += 1;
      return;
    }
    // The other notifications come first: none within 2 hours of one, none once 3 reached the phone today.
    const recent = person.recentPushes.map((at) => ({ at, day: localClock(zone, at).day }));
    if (!roomForNudge(recent, clock.day, now)) {
      result.waiting += 1;
      return;
    }
    const shown = await pick(person, clock, zone);
    if (shown === null) {
      result.skipped += 1;
      return;
    }
    const taken = await repo.claimDay(sql, person.userId, clock.day, shown.monday);
    if (taken === null) return;
    let badges: string[] = [];
    let reached = false;
    try {
      // The badges the claim took are the ones told; a summary or badges notice is built again from them.
      let words = { title: shown.title, body: shown.body };
      if (shown.kind !== "streak") {
        badges = await repo.claimBadges(sql, person.userId, badgesSince, now);
        if (shown.kind === "badges") {
          const again = badgeNotification(badges);
          if (again === null) throw new Skip();
          words = again;
        } else if (badges.join() !== shown.badges.join()) {
          words = summaryNotification({ ...(await weekOf(person, clock, zone)), badges }) ?? words;
        }
      }
      const tokens = await push.liveTokens(sql, person.userId, now, shown.kind);
      if (tokens.length === 0) throw new Skip();
      let failed = false;
      for (const token of tokens) {
        const sent = await sender.send({
          token,
          userId: person.userId,
          title: words.title,
          body: words.body,
          tag: "training-progress",
          channelId: TRAINING_PROGRESS_CHANNEL.id,
          data: { kind: "training_nudge", open: shown.open },
        });
        if (sent === "sent") {
          result.sent += 1;
          reached = true;
        } else if (sent === "gone") {
          await push.forgetToken(sql, person.userId, token);
        } else {
          result.failed += 1;
          failed = true;
        }
      }
      if (reached) await push.noteReached(sql, person.userId, now).catch(onError);
      else {
        if (!failed) result.skipped += 1;
        await giveBack(person.userId, clock, shown.monday, taken, badges);
      }
    } catch (err) {
      if (err instanceof Skip) {
        result.skipped += 1;
      } else {
        // A failure after the claim: owed again unless a phone already has it; the rest of the run goes on.
        onError(err);
        result.failed += 1;
      }
      if (!reached) await giveBack(person.userId, clock, shown.monday, taken, badges).catch(onError);
    }
  };

  const giveBack = async (
    userId: string,
    clock: repo.NudgeClock,
    monday: string | null,
    taken: { prevDay: string | null; prevWeek: string | null },
    badges: readonly string[],
  ): Promise<void> => {
    await repo.unclaimDay(sql, userId, clock.day, monday, taken);
    await repo.unclaimBadges(sql, userId, badges, now);
  };

  for (let i = 0; i < owed.length; i += AT_ONCE) {
    await Promise.all(owed.slice(i, i + AT_ONCE).map((person) => handle(person).catch(onError)));
  }
  return result;
}

/** Nothing is sent after the claim (no phone, no badge left to tell): the claim is given back. */
class Skip extends Error {}
