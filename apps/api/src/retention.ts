// Part 4 §5.2's account-deletion window, in ONE place.
//
// §5.2 defines a single number: the soft-delete window between Day 0 (the
// user asks to be deleted) and the hard cascade. FOUR things state or enforce
// it, and before this file existed all four hard-coded 14 independently:
//   · the DB undo window            (modules/users/repo.ts, restoreUser)
//   · the restore-token TTL          (modules/auth/service.ts, issueRestoreToken)
//   · the two user-facing strings    (modules/users/routes.ts, DELETE /v1/users/me)
//   · the Day-14 purge sweep         (modules/privacy)
//
// They all derive from here now, because the number is LIKELY TO CHANGE and
// the failure mode is nasty. Kd's open privacy-scope question (DECISIONS
// 2026-07-21) may widen the product beyond India's DPDP: GDPR's "without
// undue delay" is conventionally ≤30 days, CCPA's is 45. The recorded
// engineering assessment is that building this worker now boxes nothing in
// PROVIDED the window is one named constant — this file is that promise kept.
//
// Why the COPY derives from it too: if only the code read the constant, the
// day the window moves to 30 the API would still tell the user "you have 14
// days to undo" while purging at 30. The app would be lying about its own
// deletion behaviour, produced by the very change meant to keep it lawful.
export const DPDP_RETENTION_DAYS = 14;

/** The same window in milliseconds, for the one-time-token TTL. */
export const DPDP_RETENTION_MS = DPDP_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** How long the consent log outlives a purged account (Kd, 2026-09-09: keep
 *  the proof of the disclaimer tap for as long as a claim could still be
 *  brought, then remove it — six years covers the longest common limitation
 *  period across the US, Europe, India and Canada). Counted from the day the
 *  account was deleted, in whole days.
 *
 *  THE `+ 2` IS THE LEAP DAYS AND IT IS THE POINT. Six calendar years span
 *  2191 or 2192 days depending on where 29 February falls in them, so a plain
 *  `6 * 365` (2190) deletes the proof one or two days BEFORE the sixth
 *  anniversary — the one direction this number must never err in, because the
 *  row is evidence and the claim it answers is still live on that day. 2192 is
 *  the longer of the two spans, so this is never short and at most a day long.
 *  privacy.export.test.ts pins it against real dates. */
export const CONSENT_PROOF_RETENTION_YEARS = 6;
export const CONSENT_PROOF_RETENTION_DAYS = CONSENT_PROOF_RETENTION_YEARS * 365 + 2;
