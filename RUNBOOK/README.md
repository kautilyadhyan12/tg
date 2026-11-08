# RUNBOOK

Operational procedures, one file per moving part (Part 8). Each entry is added
by the task that creates the component it operates.

Current entries:

- `load-usda-food-table.md` — filling the USDA food table in a new environment
  (ROADMAP Stage 4 item 1)
- `fill-lead-email-keys.md` — the Leads list's email problems for leads written before
  migration 0052 (ROADMAP 20c-v-b)
- `fill-member-name-keys.md` — possible duplicates by name for member records written
  before migration 0056 (ROADMAP 5b-iv-a)
- `set-up-razorpay.md` — Razorpay's keys, plans and webhook for Indian gyms (ROADMAP 1d-i)
- `stop-square.md` — taking back our app's access to one gym's or every gym's Square account
  (ROADMAP 18d-ii)
- `switch-the-map.md` — moving every phone's run map from OpenFreeMap to our own copy of the
  world map, with no new app version (ROADMAP Stage 5 37b-i)
- `migrate-a-tighter-rule.md` — a migration that tightens a rule the running api still writes
  against: stop, migrate, start (ROADMAP Stage 5 21b-ii, migration 0228)
- (P0.4b adds deploy/rollback; Part 8 tasks add alerts, backup/restore drill,
  break-glass, secret rotation)

Conventions: every procedure starts with "symptoms", ends with "verify recovered";
commands are copy-pasteable; secrets referenced by escrow name (Part 8 §1), never
by value.
