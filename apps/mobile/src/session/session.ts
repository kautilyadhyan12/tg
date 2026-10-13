import {
  SIGNED_IN_ELSEWHERE,
  phoneKeptSessionSchema,
  phoneRefreshResponseSchema,
  sendCodeResponseSchema,
  verifyCodePhoneResponseSchema,
  type AuthUser,
  type PhoneKeptSession,
  type SendCodeResponse,
  type VerifyCodePhoneResponse,
} from "@app/shared";
import { post, type Answer, type Server } from "./calls";

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

interface SessionOptions {
  server: Server;
  store: KeyStore;
  onChange: (state: SessionState) => void;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

export interface Session {
  state: () => SessionState;
  /** Reads the key store: signed in at once if it holds a sign-in, internet or none. */
  start: () => Promise<void>;
  sendCode: (email: string) => Promise<Answer<SendCodeResponse>>;
  verifyCode: (email: string, code: string) => Promise<Answer<VerifyCodePhoneResponse>>;
  /** One at a time: a second call while one is away waits for the same one. */
  refresh: () => Promise<void>;
  refreshIfDue: () => Promise<void>;
  signOut: () => Promise<void>;
  /** In memory only, for the requests a signed-in screen makes. */
  accessToken: () => string | null;
}

export function createSession({
  server,
  store,
  onChange,
  now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: SessionOptions): Session {
  let state: SessionState = { kind: "starting" };
  let kept: PhoneKeptSession | null = null;
  let access: { token: string; at: number } | null = null;
  /** The refresh that is away, and whose sign-in it is for: one at a time for each. */
  let refreshing: { run: Promise<void>; of: PhoneKeptSession } | null = null;

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

  const keep = async (next: PhoneKeptSession, accessToken: string) => {
    kept = next;
    access = { token: accessToken, at: now() };
    try {
      await twice(() => store.write(JSON.stringify(next)));
    } catch {
      // Signed in for as long as the app stays open. The key store still holds the token
      // before this one, which the server takes again until this one is used.
    }
  };

  /** Memory first, so nothing of the last person is shown; then the key store, which must not keep them. */
  const forget = async () => {
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

    sendCode: (email) => post(server, "/v1/auth/code/send", { email }, sendCodeResponseSchema),

    verifyCode: async (email, code) => {
      const answer = await post(
        server,
        "/v1/auth/code/verify",
        { email, code, client: "phone" },
        verifyCodePhoneResponseSchema,
      );
      if (answer.kind === "ok") {
        const { user, tokens } = answer.data;
        await keep({ refreshToken: tokens.refreshToken, user }, tokens.accessToken);
        show({ kind: "in", user });
      }
      return answer;
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
