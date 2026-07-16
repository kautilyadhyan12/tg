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
import { coachService } from './coachApi';

function recordRequests(api) {
  const seen = [];
  api.defaults.adapter = async (config) => {
    seen.push({ url: config.url, method: config.method, params: config.params, data: config.data });
    return { data: {}, status: 200, statusText: '', headers: {}, config, request: {} };
  };
  return seen;
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
    expect(seen[0]).toMatchObject({ url: '/v1/coach/threads', method: 'get', params: { limit: 20 } });
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
