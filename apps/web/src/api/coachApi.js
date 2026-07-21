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
// The API half is BUILT on branch `coach-idempotency` (not yet merged):
// /v1/coach/chat now accepts an optional Idempotency-Key and carries a
// 10-per-minute cap, so a recognised repeat opens no second thread, spends no
// second quota slot, and writes no duplicate messages.
//
// CORRECTION (2026-07-21): this comment used to say "sendMessage grows one
// header line here". It does NOT, and shipping that would protect nothing —
// Coach.jsx clears the message box on send and never restores it, and there is
// no retry affordance at all, so a key generated per send is DIFFERENT on every
// attempt and dedupes nothing. The client half is a real "Try again" control on
// the failed reply that resends with the SAME key; scope is in OWED.md.
// Until then: no automatic retry of this POST exists (authApi's 401-refresh
// replay is safe — a 401 is rejected before the handler runs, so the question
// was never processed).
import authApi from './authApi';

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
   *  null/undefined — when starting a new thread. */
  sendMessage: (message, threadId = null) =>
    authApi.post('/v1/coach/chat', threadId ? { message, threadId } : { message }),
};
