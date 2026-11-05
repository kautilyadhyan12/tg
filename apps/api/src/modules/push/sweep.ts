// A GYM'S NEW MESSAGES, TOLD TO THE PHONE (ROADMAP Stage 5 item 18b-i; Kd, 2026-11-02). Every minute
// the worker reads the messages not yet handed to the notifications. Each (person, gym) gets ONE
// notification, tagged with the gym, so the phone replaces that gym's last one instead of stacking
// another; it says the count once more than one is new. At night on the person's clock it waits.
// The rows are the queue: a pair is claimed before anything is sent, so a second run, or two at
// once, sends nothing twice, and settled only once a phone has it, so a run that stops halfway loses
// nothing: past `PUSH_CLAIM_MINUTES` the next run takes it again. A message that cannot be told (read, gone from the inbox, older than a
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

/** The pairs a run sends for at most, and how many it reads at a time, paging past those left for the
 *  morning so they never hold up the rest. */
const BATCH = 500;
const PAGE = 500;
/** A run stops reading after this many pages (20,000 pairs waiting for the morning). */
const MAX_PAGES = 40;
/** Firebase is asked for this many people at once: one at a time, a gym of 200 waits on 200 answers. */
const AT_ONCE = 10;

export async function sendGymMessageNotifications(deps: {
  sql: Sql;
  sender: PushSender;
  now: () => Date;
  /** For tests on a shared database. */
  gymIds?: readonly string[];
  /** For tests: smaller pages and batches than a real run's. */
  sizes?: { batch: number; page: number };
  /** Told of a failure the run carried on past: the worker logs it. */
  onError?: (err: unknown) => void;
}): Promise<PushSweepResult> {
  const { sql, sender } = deps;
  const batch = deps.sizes?.batch ?? BATCH;
  const page = deps.sizes?.page ?? PAGE;
  const now = deps.now();
  const since = new Date(now.getTime() - PUSH_WITHIN_HOURS * 3_600_000);
  const claimedBefore = new Date(now.getTime() - repo.PUSH_CLAIM_MINUTES * 60_000);
  const result: PushSweepResult = { sent: 0, skipped: 0, waiting: 0, failed: 0 };
  const onError = deps.onError ?? (() => undefined);

  // `reached`: some phone has it. `again`: Firebase did not answer for any phone, so the next run tries again.
  const tell = async (pair: repo.PendingPair, state: { reached: boolean; again: boolean }): Promise<void> => {
    const tokens = pair.fresh ? await repo.liveTokens(sql, pair.userId, now, "gym_messages") : [];
    // The Inbox's own count and rule: a former member, a closed gym or one on no plan has none.
    const unread = tokens.length === 0 ? 0 : ((await unreadCounts(sql, pair.userId, now)).get(pair.gymId) ?? 0);
    const newest = unread === 0 ? null : await repo.newestUnread(sql, pair.userId, pair.gymId, now);
    if (newest === null) {
      result.skipped += 1;
      return;
    }
    const { title, body } = gymMessageNotification(pair.gymName, newest, unread);
    let failed = false;
    for (const token of tokens) {
      const sent = await sender.send({
        token,
        userId: pair.userId,
        title,
        body,
        tag: pair.gymId,
        channelId: GYM_MESSAGES_CHANNEL.id,
        data: { kind: "gym_inbox", gymId: pair.gymId },
      });
      if (sent === "sent") {
        result.sent += 1;
        state.reached = true;
      } else if (sent === "gone") {
        await repo.forgetToken(sql, pair.userId, token);
      } else {
        result.failed += 1;
        failed = true;
      }
    }
    state.again = failed && !state.reached;
    if (state.reached) await repo.noteReached(sql, pair.userId, now).catch(onError);
  };

  const handle = async (pair: repo.PendingPair): Promise<void> => {
    // Claimed first, so what is counted below includes every message the claim took.
    const claimedAt = deps.now();
    const claimed = await repo.claim(sql, pair.userId, pair.gymId, { now, claimedAt, claimedBefore });
    if (claimed === 0) return;
    const state = { reached: false, again: false };
    try {
      await tell(pair, state);
    } catch (err) {
      // A failure after the claim (a dropped connection): told to the worker, put back for the next run
      // unless a phone already has it, and the rest of this run goes on.
      onError(err);
      result.failed += 1;
      state.again = !state.reached;
    }
    if (state.again) await repo.unclaim(sql, pair.userId, pair.gymId, claimedAt).catch(onError);
    else await repo.settle(sql, pair.userId, pair.gymId, claimedAt, now).catch(onError);
  };

  let after: repo.PairMark | null = null;
  let taken = 0;
  for (let pages = 0; pages < MAX_PAGES && taken < batch; pages += 1) {
    const pairs = await repo.pendingPairs(sql, { now, since, claimedBefore, limit: page, after, gymIds: deps.gymIds });
    const due: repo.PendingPair[] = [];
    for (const pair of pairs) {
      // Night: left for a later run, nothing marked.
      if (pair.fresh && !pushHourOpen(localHour(pair.userZone, pair.gymZone, now))) result.waiting += 1;
      else if (taken < batch) {
        due.push(pair);
        taken += 1;
      }
    }
    for (let i = 0; i < due.length; i += AT_ONCE) await Promise.all(due.slice(i, i + AT_ONCE).map(handle));
    const last = pairs.at(-1);
    if (last === undefined || pairs.length < page) break;
    after = last.mark;
  }
  return result;
}
