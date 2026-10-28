import {
  SIGNED_IN_ELSEWHERE,
  googlePhoneStartResponseSchema,
  phoneKeptSessionSchema,
  phoneRefreshResponseSchema,
  sendCodeResponseSchema,
  verifyCodePhoneResponseSchema,
  type AuthUser,
  type CheckinPhoneDayKey,
  type PhoneKeptSession,
  type SendCodeResponse,
  type VerifyCodePhoneResponse,
} from "@app/shared";
import { call, post, type Answer, type Request, type Server, type Shape } from "./calls";
import type { AskGoogle } from "./google";

/** The phone's own key store (Android's Keystore, the iPhone's Keychain), or a test's stand-in. */
export interface KeyStore {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
  clear: () => Promise<void>;
}

export type SessionState =
  | { kind: "starting" }
  /** `note`: why the sign-in screen is showing, when the person did not just open the app. */
  | { kind: "out"; note: string | null }
  | { kind: "in"; user: AuthUser };

export const SIGNED_OUT_NOTES = {
  own: "You’re signed out.",
  elsewhere: SIGNED_IN_ELSEWHERE.message,
  ended: "Your session ended. Sign in again.",
} as const;

/** A refresh with no answer is tried again, soon and then less soon. The server answers the
 *  same token again for as long as the one that replaced it was never used (spec Part 3
 *  §10.5), so a reply lost here costs nothing, today or the next time the app is opened. */
export const REFRESH_RETRY_AFTER_MS = [2_000, 5_000, 10_000] as const;
const REFRESH_WAIT_MS = 8_000;
/** The access token lasts 15 minutes; a new one is asked for when the app is opened past this. */
const REFRESH_DUE_MS = 10 * 60 * 1000;

const anything = { safeParse: (raw: unknown) => ({ success: true as const, data: raw }) };

/** Sign in with Google: the server's answer, or Google's box closed by the person or broken. */
export type GoogleSignIn = Answer<VerifyCodePhoneResponse> | { kind: "closed" } | { kind: "failed" };

interface SessionOptions {
  server: Server;
  store: KeyStore;
  /** Google's own box; without one, Google's sign-in is broken on this phone. */
  google?: AskGoogle;
  onChange: (state: SessionState) => void;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

export interface Session {
  state: () => SessionState;
  /** Reads the key store: signed in at once if it holds a sign-in, internet or none. */
  start: () => Promise<void>;
  /** `robotToken`: the robot check's answer, only once the server has asked for it. */
  sendCode: (email: string, robotToken?: string) => Promise<Answer<SendCodeResponse>>;
  verifyCode: (email: string, code: string) => Promise<Answer<VerifyCodePhoneResponse>>;
  /** The server's one-time word, Google's box with it, then Google's answer to the server. */
  signInWithGoogle: () => Promise<GoogleSignIn>;
  /** One at a time: a second call while one is away waits for the same one. */
  refresh: () => Promise<void>;
  refreshIfDue: () => Promise<void>;
  signOut: () => Promise<void>;
  /** In memory only, for the requests a signed-in screen makes. */
  accessToken: () => string | null;
  /** A request as the person signed in now. A token the server no longer takes is refreshed
   *  once and the request sent again; with no token and no answer to the refresh, `no_answer`. */
  signedIn: <T>(request: Omit<Request, "token">, shape: Shape<T>) => Promise<Answer<T>>;
  /** The version of "Before you start" this phone knows the person ticked, or null. */
  signUpNote: () => string | null;
  /** Kept with the sign-in, once the server has said the person ticked that version. */
  keepSignUpNote: (version: string) => Promise<void>;
  /** The name the server now holds for this person, kept with the sign-in and shown at once. */
  keepName: (displayName: string) => Promise<void>;
  /** Whether the server has said this person finished setup, as this phone last heard it. */
  setupDone: () => boolean;
  keepSetupDone: (done: boolean) => Promise<void>;
  /** This sign-in's keys for passes with no signal, none until the server has given them. */
  passKeys: () => readonly CheckinPhoneDayKey[];
  /** Which sign-in this is: a new number at each sign-in and sign-out, never at a refresh. */
  signInNumber: () => number;
  /** Kept with the sign-in they were asked for (`signIn`), so keys that come back after a sign-out
   *  or another sign-in are dropped, and signing out takes them away. */
  keepPassKeys: (keys: readonly CheckinPhoneDayKey[], signIn: number) => Promise<void>;
  /** Whether the last places the server answered held one the person belongs to; null before any. */
  belongs: () => boolean | null;
  keepBelongs: (belongs: boolean) => Promise<void>;
}

export function createSession({
  server,
  store,
  google = () => Promise.resolve({ kind: "failed" }),
  onChange,
  now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: SessionOptions): Session {
  let state: SessionState = { kind: "starting" };
  let kept: PhoneKeptSession | null = null;
  let access: { token: string; at: number } | null = null;
  /** The refresh that is away, and whose sign-in it is for: one at a time for each. */
  let refreshing: { run: Promise<void>; of: PhoneKeptSession } | null = null;
  let signIns = 0;

  const show = (next: SessionState) => {
    state = next;
    onChange(next);
  };

  /** A key store that fails once is asked once more: one bad read must not show Get started. */
  const twice = async <T>(ask: () => Promise<T>): Promise<T> => {
    try {
      return await ask();
    } catch {
      return await ask();
    }
  };

  const readKept = async (): Promise<PhoneKeptSession | null> => {
    try {
      const written = await twice(store.read);
      if (written === null) return null;
      const parsed = phoneKeptSessionSchema.safeParse(JSON.parse(written));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };

  /** Writes this sign-in to the key store. If it was left while the write was away (Sign out, or
   *  another person), the store is put back to what the phone holds now: a late write never undoes
   *  a sign-out. */
  const writeKept = async (mine: PhoneKeptSession) => {
    try {
      await twice(() => (kept === mine ? store.write(JSON.stringify(mine)) : Promise.resolve()));
    } catch {
      // Signed in for as long as the app stays open. The key store still holds the token
      // before this one, which the server takes again until this one is used.
    }
    const held = kept;
    if (held === mine) return;
    try {
      await (held === null ? store.clear() : store.write(JSON.stringify(held)));
    } catch {
      if (held === null) await store.write("").catch(() => undefined);
    }
  };

  const keep = async (next: PhoneKeptSession, accessToken: string) => {
    kept = next;
    access = { token: accessToken, at: now() };
    await writeKept(next);
  };

  /** Memory first, so nothing of the last person is shown; then the key store, which must not keep them. */
  const forget = async () => {
    signIns += 1;
    kept = null;
    access = null;
    try {
      await store.clear();
    } catch {
      await store.write("").catch(() => undefined);
    }
  };

  const refreshOnce = async (mine: PhoneKeptSession): Promise<"done" | "no_answer"> => {
    const answer = await post(
      server,
      "/v1/auth/refresh",
      { refreshToken: mine.refreshToken },
      phoneRefreshResponseSchema,
      REFRESH_WAIT_MS,
    );
    // Signed out, or signed in again, while it was away: the answer is nobody's.
    if (kept !== mine) return "done";
    if (answer.kind === "no_answer") return "no_answer";
    if (answer.kind === "ok") {
      // `mine` is read now, after the reply, so a tick kept while this was away comes with it.
      await keep({ ...mine, refreshToken: answer.data.tokens.refreshToken }, answer.data.tokens.accessToken);
    } else if (answer.status === 401) {
      await forget();
      show({
        kind: "out",
        note: answer.error === SIGNED_IN_ELSEWHERE.error ? SIGNED_OUT_NOTES.elsewhere : SIGNED_OUT_NOTES.ended,
      });
    }
    return "done";
  };

  const refresh = (): Promise<void> => {
    const mine = kept;
    if (mine === null) return Promise.resolve();
    // The last person's refresh, still away, is not this person's.
    if (refreshing !== null && refreshing.of === mine) return refreshing.run;
    const run = (async () => {
      for (const pause of [0, ...REFRESH_RETRY_AFTER_MS]) {
        if (pause > 0) await wait(pause);
        if (kept !== mine || (await refreshOnce(mine)) === "done") return;
      }
    })().finally(() => {
      if (refreshing?.run === run) refreshing = null;
    });
    refreshing = { run, of: mine };
    return run;
  };

  /** Read afresh after each wait: a sign-out or another person may have come in between. */
  const whoNow = () => kept?.user.id ?? null;

  const sendAs = <T>(request: Omit<Request, "token">, shape: Shape<T>, token: string) =>
    call(server, { ...request, token }, shape);

  return {
    state: () => state,
    accessToken: () => access?.token ?? null,
    refresh,
    refreshIfDue: () => (access !== null && now() - access.at < REFRESH_DUE_MS ? Promise.resolve() : refresh()),

    start: async () => {
      kept = await readKept();
      show(kept === null ? { kind: "out", note: null } : { kind: "in", user: kept.user });
      await refresh();
    },

    sendCode: (email, robotToken) =>
      post(server, "/v1/auth/code/send", robotToken === undefined ? { email } : { email, robotToken }, sendCodeResponseSchema),

    verifyCode: async (email, code) => {
      const answer = await post(
        server,
        "/v1/auth/code/verify",
        { email, code, client: "phone" },
        verifyCodePhoneResponseSchema,
      );
      if (answer.kind === "ok") {
        const { user, tokens } = answer.data;
        signIns += 1;
        await keep({ refreshToken: tokens.refreshToken, user }, tokens.accessToken);
        show({ kind: "in", user });
      }
      return answer;
    },

    signInWithGoogle: async () => {
      const start = await post(server, "/v1/auth/google/phone/start", {}, googlePhoneStartResponseSchema);
      if (start.kind !== "ok") return start;
      const asked = await google(start.data.clientId, start.data.nonce);
      if (asked.kind !== "token") return asked;
      const answer = await post(server, "/v1/auth/google/phone", { idToken: asked.idToken }, verifyCodePhoneResponseSchema);
      if (answer.kind === "ok") {
        const { user, tokens } = answer.data;
        signIns += 1;
        await keep({ refreshToken: tokens.refreshToken, user }, tokens.accessToken);
        show({ kind: "in", user });
      }
      return answer;
    },

    signedIn: async (request, shape) => {
      const mine = kept;
      if (mine === null) return { kind: "no_answer" };
      if (access === null) await refresh();
      const first = access;
      // A refresh gives the same person a new kept object; a sign-out or another person does not.
      if (first === null || whoNow() !== mine.user.id) return { kind: "no_answer" };
      const answer = await sendAs(request, shape, first.token);
      if (answer.kind !== "refused" || answer.status !== 401) return answer;
      // Its fifteen minutes ran out while the app was open: one refresh, then once more.
      if (access === first) access = null;
      await refresh();
      const next = access;
      // Never sent again as whoever is signed in now, unless it is the same person.
      if (next === null || whoNow() !== mine.user.id) return { kind: "no_answer" };
      return sendAs(request, shape, next.token);
    },

    signUpNote: () => kept?.signUpNote ?? null,

    keepSignUpNote: async (version) => {
      // The same object, so a refresh that is away still knows it as this person's.
      const mine = kept;
      if (mine === null) return;
      mine.signUpNote = version;
      await writeKept(mine);
    },

    setupDone: () => kept?.setupDone === true,

    keepSetupDone: async (done) => {
      const mine = kept;
      if (mine === null || (mine.setupDone === true) === done) return;
      mine.setupDone = done;
      await writeKept(mine);
    },

    passKeys: () => kept?.passKeys ?? [],

    signInNumber: () => signIns,

    keepPassKeys: async (keys, signIn) => {
      const mine = kept;
      if (mine === null || signIn !== signIns) return;
      mine.passKeys = keys.slice(0, 2);
      await writeKept(mine);
    },

    belongs: () => kept?.belongs ?? null,

    keepBelongs: async (belongs) => {
      const mine = kept;
      if (mine === null || mine.belongs === belongs) return;
      mine.belongs = belongs;
      await writeKept(mine);
    },

    keepName: async (displayName) => {
      const mine = kept;
      if (mine === null || mine.user.displayName === displayName) return;
      mine.user = { ...mine.user, displayName };
      show({ kind: "in", user: mine.user });
      await writeKept(mine);
    },

    signOut: async () => {
      const mine = kept;
      await forget();
      show({ kind: "out", note: SIGNED_OUT_NOTES.own });
      // Told to the server when it can be reached; the phone is signed out either way.
      if (mine !== null) await post(server, "/v1/auth/logout", { refreshToken: mine.refreshToken }, anything);
    },
  };
}
