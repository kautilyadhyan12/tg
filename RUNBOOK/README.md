# RUNBOOK

Operational procedures, one file per moving part (Part 8). Each entry is added
by the task that creates the component it operates.

Current entries:

- `load-usda-food-table.md` — filling the USDA food table in a new environment
  (ROADMAP Stage 4 item 1)
- `fill-lead-email-keys.md` — the Leads list's email problems for leads written before
  migration 0052 (ROADMAP 20c-v-b)
- (P0.4b adds deploy/rollback; Part 8 tasks add alerts, backup/restore drill,
  break-glass, secret rotation)

Conventions: every procedure starts with "symptoms", ends with "verify recovered";
commands are copy-pasteable; secrets referenced by escrow name (Part 8 §1), never
by value.
