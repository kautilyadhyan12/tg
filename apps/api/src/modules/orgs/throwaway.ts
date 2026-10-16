// Throwaway email domains, refused at the Manage door (RULINGS 2026-09-08, layer 1).
// The list is a public one copied into throwawayDomains.txt; it is read once, at boot.

import { readFileSync } from "node:fs";
import { emailDomain } from "@app/shared";

const DOMAINS = new Set(
  readFileSync(new URL("./throwawayDomains.txt", import.meta.url), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line !== "" && !line.startsWith("#")),
);

/** True for an address at a listed domain or at any subdomain of one. */
export function isThrowawayEmail(email: string): boolean {
  const domain = emailDomain(email);
  if (domain === null) return false;
  const labels = domain.split(".");
  // Stops before the last label: a bare "com" is never a listed domain.
  for (let i = 0; i < labels.length - 1; i += 1) {
    if (DOMAINS.has(labels.slice(i).join("."))) return true;
  }
  return false;
}

export const THROWAWAY_DOMAIN_COUNT = DOMAINS.size;
