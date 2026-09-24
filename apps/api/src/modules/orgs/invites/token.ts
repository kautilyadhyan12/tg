// The tokens in an invitation's links (Part 3 §9.12, §10.2): the invitation's id and a
// MAC over it, both base64url. Opaque to the reader, unguessable without the server's
// key, and good for as long as the invitation exists. Each link has its own purpose in
// the MAC, so an unsubscribe token can never say "Not me", nor the other way round.
import { createHmac, timingSafeEqual } from "node:crypto";
import { MEMBER_INVITE_UNSUBSCRIBE_TOKEN } from "@app/shared";

const MAC_BYTES = 16;

export type InviteLinkPurpose = "unsubscribe" | "not_me";

const DOMAIN: Readonly<Record<InviteLinkPurpose, string>> = {
  unsubscribe: "member-invite-unsubscribe:",
  not_me: "member-invite-not-me:",
};

const macOf = (key: Buffer, purpose: InviteLinkPurpose, id: Buffer): Buffer =>
  createHmac("sha256", key).update(DOMAIN[purpose]).update(id).digest().subarray(0, MAC_BYTES);

export function inviteLinkToken(key: Buffer, purpose: InviteLinkPurpose, inviteId: string): string {
  const id = Buffer.from(inviteId.replace(/-/g, ""), "hex");
  if (id.length !== 16) throw new Error("an invitation id is not a uuid");
  return `${id.toString("base64url")}.${macOf(key, purpose, id).toString("base64url")}`;
}

/** The invitation id a token names, or null for anything the server did not make for
 *  this purpose. */
export function readInviteLinkToken(key: Buffer, purpose: InviteLinkPurpose, token: string): string | null {
  if (!MEMBER_INVITE_UNSUBSCRIBE_TOKEN.test(token)) return null;
  const [idPart, macPart] = token.split(".");
  if (idPart === undefined || macPart === undefined) return null;
  const id = Buffer.from(idPart, "base64url");
  const given = Buffer.from(macPart, "base64url");
  if (id.length !== 16 || given.length !== MAC_BYTES) return null;
  // One spelling only: the last character of each part carries bits nothing reads, so
  // the same bytes have other spellings, each a new key to the link's rate limit.
  if (id.toString("base64url") !== idPart || given.toString("base64url") !== macPart) return null;
  if (!timingSafeEqual(given, macOf(key, purpose, id))) return null;
  const hex = id.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const unsubscribeToken = (key: Buffer, inviteId: string): string => inviteLinkToken(key, "unsubscribe", inviteId);

export const readUnsubscribeToken = (key: Buffer, token: string): string | null => readInviteLinkToken(key, "unsubscribe", token);
