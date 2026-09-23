// What invitations need from the environment, worked out once (Part 3 §9.12).
//
// Two switches. The KEY alone lets invitations be read and unsubscribed from: every
// invitation and suppression is stored under it, so an unsubscribe link already sent
// keeps working, and the list keeps showing who was invited, while sending is off.
// SENDING also needs the invitations' sender and this api's public address. In
// production each must be configured; outside it the api's own address, a key derived
// from JWT_SECRET and the logging sender stand in.
import { createHmac } from "node:crypto";
import type { AppConfig } from "../../../config.js";

export interface InviteSender {
  /** `Name <box@domain>` for the invitations' sub-domain, or null for the logging
   *  sender (development and tests only). */
  from: string | null;
  /** Where the unsubscribe links point: this api. */
  apiOrigin: string;
}

export interface InviteSettings {
  /** The key every stored address HMAC and every unsubscribe token is made with. */
  hmacKey: Buffer;
  /** Where the join link points: the web app. */
  webOrigin: string;
  /** The most invitation emails the whole app sends in any 24 hours. */
  perDay: number;
  /** While true the worker sends nothing and the emails wait. */
  paused: boolean;
  /** Null while sending is switched off. */
  sender: InviteSender | null;
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

/** The settings, or null when there is no key: then nothing can be read or sent. */
export function inviteSettings(config: InviteConfig): InviteSettings | null {
  const common = {
    webOrigin: config.WEB_ORIGIN,
    perDay: config.INVITE_EMAILS_PER_DAY,
    paused: config.INVITES_PAUSED,
  };
  if (config.NODE_ENV === "production") {
    if (config.INVITE_HMAC_SECRET === undefined) return null;
    return {
      ...common,
      hmacKey: Buffer.from(config.INVITE_HMAC_SECRET, "utf8"),
      sender:
        config.INVITE_EMAIL_FROM === undefined || config.API_ORIGIN === undefined
          ? null
          : { from: config.INVITE_EMAIL_FROM, apiOrigin: config.API_ORIGIN },
    };
  }
  return {
    ...common,
    hmacKey:
      config.INVITE_HMAC_SECRET === undefined
        ? createHmac("sha256", config.JWT_SECRET).update("member-invites").digest()
        : Buffer.from(config.INVITE_HMAC_SECRET, "utf8"),
    sender: {
      from: config.INVITE_EMAIL_FROM ?? null,
      apiOrigin: config.API_ORIGIN ?? `http://localhost:${String(config.PORT)}`,
    },
  };
}
