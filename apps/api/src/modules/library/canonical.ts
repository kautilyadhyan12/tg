// One text for one content: JSON with every object's keys in sorted order. A stored entry comes back
// from jsonb with its keys in jsonb's own order, so plain JSON.stringify would call an unchanged
// exercise changed, and a copy's fingerprint would move with nothing new in it.
import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  // Only checked data comes here (a parsed file or entry), so every value is one JSON can hold.
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
