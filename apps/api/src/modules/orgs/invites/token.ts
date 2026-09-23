// The unsubscribe link's token (Part 3 §9.12): the invitation's id and a MAC over it,
// both base64url. Opaque to the reader, unguessable without the server's key, and
// good for as long as the invitation exists.
import { createHmac, timingSafeEqual } from "node:crypto";
import { MEMBER_INVITE_UNSUBSCRIBE_TOKEN } from "@app/shared";

const MAC_BYTES = 16;

const macOf = (key: Buffer, id: Buffer): Buffer =>
  createHmac("sha256", key).update("member-invite-unsubscribe:").update(id).digest().subarray(0, MAC_BYTES);

export function unsubscribeToken(key: Buffer, inviteId: string): string {
  const id = Buffer.from(inviteId.replace(/-/g, ""), "hex");
  if (id.length !== 16) throw new Error("an invitation id is not a uuid");
  return `${id.toString("base64url")}.${macOf(key, id).toString("base64url")}`;
}

/** The invitation id a token names, or null for anything the server did not make. */
export function readUnsubscribeToken(key: Buffer, token: string): string | null {
  if (!MEMBER_INVITE_UNSUBSCRIBE_TOKEN.test(token)) return null;
  const [idPart, macPart] = token.split(".");
  if (idPart === undefined || macPart === undefined) return null;
  const id = Buffer.from(idPart, "base64url");
  const given = Buffer.from(macPart, "base64url");
  if (id.length !== 16 || given.length !== MAC_BYTES) return null;
  if (!timingSafeEqual(given, macOf(key, id))) return null;
  const hex = id.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
