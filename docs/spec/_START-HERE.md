# START HERE — how these nine files are used

These are the binding spec, split from `aihomegym.pdf` so each task chat gets **only** what it needs. The companion `OPUS-IMPLEMENTATION-PLAYBOOK.md` is the rulebook — it goes into **every** chat (or once into Project knowledge). Never upload the raw PDF or the old code zip to a task chat.

## The files
| File | Contents |
|---|---|
| `00-architecture-v1.md` | Master blueprint: decisions, monorepo, modules, data, tenancy, build order (§22) |
| `01-part2-form-engine-eds.md` | **Keystone**: Form Engine, definitions, trace harness, porting plan |
| `02-part2b-trust-layer.md` | Calories, meal-photo portions, recommendations, predictions |
| `03-part3-org-console.md` | Gym/studio/clinic console — screens, roles, rollups |
| `04-part4-database.md` | Full DDL, conventions, canonical SQL, Mongo→PG migration |
| `05-part5-billing.md` | Money: providers, webhook doctrine, proration, dunning, test matrix |
| `06-part6-mobile.md` | Expo app: pose spike, offline sync, running, RevenueCat, stores |
| `07-part7-retention.md` | Form Score™, streaks, challenges, share loop |
| `08-part8-ops-runbook.md` | Deploys, alerts, drills, launch checklist |

## Per-phase upload map (chat = playbook + these + touched source files)
- **P0 Foundation:** 00 (§4, §17–19, §22) · 04 (whole) · 08 (§1–2)
- **P1 Engine:** 01 (whole) · 00 (§5)
- **P2 One backend:** 00 (§6–9, §13) · 04 (§3–5, §7) · 02 (for coach/nutrition ports)
- **P3 Money & orgs:** 05 (whole) · 03 (whole) · 04 (§3.2–3.3, §4) · 00 (§8–11)
- **P4 Exercise line:** 01 (§5–6, §9–10) · 07 (feature cards)
- **P5 Mobile:** 06 (whole) · 05 (§4.3)
- **P6 Pilots & ops:** 08 (whole) · 07

## First chat, step by step
1. New chat (inside the Project, if you made one).
2. Upload: the playbook · `00-architecture-v1.md` · `04-part4-database.md` · `08-part8-ops-runbook.md`.
3. Paste template **T1** filled in for task **P0.1**.
4. Approve/correct the plan → **T2** → run the commands it gives you → paste output back → review with Part VI → commit → close chat.

## Errata (binding — full list is Playbook Part 0)
58 exercises final (v1's "59" is stale) · 12 family templates · I2 "bit-for-bit" is scoped by Part 2 §7.4 tolerances (scores ±5 authoring slack, holds ±700 ms; integers exact) · every numeric gate is quoted from the spec line, never recalled from memory · the PDF's duplicate Part 2 was dropped; these files are the working copies.
