// P2.8 web repoint (Card 4) — coach on the NEW /v1 API via the Card-1 cookie
// client (httpOnly session; no tokens in JS). Shapes are @app/shared coach.ts,
// sent as the schema objects directly — no wrapper.
//
// NON-STREAMING by ruling (DECISIONS 2026-07-11 P2.5 GAP-3): one complete
// response per question = exact token/cost accounting + exact-match
// cacheability; a streaming card can follow post-cutover. The old raw-fetch
// streaming path (Bearer token from localStorage, __CONV_ID__ line protocol)
// is deleted with it.
//
// RETRY PROTECTION (DECISIONS 2026-07-12 P2.5b T3 minor; Kd D1(b) 2026-07-16).
// The API half is MERGED (PR #43): /v1/coach/chat accepts an optional
// Idempotency-Key and carries a 10-per-minute per-user cap, so a recognised
// repeat opens no second thread, spends no second quota slot, and writes no
// duplicate messages. THIS FILE IS THE CLIENT HALF.
//
// The key is minted ONCE PER COMPOSED MESSAGE and stored with the message, NOT
// generated inside sendMessage — a key regenerated per attempt would differ on
// every send and dedupe nothing while looking correct. The server fingerprints
// the WHOLE validated body (message + threadId), so a retry must resend an
// IDENTICAL body under that same key or it is correctly a 400 mismatch.
//
// No automatic retry of this POST exists; the retry is a user action (the "Try
// again" control on a failed reply). authApi's 401-refresh replay is safe and
// unaffected — a 401 is rejected at authn, BEFORE the idempotency guard runs,
// so the key is never claimed and the replay is a clean first attempt.
import authApi from './authApi';

/** One key per composed message (crypto.randomUUID needs a secure context —
 *  the same requirement the sync path already relies on, ActiveWorkout.jsx). */
export function newIdempotencyKey() {
  return crypto.randomUUID();
}

// ── Pure message-list helpers ────────────────────────────────────────────────
// They live here, not in the component, so they can be TESTED: the web package
// is node-vitest with no jsdom, so logic left inside JSX is unprovable. This is
// the established pattern — userApi.js carries syncTimezone for exactly this
// reason (DECISIONS 2026-07-21, that card's T3 F2).

function withoutRetry(message) {
  if (message.retry === undefined) return message;
  const copy = { ...message };
  delete copy.retry;
  return copy;
}

/** Replace the trailing assistant bubble — the in-flight placeholder, then the
 *  reply or the failure. Returns the list UNTOUCHED when the tail is not an
 *  assistant message, so a send can never rewrite a user's own words. */
export function replaceTailAssistant(messages, next) {
  const last = messages[messages.length - 1];
  if (last === undefined || last.role !== 'assistant') return messages;
  const updated = [...messages];
  updated[updated.length - 1] = next;
  return updated;
}

/**
 * Append an outgoing question and its typing placeholder — after WITHDRAWING
 * every earlier retry offer.
 *
 * THE INVARIANT (T3 V1): a send writes to the TAIL, so at most one message may
 * ever carry a retry offer and it must be the last one. Without the strip, a
 * button left armed on an older failed bubble stayed clickable once the
 * composer re-enabled, and clicking it resent the right key into the WRONG
 * message — overwriting a newer successful reply with an older answer while
 * leaving the failed bubble armed. The earlier exchange itself is kept; only
 * the offer is withdrawn, because the retry is no longer the tail and can no
 * longer be delivered where it belongs.
 */
export function appendOutgoing(messages, text) {
  return [
    ...messages.map(withoutRetry),
    { role: 'user', content: text },
    { role: 'assistant', content: '' },
  ];
}

const QUOTA_COPY =
  'You’ve used all your coach questions for this period. Your quota resets soon — or upgrade for more.';
const TOO_FAST_COPY = 'You’re sending messages too quickly. Wait a moment, then try again.';
const GENERIC_COPY = 'Sorry, I ran into an error.';

/**
 * Maps a failed /v1/coach/chat request to what the user should be told, and
 * whether "Try again" can honestly help.
 *
 * BRANCH ON THE ERROR NAME, NOT THE STATUS. Two different 429s mean opposite
 * things (monthly quota vs the 10/minute burst cap) and two different 409s give
 * opposite advice (wait vs send it again) — so a status-only branch tells a
 * user with four questions left to upgrade, or tells them to wait when nothing
 * is running. An error message must never assert a situation that is not
 * happening.
 *
 * The status is used only as a FALLBACK once the name is unrecognised: the
 * global @fastify/rate-limit throws a plain Error with no `code`, which app.ts
 * cannot type, so its 429 arrives as {error: "request_error"} (verified). Such
 * a 429 is still a rate problem, and the one thing it must never produce is the
 * upgrade copy.
 *
 * @returns {{content: string, retry: 'same-key'|'fresh-key'|null}}
 *   'same-key'  resend the identical body under the identical key (the point of
 *               the feature: the server recognises the repeat).
 *   'fresh-key' the key itself is the problem, and the server holds no answer
 *               bound to this body — so a NEW key is a genuine first attempt and
 *               cannot duplicate, where the same key would 400 forever.
 *   null        retrying cannot help; offering a button would be a lie.
 */
export function coachErrorInfo(err) {
  const status = err?.response?.status;
  switch (err?.response?.data?.error) {
    case 'quota_exceeded':
      return { content: QUOTA_COPY, retry: null };
    case 'rate_limited':
      return { content: TOO_FAST_COPY, retry: 'same-key' };
    case 'request_in_flight':
      return {
        content: 'That message is already being sent. Give it a moment.',
        retry: 'same-key',
      };
    case 'retry_not_replayable':
      return {
        content: 'We couldn’t recover the earlier reply — please send it again.',
        retry: 'same-key',
      };
    case 'coach_unavailable':
      return {
        content: 'The coach is briefly unavailable. Please try again in a moment.',
        retry: 'same-key',
      };
    case 'not_found':
      // Same thread id on a retry ⇒ the same 404. Nothing to offer.
      return { content: 'That conversation is no longer available.', retry: null };
    case 'validation_error':
      return { content: 'That message couldn’t be sent — it may be too long.', retry: null };
    case 'idempotency_key_mismatch':
    case 'invalid_idempotency_key':
      return { content: 'Something went wrong sending that message.', retry: 'fresh-key' };
    default:
      return status === 429
        ? { content: TOO_FAST_COPY, retry: 'same-key' }
        : { content: GENERIC_COPY, retry: 'same-key' };
  }
}

export const coachService = {
  /** {items: [{id, title, lastMessageAt}], nextCursor} — newest first.
   *  50 = the schema max (T3 Card 4 obs.1, Kd-ruled: covers any realistic
   *  user; a "load more" via nextCursor is a small later card if ever needed). */
  listThreads: (limit = 50) => authApi.get('/v1/coach/threads', { params: { limit } }),

  /** {id, title, messages: [{role, content, createdAt}]} or 404. */
  getThread: (id) => authApi.get(`/v1/coach/threads/${id}`),

  deleteThread: (id) => authApi.delete(`/v1/coach/threads/${id}`),

  /** POST /v1/coach/chat → {threadId, reply, cached}. Body is .strict()
   *  (coachChatRequestSchema); threadId is OMITTED — never sent as
   *  null/undefined — when starting a new thread.
   *
   *  `idempotencyKey` is OPTIONAL and the header is omitted entirely when it is
   *  absent, so a keyless call behaves exactly as it did before (the API keeps
   *  the header optional for the same reason). A retry passes the SAME key with
   *  the SAME message and threadId. */
  sendMessage: (message, threadId = null, idempotencyKey = null) =>
    authApi.post(
      '/v1/coach/chat',
      threadId ? { message, threadId } : { message },
      idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined,
    ),
};
