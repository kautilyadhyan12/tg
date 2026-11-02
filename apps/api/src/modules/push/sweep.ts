// A GYM'S NEW MESSAGES, TOLD TO THE PHONE (ROADMAP Stage 5 item 18b-i; Kd, 2026-11-02). Every minute
// the worker reads the messages not yet handed to the notifications. Each (person, gym) gets ONE
// notification, tagged with the gym, so the phone replaces that gym's last one instead of stacking
// another; it says the count once more than one is new. At night on the person's clock it waits.
// The rows are the queue: a pair is claimed before anything is sent, so a second run, or two at
// once, sends nothing twice. A message that cannot be told (read, gone from the inbox, older than a
// day, nobody's phone) is marked handled without a send.
import {
  GYM_MESSAGES_CHANNEL,
  PUSH_WITHIN_HOURS,
  gymMessageNotification,
  pushHourOpen,
} from "@app/shared";
import type { Sql } from "postgres";
import { unreadCounts } from "../orgs/messages/repo.js";
import type { PushSender } from "./fcm.adapter.js";
import * as repo from "./repo.js";

/** The hour (0 to 23) on a clock named by an IANA zone, or null when the zone cannot be read. */
export function hourIn(zone: string | null, now: Date): number | null {
  if (zone === null || zone.trim() === "") return null;
  try {
    const text = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(now);
    const hour = Number(text);
    return Number.isInteger(hour) ? hour : null;
  } catch {
    return null;
  }
}

/** The person's own clock when the phone told it, else the gym's. */
export function localHour(userZone: string | null, gymZone: string, now: Date): number | null {
  return hourIn(userZone, now) ?? hourIn(gymZone, now);
}

export interface PushSweepResult {
  sent: number;
  skipped: number;
  waiting: number;
  failed: number;
}

const BATCH = 500;

export async function sendGymMessageNotifications(deps: {
  sql: Sql;
  sender: PushSender;
  now: () => Date;
  /** For tests on a shared database. */
  gymIds?: readonly string[];
}): Promise<PushSweepResult> {
  const { sql, sender } = deps;
  const now = deps.now();
  const since = new Date(now.getTime() - PUSH_WITHIN_HOURS * 3_600_000);
  const result: PushSweepResult = { sent: 0, skipped: 0, waiting: 0, failed: 0 };
  const pairs = await repo.pendingPairs(sql, now, since, BATCH, deps.gymIds);
  for (const pair of pairs) {
    // Night: left for a later run, nothing marked.
    if (pair.fresh && !pushHourOpen(localHour(pair.userZone, pair.gymZone, now))) {
      result.waiting += 1;
      continue;
    }
    // Claimed first, so what is counted below includes every message the claim took.
    const claimed = await repo.claim(sql, pair.userId, pair.gymId, now);
    if (claimed === 0) continue;
    const tokens = pair.fresh ? await repo.liveTokens(sql, pair.userId, now) : [];
    // The Inbox's own count and rule: a former member, a closed gym or one on no plan has none.
    const unread = tokens.length === 0 ? 0 : ((await unreadCounts(sql, pair.userId, now)).get(pair.gymId) ?? 0);
    const newest = unread === 0 ? null : await repo.newestUnread(sql, pair.userId, pair.gymId, now);
    if (newest === null) {
      result.skipped += 1;
      continue;
    }
    const { title, body } = gymMessageNotification(pair.gymName, newest, unread);
    for (const token of tokens) {
      const sent = await sender.send({
        token,
        title,
        body,
        tag: pair.gymId,
        channelId: GYM_MESSAGES_CHANNEL.id,
        data: { kind: "gym_inbox", gymId: pair.gymId },
      });
      if (sent === "sent") result.sent += 1;
      else if (sent === "gone") await repo.forgetToken(sql, pair.userId, token);
      else result.failed += 1;
    }
  }
  return result;
}
