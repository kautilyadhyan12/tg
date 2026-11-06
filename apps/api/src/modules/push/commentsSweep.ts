// A COMMENT OR REPLY ON YOUR POST, TOLD TO THE PHONE (ROADMAP Stage 5 item 18b-ii-b). Every minute the
// worker reads the comments owed to somebody and not yet taken. Each (person, gym) gets ONE comments
// notification, tagged with the gym, so the phone replaces that gym's last one instead of stacking
// another (Kd, 2026-11-03: "top of one another"); once more than one is new it says how many. It
// sounds the same person's phone at most once every half hour a gym, and waits from 23:00 to 04:00 on
// their clock, as a gym's messages do; what comes in between waits on its rows and joins the next one.
// The rows are the queue: a pair is claimed before anything is sent, so a second run sends nothing
// twice, and settled only once a phone has it, so a run that stops halfway loses nothing; and each comment is read again just before it goes, as the person's own comments page would
// send it: one since removed or hidden, by somebody they blocked or who left, on a post they may no
// longer read, or in a gym they left, is told to nobody.
import { COMMENTS_AGAIN_MINUTES, GYM_COMMENTS_CHANNEL, PUSH_WITHIN_HOURS, commentNotification, pushHourOpen } from "@app/shared";
import type { Sql } from "postgres";
import { commentsToTell } from "../orgs/posts/commentsService.js";
import * as comments from "./commentsRepo.js";
import type { PushSender } from "./fcm.adapter.js";
import * as repo from "./repo.js";
import { localHour, type PushSweepResult } from "./sweep.js";

const BATCH = 500;
const PAGE = 500;
const MAX_PAGES = 40;
const AT_ONCE = 10;
/** Rows taken this long ago are read by no run again (`PUSH_WITHIN_HOURS`, `toldUnseen`), and go. */
const PRUNE_AFTER_HOURS = 48;
const PRUNE_MOST = 5_000;

export async function sendCommentNotifications(deps: {
  sql: Sql;
  sender: PushSender;
  now: () => Date;
  /** For tests on a shared database. */
  gymIds?: readonly string[];
  sizes?: { batch: number; page: number };
  /** Told of a failure the run carried on past: the worker logs it. */
  onError?: (err: unknown) => void;
}): Promise<PushSweepResult> {
  const { sql, sender } = deps;
  const batch = deps.sizes?.batch ?? BATCH;
  const page = deps.sizes?.page ?? PAGE;
  const now = deps.now();
  const since = new Date(now.getTime() - PUSH_WITHIN_HOURS * 3_600_000);
  const toldSince = new Date(now.getTime() - COMMENTS_AGAIN_MINUTES * 60_000);
  const claimedBefore = new Date(now.getTime() - repo.PUSH_CLAIM_MINUTES * 60_000);
  const result: PushSweepResult = { sent: 0, skipped: 0, waiting: 0, failed: 0 };
  const onError = deps.onError ?? (() => undefined);

  // `reached`: some phone has it, so it is never put back to be sent again. `again`: Firebase did not
  // answer for any phone, so the next run tries again.
  const tell = async (pair: comments.CommentPair, fresh: readonly string[], state: { reached: boolean; again: boolean }): Promise<void> => {
    if (fresh.length === 0) {
      result.skipped += 1;
      return;
    }
    const tokens = await repo.liveTokens(sql, pair.userId, now, "comments");
    // The notification replaces the gym's last one, so it counts what that one held and was not seen.
    const earlier = tokens.length === 0 ? [] : await comments.toldUnseen(sql, pair.userId, pair.gymId, since);
    const seen = tokens.length === 0 ? null : await commentsToTell({ sql, now: () => now }, pair.userId, pair.gymId, [...new Set([...fresh, ...earlier])]);
    const newest = seen?.comments[0];
    const shown = seen === null ? null : commentNotification({ gymName: seen.gymName, comments: seen.comments });
    if (shown === null || newest === undefined) {
      result.skipped += 1;
      return;
    }
    const { title, body } = shown;
    let failed = false;
    for (const token of tokens) {
      const sent = await sender.send({
        token,
        userId: pair.userId,
        title,
        body,
        tag: `comments:${pair.gymId}`,
        channelId: GYM_COMMENTS_CHANNEL.id,
        data: { kind: "gym_comment", gymId: pair.gymId, postId: newest.postId },
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

  const handle = async (pair: comments.CommentPair): Promise<void> => {
    const claimedAt = deps.now();
    const claimed = await comments.claimComments(sql, pair.userId, pair.gymId, { since, toldSince, claimedAt, claimedBefore });
    if (claimed.taken === 0) return;
    const state = { reached: false, again: false };
    try {
      await tell(pair, claimed.fresh, state);
    } catch (err) {
      // A failure after the claim (a dropped connection): told to the worker, put back for the next run
      // unless a phone already has it, and the rest of this run goes on.
      onError(err);
      result.failed += 1;
      state.again = !state.reached;
    }
    if (state.again) await comments.unclaimComments(sql, pair.userId, pair.gymId, claimedAt).catch(onError);
    else await comments.settleComments(sql, pair.userId, pair.gymId, claimedAt, now, state.reached).catch(onError);
  };

  let after: comments.CommentPairMark | null = null;
  let taken = 0;
  for (let pages = 0; pages < MAX_PAGES && taken < batch; pages += 1) {
    const pairs = await comments.pendingCommentPairs(sql, { since, toldSince, claimedBefore, limit: page, after, gymIds: deps.gymIds });
    const due: comments.CommentPair[] = [];
    for (const pair of pairs) {
      // Night, told within the half hour, or another run still sending it: left on its rows for a later
      // run, nothing marked. Those too old to tell are taken at once, with no send.
      if (pair.busy) result.waiting += 1;
      else if (pair.fresh && (pair.toldLately || !pushHourOpen(localHour(pair.userZone, pair.gymZone, now)))) result.waiting += 1;
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
  await comments.pruneComments(sql, new Date(now.getTime() - PRUNE_AFTER_HOURS * 3_600_000), PRUNE_MOST, deps.gymIds).catch(onError);
  return result;
}
