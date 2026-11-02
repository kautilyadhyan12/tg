// FIREBASE CLOUD MESSAGING, the HTTP v1 API (spec Part 6 §6). The one file that talks to Google for
// notifications: a service account signs in with a signed JWT, and each message goes to one phone's
// address. Every reply is parsed (`@app/shared`); nothing Google sends is logged, and neither is an
// address or a message's words.
import { readFileSync } from "node:fs";
import jwt from "jsonwebtoken";
import {
  fcmErrorReplySchema,
  fcmSendReplySchema,
  firebaseServiceAccountSchema,
  googleServiceTokenSchema,
  type FirebaseServiceAccount,
} from "@app/shared";

export type PushResult = "sent" | "gone" | "failed";

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** One notification per tag on the phone: the next one with the same tag replaces it. */
  tag: string;
  channelId: string;
  data: Record<string, string>;
}

export interface PushSender {
  send(message: PushMessage): Promise<PushResult>;
}

/** Reads and checks the key file Firebase's console downloads. A file that is missing or not a
 *  service account's key stops the boot. */
export function readServiceAccount(path: string): FirebaseServiceAccount {
  const text = readFileSync(path, "utf8");
  return firebaseServiceAccountSchema.parse(JSON.parse(text));
}

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TIMEOUT_MS = 10_000;

export function createFcmSender(deps: {
  account: FirebaseServiceAccount;
  now: () => Date;
  fetch?: typeof fetch;
}): PushSender {
  const doFetch = deps.fetch ?? fetch;
  const { account } = deps;
  let cached: { token: string; until: number } | null = null;

  const accessToken = async (): Promise<string | null> => {
    const nowMs = deps.now().getTime();
    if (cached !== null && cached.until > nowMs) return cached.token;
    const iat = Math.floor(nowMs / 1000);
    const assertion = jwt.sign(
      { iss: account.client_email, scope: SCOPE, aud: account.token_uri, iat, exp: iat + 3600 },
      account.private_key,
      { algorithm: "RS256" },
    );
    const res = await doFetch(account.token_uri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = googleServiceTokenSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return null;
    // Renewed five minutes before Google's own end.
    cached = { token: parsed.data.access_token, until: nowMs + Math.max(0, parsed.data.expires_in - 300) * 1000 };
    return cached.token;
  };

  return {
    async send(message) {
      try {
        const token = await accessToken();
        if (token === null) return "failed";
        const res = await doFetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            message: {
              token: message.token,
              notification: { title: message.title, body: message.body },
              data: message.data,
              android: {
                collapse_key: message.tag,
                notification: { tag: message.tag, channel_id: message.channelId },
              },
            },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const reply: unknown = await res.json().catch(() => null);
        if (res.ok) return fcmSendReplySchema.safeParse(reply).success ? "sent" : "failed";
        if (res.status === 401) cached = null;
        const error = fcmErrorReplySchema.safeParse(reply);
        // Google's own word that the address is gone: the app was removed or its address replaced.
        const gone =
          res.status === 404 ||
          (error.success && (error.data.error.details ?? []).some((d) => d.errorCode === "UNREGISTERED"));
        return gone ? "gone" : "failed";
      } catch {
        return "failed";
      }
    },
  };
}
