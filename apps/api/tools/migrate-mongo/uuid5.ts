// P2.7b — deterministic UUIDv5 (RFC 4122 §4.3, SHA-1) via node:crypto. In-house
// (~30 lines) rather than the `uuid` package — DECISIONS 2026-07-13 G4. Every
// migrated row's id = uuidv5(mongoObjectIdHex) so re-runs are no-ops and
// cross-collection refs survive without a lookup table (Part 4 §7:867-871).
import { createHash } from "node:crypto";

/** Frozen project namespace (DECISIONS 2026-07-13 G2 — NEVER change). */
export const NAMESPACE_AIHG = "4fc832e8-4827-4475-bf8a-e72cc4b611c7";

const uuidToBytes = (uuid: string): Buffer => Buffer.from(uuid.replace(/-/g, ""), "hex");

const bytesToUuid = (b: Buffer): string => {
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

/** UUIDv5(namespace, name). Deterministic: same inputs → same UUID, forever. */
export function uuidv5(name: string, namespace: string = NAMESPACE_AIHG): string {
  const hash = createHash("sha1").update(uuidToBytes(namespace)).update(Buffer.from(name, "utf8")).digest();
  const bytes = hash.subarray(0, 16);
  // readUInt8/writeUInt8 return `number` (not `number|undefined`) — avoids the
  // banned non-null `!` under noUncheckedIndexedAccess.
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6); // version 5
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8); // RFC 4122 variant
  return bytesToUuid(bytes);
}
