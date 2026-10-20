// A gym's payment-company tokens, locked before they reach the database (ROADMAP 18d-i;
// spec Part 3 §14.5): AES-256-GCM under `PAYMENT_TOKENS_KEY`, with the gym, the company and
// which token it is as the authenticated data, so a token copied onto another gym's row, or
// swapped for its partner, does not open. `v1.` names the scheme, so a second key can be
// added beside it one day.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface TokenBox {
  lock(plain: string, context: TokenContext): string;
  /** Null when it does not open: another key, another context, or changed bytes. */
  open(sealed: string, context: TokenContext): string | null;
}

export interface TokenContext {
  gymId: string;
  provider: "square";
  kind: "access" | "refresh";
}

const SCHEME = "v1";

function aad(context: TokenContext): Buffer {
  return Buffer.from(`${context.provider}:${context.gymId}:${context.kind}`, "utf8");
}

export function createTokenBox(keyBase64: string): TokenBox {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("PAYMENT_TOKENS_KEY must be 32 bytes");
  return {
    lock(plain, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad(context));
      const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return [SCHEME, iv.toString("base64url"), body.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
    },
    open(sealed, context) {
      const parts = sealed.split(".");
      if (parts.length !== 4 || parts[0] !== SCHEME) return null;
      const [, ivText = "", bodyText = "", tagText = ""] = parts;
      const iv = Buffer.from(ivText, "base64url");
      const tag = Buffer.from(tagText, "base64url");
      if (iv.length !== 12 || tag.length !== 16) return null;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(aad(context));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(Buffer.from(bodyText, "base64url")), decipher.final()]).toString("utf8");
      } catch {
        return null;
      }
    },
  };
}
