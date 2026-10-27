import { CURRENT_DISCLAIMER_VERSION } from "@app/shared";
import type { Ask, AskInit } from "../src/session/calls";
import type { KeyStore } from "../src/session/session";

// A stand-in server and key store, for the rules (vitest) and the screens (jest) alike.

export const API = "http://localhost:3000";

export const RAVI = {
  id: "7b0c8a52-6f0e-4d59-9a3c-1f2e3d4c5b6a",
  email: "ravi@example.com",
  displayName: "Ravi",
  emailVerified: true,
  locale: "en",
  units: "metric",
};

export const tokens = (n: number) => ({ accessToken: `access-${String(n)}`, refreshToken: `refresh-${String(n)}` });
/** A sign-in the phone kept, with the person's tick on today's "Before you start" unless told `null`. */
export const kept = (n: number, user = RAVI, signUpNote: string | null = CURRENT_DISCLAIMER_VERSION.sign_up) =>
  JSON.stringify({ refreshToken: `refresh-${String(n)}`, user, ...(signUpNote === null ? {} : { signUpNote }) });

/** The person's profile as the server sends it; `agreed`: their tick on today's sign-up note. */
export const profile = (agreed: boolean, user = RAVI) => ({
  user: {
    ...user,
    // The machine's own zone, so the phone has nothing to save unless a test says otherwise.
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    weightKg: null,
    leaderboardOptOut: false,
    onboardingCompleted: false,
    signUpDisclaimerAgreed: agreed,
    createdAt: "2026-10-14T09:00:00.000Z",
  },
});

export interface Reply {
  status: number;
  body: unknown;
}
/** What a route does with a request: answer, fail as a lost connection does (`throw`), or never answer. */
export type Route = (body: unknown) => Reply | Promise<Reply>;

export const never = (): Promise<Reply> => new Promise(() => undefined);
export const lost = (): Reply => {
  throw new TypeError("Network request failed");
};
export const refusal = (status: number, error: string, message: string, more: object = {}): Reply => ({
  status,
  body: { error, message, requestId: "req-1", ...more },
});

export interface Asked {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

/** A server of the routes it is handed; any other path answers 404. `/health` is up, and the
 *  profile says the person ticked "Before you start", and no gym has invited or taken them, unless told. */
export function fakeServer(routes: Record<string, Route>): { ask: Ask; asked: Asked[]; paths: () => string[] } {
  const asked: Asked[] = [];
  const all: Record<string, Route> = {
    "/health": () => ({ status: 200, body: { status: "ok" } }),
    // Somebody who ticked "Before you start" long ago, unless a test says otherwise.
    "/v1/users/me": () => ({ status: 200, body: profile(true) }),
    // No invitation waiting and no gym joined, unless a test says otherwise.
    "/v1/orgs/invitations": () => ({ status: 200, body: { address: RAVI.email, addressProved: true, invitations: [] } }),
    "/v1/orgs/mine": () => ({ status: 200, body: { orgs: [], formerOrgs: [] } }),
    ...routes,
  };
  const ask: Ask = async (url: string, init: AskInit) => {
    const path = new URL(url).pathname;
    asked.push({
      method: init.method ?? "GET",
      path,
      body: init.body === undefined ? undefined : (JSON.parse(init.body) as unknown),
      headers: init.headers ?? {},
    });
    const route = all[path];
    const reply = route === undefined ? refusal(404, "not_found", "Not found") : await route(asked.at(-1)?.body);
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body) };
  };
  return { ask, asked, paths: () => asked.map((one) => one.path) };
}

/** The key store, in memory. `value` is what the phone would hold after a restart. */
export function memoryStore(value: string | null = null): KeyStore & { value: string | null } {
  const store = {
    value,
    read: () => Promise.resolve(store.value),
    write: (next: string) => {
      store.value = next;
      return Promise.resolve();
    },
    clear: () => {
      store.value = null;
      return Promise.resolve();
    },
  };
  return store;
}

/** The Dashboard clock's own words, "10:20:11" and "Tue, 27 Oct 2026": the phone's time, not a number the server sends. */
export const isClockWords = (words: string): boolean =>
  /^\d{1,2}:\d{2}:\d{2}$/.test(words) || /^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4}$/.test(words);
