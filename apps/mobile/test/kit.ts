import { CURRENT_DISCLAIMER_VERSION, FOOD_ALLERGY_CAUTION } from "@app/shared";
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
/** A sign-in the phone kept, with the person's tick on today's "Before you start" unless told `null`,
 *  and setup finished unless told `false`. */
export const kept = (n: number, user = RAVI, signUpNote: string | null = CURRENT_DISCLAIMER_VERSION.sign_up, setupDone = true) =>
  JSON.stringify({
    refreshToken: `refresh-${String(n)}`,
    user,
    ...(signUpNote === null ? {} : { signUpNote }),
    ...(setupDone ? { setupDone } : {}),
  });

/** The person's profile as the server sends it; `agreed`: their tick on today's sign-up note, `setupDone`: setup finished. */
export const profile = (agreed: boolean, user = RAVI, setupDone = true) => ({
  user: {
    ...user,
    // The machine's own zone, so the phone has nothing to save unless a test says otherwise.
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    weightKg: null,
    leaderboardOptOut: false,
    pushGymMessages: true,
    pushPlaces: true,
    pushComments: true,
    onboardingCompleted: setupDone,
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
/** A day's version as the server's reply carries it: sixteen hex figures, another for other meals. */
export function versionOf(day: number, meals: unknown): string {
  let a = 5381;
  let b = 52711;
  for (const c of `${String(day)}|${JSON.stringify(meals)}`) {
    a = (a * 33 + c.charCodeAt(0)) % 4294967296;
    b = (b * 31 + c.charCodeAt(0)) % 4294967296;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

const NO_PLAN = {
  days: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, meals: [], planned: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }, target: null, off: null, version: versionOf(day, []) })),
  make: { status: "ok" },
  choice: "suggested",
  caution: FOOD_ALLERGY_CAUTION,
  labelCaution: null,
};

/** A day of the phone's own calendar, n days before today, as the server writes it. */
export function dayKey(back: number, now = new Date()): string {
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

const NO_FACT = { under: 0, on: 0, over: 0, judged: 0 };
/** The week in food (34f-i) as the server answers it: `span` days ending today, none with meals unless
 *  `day` says otherwise (by how many days back it is). */
export function foodWeekReply(span: 7 | 30 = 7, day: (back: number) => Record<string, unknown> = () => ({}), facts: Record<string, unknown> = {}) {
  return {
    span,
    days: Array.from({ length: span }, (_, i) => {
      const back = span - 1 - i;
      return {
        day: dayKey(back), today: back === 0, meals: 0, about: false, kcal: 0, proteinG: 0, carbsG: 0, fatG: 0,
        fiberG: { amount: 0, notKnown: 0 }, sodiumMg: { amount: 0, notKnown: 0 },
        targets: { kcal: 2300, proteinG: 120, carbsG: 280, fatG: 75 }, targetsOfTheDay: true, bands: null,
        ...day(back),
      };
    }),
    facts: { kcal: NO_FACT, proteinG: NO_FACT, carbsG: NO_FACT, fatG: NO_FACT, ...facts },
  };
}

/** The four training reminders as they start (19e-i). */
export const OFF_REMINDERS = [
  { kind: "workout", on: false, time: "18:00", days: [1, 2, 3, 4, 5, 6, 7], paused: false },
  { kind: "breakfast", on: false, time: "08:00", days: [1, 2, 3, 4, 5, 6, 7], paused: false },
  { kind: "lunch", on: false, time: "13:00", days: [1, 2, 3, 4, 5, 6, 7], paused: false },
  { kind: "dinner", on: false, time: "19:30", days: [1, 2, 3, 4, 5, 6, 7], paused: false },
];

export function fakeServer(routes: Record<string, Route>): { ask: Ask; asked: Asked[]; paths: () => string[] } {
  const asked: Asked[] = [];
  const all: Record<string, Route> = {
    "/health": () => ({ status: 200, body: { status: "ok" } }),
    // Somebody who ticked "Before you start" long ago, unless a test says otherwise.
    "/v1/users/me": () => ({ status: 200, body: profile(true) }),
    // No invitation waiting and no gym joined, unless a test says otherwise.
    "/v1/orgs/invitations": () => ({ status: 200, body: { address: RAVI.email, addressProved: true, invitations: [] } }),
    "/v1/orgs/mine": () => ({ status: 200, body: { orgs: [], formerOrgs: [] } }),
    // Setup's health question not answered and its note never ticked, unless a test says otherwise.
    "/v1/users/me/health-screening": () => ({
      status: 200,
      body: { healthScreening: { answered: false, hasCondition: null, checkFirst: null, safeMode: false, noCalorieCut: false, updatedAt: null } },
    }),
    "/v1/users/me/consents": () => ({ status: 200, body: { consents: [], total: 0 } }),
    // No meal plan made yet, unless a test says otherwise.
    "/v1/nutrition/diet-plan": () => ({ status: 200, body: NO_PLAN }),
    // No meals in the week, unless a test says otherwise.
    "/v1/nutrition/food-week": () => ({ status: 200, body: foodWeekReply() }),
    // Every training reminder off, as they start, unless a test says otherwise.
    "/v1/users/me/reminders": () => ({ status: 200, body: { reminders: OFF_REMINDERS, safeMode: false } }),
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
