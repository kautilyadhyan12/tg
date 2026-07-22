// Coach chat retry protection — the owed follow-up from DECISIONS 2026-07-12
// (P2.5b T3 minor) and Kd's D1(b) ruling 2026-07-16 ("when the client is
// wired"; web Card 4 wired it). A user whose message fails and who sends
// again suffers three distinct harms, all closed here:
//   1. a SECOND thread — service.chat creates one whenever the request omits
//      threadId, and the web omits it for the first message of a conversation;
//   2. a SECOND quota slot — requireQuota INCREMENTS in a preHandler
//      (quotas/service.ts), so it spends before the handler ever runs;
//   3. DUPLICATE messages — the answer-cache path appends the exchange too.
//
// PLACEMENT IS THE POINT: these preHandlers sit AFTER validateChatBody and
// BEFORE requireQuota. A guard placed after the meter would let a replay burn
// a slot while every obvious test still passed. Verified against Fastify 5:
// a preHandler that sends a reply short-circuits the remaining preHandlers AND
// the handler, so a served replay never reaches the meter at all.
//
// No migration and no new dependency: RedisLike.incrWithTtl is an atomic
// claim (real Redis = a Lua INCR+EXPIRE script; the in-memory dev/test impl is
// synchronous JS), so it returns 1 to exactly one caller.
import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest, onSendAsyncHookHandler } from "fastify";
import { z } from "zod";
import type { RedisLike } from "../../redis.js";
import { coachChatResponseSchema } from "./schemas.js";
import { CoachError } from "./service.js";

/** Kd-approved at the plan gate 2026-07-21; NOT spec values (R0.2 — recorded
 *  in DECISIONS rather than invented silently). */
export const IDEMPOTENCY_RECORD_TTL_S = 10 * 60; // how long a send is remembered
export const COACH_CAP_MAX = 10; // messages…
export const COACH_CAP_WINDOW_S = 60; // …per minute, per user
/** Bounds the "first attempt is still running" window only. Deliberately much
 *  shorter than the record TTL: if the process dies between claiming and
 *  answering, the key frees itself in two minutes instead of stranding the
 *  user on 409 for the full replay window. */
export const IDEMPOTENCY_IN_FLIGHT_TTL_S = 120;
/** A key is a client-generated opaque string; anything longer is a buggy
 *  client, rejected loudly like the workouts sync key mismatch (R3.5). */
export const IDEMPOTENCY_MAX_KEY_CHARS = 200;


interface CoachIdempotencyState {
  /** The stored answer of a completed attempt (replay source). */
  recordKey: string;
  /** The atomic in-flight claim. */
  counterKey: string;
  /** Thread opened by an attempt that then FAILED — the retry reuses it. */
  threadKey: string;
  /** True only for the caller that won the claim: the one that writes back. */
  won: boolean;
  /** Set by the handler's onThreadOpened hook; null when none was opened. */
  openedThreadId: string | null;
  /** Fingerprint of the WHOLE validated request body this attempt is
   *  answering, stored with every artifact the key owns so a later reuse of
   *  the key for a DIFFERENT request — any field, not just the message — is
   *  caught rather than silently replayed. */
  requestHash: string;
  /** Thread a previous failed attempt opened, to be RESUMED if it still
   *  exists. Deliberately NOT written into the parsed body: a client-supplied
   *  threadId that is missing must still 404 (it means the client is wrong),
   *  whereas a remembered one that is missing just means the user tidied it
   *  away — that must open a fresh thread, not fail. */
  resumeThreadId: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    coachIdem?: CoachIdempotencyState;
  }
}

const keyHash = (raw: string): string => createHash("sha256").update(raw).digest("hex");

function authedUserId(req: FastifyRequest): string {
  const userId = req.authUser?.id;
  if (userId === undefined) throw new Error("coach retry guards must run after app.authenticate");
  return userId;
}

/** Deterministic serialization: keys sorted at every level, so the same value
 *  always produces the same string regardless of property order. Exported for
 *  the unit test that pins the class-level property (round 4). */
export function canonical(value: unknown): string {
  // JSON.stringify(undefined) returns undefined, not a string — TS types it as
  // string and would have let that through as the literal "undefined".
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((el) => canonical(el)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

/**
 * Fingerprint of the WHOLE validated request body.
 *
 * ROUND 4 F1 — and the reason this hashes the whole body rather than adding
 * the field the review named. The request identity is every field the client
 * sent, not the one someone remembered to bind: rounds 2, 3 and 4 each bound
 * the case the previous round found (the record, then the thread, then
 * `threadId`), so a fourth reviewer found a fourth gap. Hashing the parsed
 * body means the next field added to `coachChatRequestSchema` is covered on
 * the day it is added, with nobody having to remember this file exists.
 *
 * THE FLIP SIDE (round 5 note): any field added to the schema thereby becomes
 * part of the request identity. A future NON-identity field — a client nonce,
 * a UI locale, a timestamp the client regenerates — would over-bind and 400 an
 * honest retry that legitimately produces a different value. Because the schema
 * is `.strict()`, such a field is always a deliberate addition, and over-binding
 * fails SAFE (a 400 mismatch, never a wrong replay). If one is ever added, omit
 * it from `input` here.
 *
 * The concrete round-4 defect: with only the message bound, the same key sent
 * with the same text in a DIFFERENT thread replayed the first thread's answer
 * — 200, `Idempotent-Replay: true`, and the client's write into the second
 * thread silently never happened. "ok thanks" / "why?" / "more" is exactly the
 * repeated short text a chat UI produces across threads.
 *
 * Throws rather than defaulting (round 3 F3): a silent default would collapse
 * every request under a key to one fingerprint the day this guard stopped
 * following validateChatBody, defeating the binding via the ordering
 * assumption it depends on. authedUserId throws for the identical reason.
 */
function requestFingerprint(req: FastifyRequest): string {
  const input = req.coachChatInput;
  if (input === undefined) throw new Error("coach retry guards must run after validateChatBody");
  return keyHash(canonical(input));
}

/** What a completed attempt stores: the answer, plus the fingerprint of the
 *  REQUEST it answered. Without it, a client reusing one key for a different
 *  request is handed the first one's answer, silently — the workouts sync path
 *  already rejects that class loudly (`idempotency_key_mismatch`) and this is
 *  the same contract (T3 R3.5). */
const recordEnvelopeSchema = z.object({
  m: z.string().min(1), // sha256 of the canonical request body
  body: coachChatResponseSchema,
});
type RecordEnvelope = z.infer<typeof recordEnvelopeSchema>;

/** The thread memory carries the SAME fingerprint, for the same reason.
 *  ROUND 3 F1: the round-2 fix bound only the record, so one key used for two
 *  questions was rejected loudly after a SUCCESS and accepted silently after a
 *  FAILURE — the second question's exchange landing in the thread titled with
 *  the first. THREE paths honour the key (round 4 F4 corrected this comment's
 *  own count): the stored record, this thread memory, and the in-flight claim.
 *  The first two compare the fingerprint; the claim holds no payload to
 *  compare, so it refuses without asserting WHICH request is in progress. */
const threadEnvelopeSchema = z.object({
  m: z.string().min(1),
  t: z.string().uuid(),
});

/** JSON.parse that cannot throw — the hook's write-back path must stay total
 *  (round 3 F2). Wrapped in an object so a legitimately-null payload is
 *  distinguishable from a parse failure. */
function parseUnknown(raw: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(raw) as unknown };
  } catch {
    return null;
  }
}

/** `z.ZodType<T>` rather than `ZodTypeAny`: the latter makes `parsed.data`
 *  `any`, which would silently un-type every caller (R2.2). */
function parseEnvelope<T>(schema: z.ZodType<T>, raw: string): T | null {
  const json = parseUnknown(raw);
  if (json === null) return null;
  const parsed = schema.safeParse(json.value);
  return parsed.success ? parsed.data : null;
}

/** Stored answers are re-parsed on read (R2.3) — never trusted because we
 *  wrote them. An unreadable record is DELETED and this attempt refuses: it
 *  cannot safely re-run (that would duplicate, the one thing this file exists
 *  to prevent) but the next attempt under the same key must not inherit the
 *  dead end — the client this protects retries with the SAME key by design. */
function parseRecord(raw: string): RecordEnvelope | null {
  return parseEnvelope(recordEnvelopeSchema, raw);
}

/** The three keys one (user, Idempotency-Key) pair owns. Exported so a test can
 *  reach a stored record without re-deriving the recipe — a duplicated recipe
 *  in a test drifts silently the day the real one changes. */
export function coachIdempotencyKeys(
  userId: string,
  rawKey: string,
): { recordKey: string; counterKey: string; threadKey: string } {
  const suffix = `${userId}:${keyHash(rawKey)}`;
  return {
    recordKey: `coach:idem:r:${suffix}`,
    counterKey: `coach:idem:c:${suffix}`,
    threadKey: `coach:idem:t:${suffix}`,
  };
}

/**
 * preHandler: recognises a repeated send of the same message.
 *
 * The header is OPTIONAL — mandating it would break the client shipped by web
 * Card 4, which sends none. Requests without a key behave exactly as before
 * and are protected by the cap alone.
 */
export function coachIdempotency(deps: { redis: RedisLike }) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const raw = req.headers["idempotency-key"];
    if (raw === undefined) return; // no key: unchanged path

    // NB a DUPLICATED header does not arrive as an array: `idempotency-key` is
    // not one of Node's special-cased headers, so two of them are JOINED into
    // one string ("a,b") — stable per client, so dedupe still behaves and that
    // client simply has a longer key. PROVEN by probe, including through
    // `inject()` with an explicit array value, which light-my-request also
    // joins. The `typeof raw !== "string"` arm below is therefore TYPE
    // NARROWING, not a runtime path: `req.headers[k]` is typed
    // `string | string[] | undefined` and must be narrowed, but no request can
    // actually reach it. Recorded rather than tested — a test asserting a 400
    // there would be asserting a fiction (T3 round 2 refined this: the review
    // asked for such a test; the probe showed the case cannot occur).
    // The message deliberately does NOT promise single-valuedness the code
    // cannot enforce (T3 R8.1: an error describing a check it does not do).
    if (typeof raw !== "string" || raw.trim() === "" || raw.length > IDEMPOTENCY_MAX_KEY_CHARS) {
      throw new CoachError(
        400,
        "invalid_idempotency_key",
        `Idempotency-Key must be a non-empty value of at most ${String(IDEMPOTENCY_MAX_KEY_CHARS)} characters.`,
      );
    }

    // Scoped per user (R3.2): the id is in the key, so one person's key can
    // never resolve to another person's answer or thread.
    const userId = authedUserId(req);
    const keys = coachIdempotencyKeys(userId, raw);
    const state: CoachIdempotencyState = {
      recordKey: keys.recordKey,
      counterKey: keys.counterKey,
      threadKey: keys.threadKey,
      won: false,
      openedThreadId: null,
      resumeThreadId: null,
      requestHash: requestFingerprint(req),
    };
    req.coachIdem = state;

    // 1. A completed attempt answers immediately — no meter, no provider, no
    //    thread, no messages. Checked BEFORE the claim so that a crash which
    //    stranded a counter can never shadow a genuinely stored answer.
    const stored = await deps.redis.get(state.recordKey);
    if (stored !== null) {
      const record = parseRecord(stored);
      if (record === null) {
        // THIS attempt still refuses (never duplicate on a guess), but the
        // unreadable record is DROPPED so the next one re-runs cleanly. Without
        // the delete the key dead-ends for the full replay window — and the
        // client this card is built for retries under the SAME key, so it would
        // loop on 409 forever rather than "just send a new key" (T3 R11.3).
        // ROUND 3 F4: NOT `request_in_flight` — nothing is in flight; the
        // record was just deleted a line ago. An error must not assert a
        // situation that is not happening (the round-1 F3 class, again).
        req.log.warn({ event: "coach.idempotency_record_unreadable" }, "stored coach reply unreadable");
        await deps.redis.del(state.recordKey);
        throw new CoachError(
          409,
          "retry_not_replayable",
          "We couldn't recover the earlier reply to this message. Please send it again.",
        );
      }
      if (record.m !== state.requestHash) {
        // Same key, DIFFERENT question: a buggy client. Reject loudly rather
        // than hand back an answer to a question this request did not ask
        // (workouts/routes.ts sets the precedent with the same error code).
        throw new CoachError(
          400,
          "idempotency_key_mismatch",
          "This Idempotency-Key was already used for a different message.",
        );
      }
      await reply.header("Idempotent-Replay", "true").status(200).send(record.body);
      return;
    }

    // 2. Atomic claim. null = Redis down.
    const claim = await deps.redis.incrWithTtl(state.counterKey, IDEMPOTENCY_IN_FLIGHT_TTL_S);
    if (claim === null) {
      // Coach fails OPEN (quotas/service.ts FAIL_OPEN.coach) — refusing a
      // legitimate first question because Redis blipped is worse than a rare
      // duplicate. Never silently, though: the skip is always logged.
      req.log.warn({ event: "coach.idempotency_skipped_redis_down", userId }, "coach dedupe skipped");
      return;
    }
    if (claim > 1) {
      // ROUND 4 F2: the wording no longer asserts WHICH request is running.
      // The claim carries no payload to compare against, so when a DIFFERENT
      // request arrives under this key mid-flight, "that message is already
      // being sent" was simply false — a different one was. Round 3's F4 rule
      // ("an error must not assert a situation that is not happening") applied
      // to the case round 3 named and not to the class. This statement is true
      // in both cases; the mismatch is then reported precisely by the record
      // check once the first attempt lands.
      throw new CoachError(
        409,
        "request_in_flight",
        "A send under this Idempotency-Key is already in progress. Please wait a moment.",
      );
    }
    state.won = true;

    // 3. A previous attempt under this key opened a thread and then failed.
    //    Resume it, or the retry would leave the first one orphaned and empty —
    //    harm 1, in the exact scenario the card was written for. Recorded as a
    //    RESUME rather than written into the parsed body: the body's threadId
    //    means "the client says this thread", and a missing one must 404,
    //    whereas a remembered thread the user has since deleted must simply
    //    yield a fresh one (T3 R9.2 — writing it into the body made the first
    //    "Try again" 404 AND spend a quota slot, because the handler runs after
    //    the meter).
    //    The remembered thread carries the message fingerprint too (round 3
    //    F1): resuming on the key alone let one key used for a SECOND question
    //    append that question's exchange into the thread titled with the
    //    first — silently, on the failure path, while the success path
    //    rejected the identical client bug loudly.
    const remembered = await deps.redis.get(state.threadKey);
    if (remembered !== null && req.coachChatInput?.threadId === undefined) {
      const envelope = parseEnvelope(threadEnvelopeSchema, remembered);
      if (envelope === null) {
        // Unreadable or legacy bare-id shape: forget it and open a fresh
        // thread. Never resume something we cannot attribute to this message.
        await deps.redis.del(state.threadKey);
      } else if (envelope.m !== state.requestHash) {
        throw new CoachError(
          400,
          "idempotency_key_mismatch",
          "This Idempotency-Key was already used for a different message.",
        );
      } else {
        state.resumeThreadId = envelope.t;
      }
    }
  };
}

/**
 * onSend: the write-back, in ONE place for every outcome.
 *
 * It must be a hook rather than handler code because a request can be turned
 * away by a LATER preHandler (the cap, or requireQuota's 429) without the
 * handler ever running — and that claim still has to be released, or an
 * honest retry would meet 409 instead of the real reason it failed.
 */
export function coachIdempotencyOnSend(deps: { redis: RedisLike }): onSendAsyncHookHandler {
  return async (req, reply, payload) => {
    const state = req.coachIdem;
    if (state === undefined || !state.won) return payload;

    // Branch on the STATUS alone: success and "was the payload serialisable"
    // are two independent facts, and conflating them classified a 200 with a
    // non-string payload as a FAILURE — which remembers the thread, stores no
    // record, and so lets the next retry resume the thread and append a SECOND
    // exchange, reopening harm 3. Unreachable on today's JSON path; the
    // classification is fixed rather than left to depend on that (T3 R2.4).
    if (reply.statusCode === 200) {
      // ROUND 3 F2: this parse must NOT throw. Every other Redis call in this
      // hook is total (setex→false, get→null, del→void); a throw here maps to
      // 500 and — worse — skips the unconditional release below, so a request
      // whose exchange ALREADY COMMITTED would answer 500 and lock the key for
      // the full in-flight TTL. "Unreachable on today's JSON path" is exactly
      // the argument the branch above refuses to accept, and it cannot be
      // accepted eleven lines further down either.
      const parsed = typeof payload === "string" ? parseUnknown(payload) : null;
      if (parsed !== null) {
        const envelope = JSON.stringify({ m: state.requestHash, body: parsed.value });
        const written = await deps.redis.setex(state.recordKey, IDEMPOTENCY_RECORD_TTL_S, envelope);
        if (!written) {
          // Unstored answer + released claim = a retry re-runs rather than
          // meeting a 409 it can never satisfy. Losing dedupe beats a lockout.
          req.log.warn({ event: "coach.idempotency_record_write_failed" }, "coach reply not stored for replay");
        }
      } else {
        // Succeeded but cannot be replayed (non-string, or unparseable). Say
        // so; never record it as a FAILURE — that would remember the thread
        // and let the next retry append a second exchange to it.
        req.log.warn({ event: "coach.idempotency_payload_not_replayable" }, "coach reply not replayable; no record stored");
      }
      await deps.redis.del(state.threadKey);
    } else if (state.openedThreadId !== null) {
      // Failed after opening a thread: remember it so the retry continues in
      // that same conversation instead of opening another. Stored WITH the
      // message fingerprint (round 3 F1) so a resend of a DIFFERENT question
      // under this key is rejected rather than folded into the wrong thread.
      // NB a retry that RESUMED an existing thread and then failed again opens
      // nothing, so it does not refresh this key — the memory stays bounded by
      // the window the first failure started, not extended indefinitely.
      await deps.redis.setex(
        state.threadKey,
        IDEMPOTENCY_RECORD_TTL_S,
        JSON.stringify({ m: state.requestHash, t: state.openedThreadId }),
      );
    }

    await deps.redis.del(state.counterKey); // always release the in-flight claim
    return payload;
  };
}

/**
 * preHandler: short-window burst cap, per user.
 *
 * Deliberately NOT the auth module's createDualRateLimit: that limiter also
 * counts a per-IP dimension, which on a gym's shared connection would throttle
 * everyone behind one NAT address. Same fixed-window mechanics, one dimension.
 *
 * Runs BEFORE requireQuota so a capped request costs no quota slot; a served
 * replay short-circuits before reaching it, so retrying is never punished as
 * if it were a flood.
 *
 * CONSEQUENCE, stated because the file's own text claims the cap protects this
 * route (T3 security residual): served replays and rejected keys never reach
 * the cap at all. Each costs one Redis read or nothing, and both are bounded by
 * the global limiter — but the cap's protection is scoped to requests that do
 * real work, not to every request on the route.
 */
export function coachRateCap(deps: { redis: RedisLike }) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const userId = authedUserId(req);
    const count = await deps.redis.incrWithTtl(`coach:rate:${userId}`, COACH_CAP_WINDOW_S);
    if (count === null) {
      req.log.warn({ event: "coach.cap_open_redis_down", userId }, "coach burst cap failing open");
      return;
    }
    if (count > COACH_CAP_MAX) {
      // Distinct from quota_exceeded on purpose: "slow down" and "you are out
      // of questions" are different facts and must not be confused.
      await reply.status(429).send({
        error: "rate_limited",
        message: "You're sending messages too quickly. Please wait a moment and try again.",
        requestId: req.id,
      });
    }
  };
}
