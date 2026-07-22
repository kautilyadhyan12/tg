// P2.8 web repoint (Card 4) — coachService on the new /v1 API. Pins: exact
// paths/methods, the .strict()-safe chat body (threadId OMITTED for a new
// thread — coachChatRequestSchema rejects unknown keys and a null threadId
// fails the uuid check), and that the module owns NO raw fetch / localStorage
// (the old streaming path read a Bearer token from localStorage — its absence
// is the point of the Card-1 cookie model).
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import authApi from './authApi';
import {
  coachService,
  coachErrorInfo,
  newIdempotencyKey,
  replaceTailAssistant,
  appendOutgoing,
} from './coachApi';

// Axios normalises request headers into an AxiosHeaders object, whose lookup is
// case-insensitive — read through it rather than indexing, or a header that IS
// being sent can read as absent (and the "no key" test would pass for the wrong
// reason).
function headerOf(config, name) {
  const h = config.headers;
  if (!h) return undefined;
  if (typeof h.get === 'function') return h.get(name) ?? undefined;
  const hit = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return hit === undefined ? undefined : h[hit];
}

function recordRequests(api) {
  const seen = [];
  api.defaults.adapter = async (config) => {
    seen.push({
      url: config.url,
      method: config.method,
      params: config.params,
      data: config.data,
      idempotencyKey: headerOf(config, 'Idempotency-Key'),
    });
    return { data: {}, status: 200, statusText: '', headers: {}, config, request: {} };
  };
  return seen;
}

/** An axios-shaped rejection: what the catch block in Coach.jsx actually sees. */
function apiError(status, error) {
  return { response: { status, data: { error, message: 'x', requestId: 'r' } } };
}

afterEach(() => {
  authApi.defaults.adapter = undefined;
});

describe('coachService repoint (Card 4)', () => {
  it('threads list/detail/delete hit the /v1/coach surface', async () => {
    const seen = recordRequests(authApi);
    await coachService.listThreads();
    await coachService.getThread('t-1');
    await coachService.deleteThread('t-1');
    expect(seen[0]).toMatchObject({ url: '/v1/coach/threads', method: 'get', params: { limit: 50 } });
    expect(seen[1]).toMatchObject({ url: '/v1/coach/threads/t-1', method: 'get' });
    expect(seen[2]).toMatchObject({ url: '/v1/coach/threads/t-1', method: 'delete' });
  });

  it('sendMessage posts the .strict() body — threadId OMITTED for a new thread, present for a reply', async () => {
    const seen = recordRequests(authApi);
    await coachService.sendMessage('how do I fix squat depth?');
    await coachService.sendMessage('and knee cave?', '3b241101-e2bb-4255-8caf-4136c566a962');

    expect(seen[0].url).toBe('/v1/coach/chat');
    expect(seen[0].method).toBe('post');
    // Key must be ABSENT, not null/undefined — the schema is .strict() and
    // threadId, when present, must be a uuid.
    expect(JSON.parse(seen[0].data)).toEqual({ message: 'how do I fix squat depth?' });

    expect(JSON.parse(seen[1].data)).toEqual({
      message: 'and knee cave?',
      threadId: '3b241101-e2bb-4255-8caf-4136c566a962',
    });
  });

  it('sendMessage attaches Idempotency-Key when a key is supplied', async () => {
    const seen = recordRequests(authApi);
    await coachService.sendMessage('how do I fix squat depth?', null, 'key-abc');
    expect(seen[0].url).toBe('/v1/coach/chat');
    expect(seen[0].idempotencyKey).toBe('key-abc');
  });

  it('sendMessage sends NO Idempotency-Key when none is supplied (Card 4 behaviour unchanged)', async () => {
    const seen = recordRequests(authApi);
    await coachService.sendMessage('how do I fix squat depth?');
    await coachService.sendMessage('and knee cave?', '3b241101-e2bb-4255-8caf-4136c566a962');
    expect(seen[0].idempotencyKey).toBeUndefined();
    expect(seen[1].idempotencyKey).toBeUndefined();
  });

  // THE POINT OF THE WHOLE CARD. The server fingerprints the WHOLE validated
  // body (message + threadId) and pairs it with the key, so a retry that
  // changes either one is correctly a 400 mismatch, and a key regenerated per
  // attempt dedupes nothing while looking correct.
  it('a retry sends the SAME key and the SAME body', async () => {
    const seen = recordRequests(authApi);
    const key = newIdempotencyKey();
    const threadId = '3b241101-e2bb-4255-8caf-4136c566a962';

    await coachService.sendMessage('ok thanks', threadId, key); // first attempt — fails in real life
    await coachService.sendMessage('ok thanks', threadId, key); // "Try again"

    expect(seen[0].idempotencyKey).toBe(seen[1].idempotencyKey);
    expect(seen[0].data).toBe(seen[1].data);
    expect(JSON.parse(seen[1].data)).toEqual({ message: 'ok thanks', threadId });
  });

  it('a retry of a NEW-thread message keeps threadId ABSENT, so the server resumes the thread it opened', async () => {
    const seen = recordRequests(authApi);
    const key = newIdempotencyKey();
    await coachService.sendMessage('first question', null, key);
    await coachService.sendMessage('first question', null, key);
    expect(JSON.parse(seen[0].data)).toEqual({ message: 'first question' });
    expect(seen[0].data).toBe(seen[1].data);
    expect(seen[0].idempotencyKey).toBe(seen[1].idempotencyKey);
  });

  it('every composed message gets its OWN key', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });

  it('the module carries no raw fetch, no localStorage, no old-backend base URL', () => {
    const src = readFileSync(fileURLToPath(new URL('./coachApi.js', import.meta.url)), 'utf8');
    // Usage patterns, not prose — the header comment legitimately NAMES the
    // deleted localStorage/fetch path while documenting why it's gone.
    expect(src).not.toMatch(/fetch\s*\(/);
    expect(src).not.toMatch(/localStorage\s*[.[]/);
    expect(src).not.toMatch(/VITE_ML_API_URL/);
    expect(src).not.toMatch(/from '.\/mlApi'/);
  });
});

// ── Message-list sequencing ──────────────────────────────────────────────────
// T3 V1 (BLOCKING, and the mapper tests were structurally unable to see it):
// the "Try again" button was addressed PER MESSAGE while the send writes to the
// TAIL. Two addressing schemes for one action, so a button left armed on an
// older failed bubble resent the right key into the WRONG message — overwriting
// a newer, successful reply with an older answer. The invariant that closes the
// CLASS, not just that path: at most ONE message may carry a retry offer, and
// it is always the last one.
describe('message-list sequencing (the retry write target)', () => {
  const failed = (text) => ({
    role: 'assistant',
    content: 'Sorry, I ran into an error.',
    retry: { text, threadId: null, key: 'key-1' },
  });

  it('composing a new message strips EVERY earlier retry offer', () => {
    const prior = [{ role: 'user', content: 'A' }, failed('A')];
    const next = appendOutgoing(prior, 'B');

    expect(next.filter((m) => m.retry !== undefined)).toHaveLength(0);
    expect(next.slice(-2)).toEqual([
      { role: 'user', content: 'B' },
      { role: 'assistant', content: '' },
    ]);
    // The earlier exchange survives — only the offer is withdrawn.
    expect(next[1].content).toBe('Sorry, I ran into an error.');
    expect(prior[1].retry).toBeDefined(); // pure: the input is not mutated
  });

  it('replaceTailAssistant replaces an assistant tail', () => {
    const out = replaceTailAssistant(
      [{ role: 'user', content: 'q' }, { role: 'assistant', content: '' }],
      { role: 'assistant', content: 'answer' },
    );
    expect(out[1]).toEqual({ role: 'assistant', content: 'answer' });
    expect(out[0]).toEqual({ role: 'user', content: 'q' });
  });

  it('replaceTailAssistant NEVER rewrites a user message, and is safe when empty', () => {
    const userTail = [{ role: 'user', content: 'q' }];
    expect(replaceTailAssistant(userTail, { role: 'assistant', content: 'x' })).toBe(userTail);
    expect(replaceTailAssistant([], { role: 'assistant', content: 'x' })).toEqual([]);
  });
});

// ── The error → copy/affordance mapping ──────────────────────────────────────
// Branching on the STATUS alone is the defect this table exists to prevent:
// there are TWO different 429s meaning opposite things (quota vs burst cap) and
// TWO different 409s giving opposite advice (wait vs send it again). Telling a
// user to wait when they should resend — or to UPGRADE when they have questions
// left — is an error message asserting something that is not happening.
describe('coachErrorInfo', () => {
  it('rate_limited says "too quickly" and NEVER the upgrade copy', () => {
    const info = coachErrorInfo(apiError(429, 'rate_limited'));
    expect(info.content).toMatch(/too quickly/i);
    expect(info.content).not.toMatch(/upgrade/i);
    expect(info.retry).toBe('same-key');
  });

  it('quota_exceeded keeps the quota copy and offers NO retry (retrying cannot help)', () => {
    const info = coachErrorInfo(apiError(429, 'quota_exceeded'));
    expect(info.content).toMatch(/upgrade/i);
    expect(info.retry).toBeNull();
  });

  // The two 409s, side by side — the whole reason names beat statuses.
  it('the two 409s give OPPOSITE advice', () => {
    const inFlight = coachErrorInfo(apiError(409, 'request_in_flight'));
    const notReplayable = coachErrorInfo(apiError(409, 'retry_not_replayable'));

    expect(inFlight.content).toMatch(/already being sent/i);
    expect(inFlight.content).not.toMatch(/send it again/i);
    expect(inFlight.retry).toBe('same-key');

    expect(notReplayable.content).toMatch(/send it again/i);
    expect(notReplayable.content).not.toMatch(/already being sent/i);
    expect(notReplayable.retry).toBe('same-key');

    expect(inFlight.content).not.toBe(notReplayable.content);
  });

  it('coach_unavailable blames the coach, not the user, and offers a retry', () => {
    const info = coachErrorInfo(apiError(503, 'coach_unavailable'));
    expect(info.content).toMatch(/unavailable/i);
    expect(info.retry).toBe('same-key');
  });

  // Both would fail identically on a same-key retry, so a button would be a lie.
  it('not_found and validation_error offer NO retry', () => {
    expect(coachErrorInfo(apiError(404, 'not_found')).retry).toBeNull();
    expect(coachErrorInfo(apiError(400, 'validation_error')).retry).toBeNull();
  });

  // A key error means the server holds NO answer for this body, so a fresh key
  // is a genuine first attempt and cannot duplicate — whereas the SAME key
  // would 400 forever. Defence only: this client mints one key per message.
  it('the two key errors retry with a FRESH key, never the same one', () => {
    expect(coachErrorInfo(apiError(400, 'idempotency_key_mismatch')).retry).toBe('fresh-key');
    expect(coachErrorInfo(apiError(400, 'invalid_idempotency_key')).retry).toBe('fresh-key');
  });

  it('a network failure (no response at all) still offers a same-key retry', () => {
    const info = coachErrorInfo({ message: 'Network Error' });
    expect(info.content).toMatch(/error/i);
    expect(info.retry).toBe('same-key');
  });

  // VERIFIED, not assumed: the global @fastify/rate-limit throws a plain Error
  // with no `code`, so app.ts's typed-error branch does not claim it and the
  // client receives {error: "request_error"} at status 429. An unrecognised 429
  // must therefore fall back to "too quickly" — the one thing it must never do
  // is tell a user with questions left to upgrade.
  it('an UNRECOGNISED 429 says "too quickly", never the upgrade copy', () => {
    const info = coachErrorInfo(apiError(429, 'request_error'));
    expect(info.content).toMatch(/too quickly/i);
    expect(info.content).not.toMatch(/upgrade/i);
    expect(info.retry).toBe('same-key');
  });

  it('an unrecognised non-429 falls back to the generic message with a retry', () => {
    const info = coachErrorInfo(apiError(500, 'internal_error'));
    expect(info.content).toMatch(/ran into an error/i);
    expect(info.retry).toBe('same-key');
  });
});
