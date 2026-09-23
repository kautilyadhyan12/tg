// What invitations need from the environment, worked out once (Part 3 §9.12).
//
// In production every piece must be configured or invitations are OFF: the routes
// answer `invites_off` and the worker sends nothing. Outside production the api's own
// address, a key derived from JWT_SECRET and the logging sender stand in, so the
// feature can be built and tested without an email account.
import { createHmac } from "node:crypto";
import type { AppConfig } from "../../../config.js";

export interface InviteSettings {
  /** The key every stored address HMAC and every unsubscribe token is made with. */
  hmacKey: Buffer;
  /** `Name <box@domain>` for the invitations' sub-domain, or null for the logging
   *  sender (development and tests only). */
  from: string | null;
  /** Where the unsubscribe links point: this api. */
  apiOrigin: string;
  /** Where the join link points: the web app. */
  webOrigin: string;
  /** The most invitation emails the whole app sends in any 24 hours. */
  perDay: number;
  /** While true the worker sends nothing and the emails wait. */
  paused: boolean;
}

type InviteConfig = Pick<
  AppConfig,
  | "NODE_ENV"
  | "PORT"
  | "JWT_SECRET"
  | "WEB_ORIGIN"
  | "API_ORIGIN"
  | "INVITE_EMAIL_FROM"
  | "INVITE_HMAC_SECRET"
  | "INVITE_EMAILS_PER_DAY"
  | "INVITES_PAUSED"
>;

/** The settings, or null when invitations are switched off. */
export function inviteSettings(config: InviteConfig): InviteSettings | null {
  const common = {
    webOrigin: config.WEB_ORIGIN,
    perDay: config.INVITE_EMAILS_PER_DAY,
    paused: config.INVITES_PAUSED,
  };
  if (config.NODE_ENV === "production") {
    if (config.INVITE_EMAIL_FROM === undefined || config.INVITE_HMAC_SECRET === undefined || config.API_ORIGIN === undefined) {
      return null;
    }
    return {
      ...common,
      hmacKey: Buffer.from(config.INVITE_HMAC_SECRET, "utf8"),
      from: config.INVITE_EMAIL_FROM,
      apiOrigin: config.API_ORIGIN,
    };
  }
  return {
    ...common,
    hmacKey:
      config.INVITE_HMAC_SECRET === undefined
        ? createHmac("sha256", config.JWT_SECRET).update("member-invites").digest()
        : Buffer.from(config.INVITE_HMAC_SECRET, "utf8"),
    from: config.INVITE_EMAIL_FROM ?? null,
    apiOrigin: config.API_ORIGIN ?? `http://localhost:${String(config.PORT)}`,
  };
}
