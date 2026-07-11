// P2.2 — canonical bundle serialization. The stored sha256 IS the ETag
// (Part 4 §3.4), so it must be deterministic: JSON with recursively sorted
// object keys (plain JSON.stringify would hash insertion order). GAP-1 ruling
// (DECISIONS P2.2): sha256-only integrity for v1; a real signature is a later
// card when mobile arrives.
import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** The hash covers everything content-addressable about a bundle: channel,
 *  manifest, and the definition documents themselves (bundle_version is the
 *  DB identity, assigned after hashing). */
export function bundleSha256(input: {
  channel: string;
  manifest: Record<string, number>;
  definitions: unknown[];
}): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}
