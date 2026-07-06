# DECISIONS.md — judgment calls beyond the spec (Part I §5)

Format: date · spec § affected · decision · reason.

- 2026-07-06 · (tooling, spec silent) · Test runner = vitest ^2 · de-facto standard for pnpm/TS monorepos; approved at P0.1 gate.
- 2026-07-06 · (tooling, spec silent) · Node >= 22 pinned via engines; pnpm 9.15.4 via packageManager field · current LTS.
- 2026-07-06 · Part I §6 · Branch protection on master NOT enforced — GitHub Free + private repo returns 403 · green-before-merge is procedural until GitHub Pro or the repo goes public.
- 2026-07-06 · Part 4 §1 · Migration file named 0001_init (drizzle-kit generated 0000; file + journal tag renamed) · spec's naming convention wins.
- 2026-07-06 · Part 4 §1/§3 · Bare `REFERENCES` kept as generated (`ON DELETE NO ACTION`) rather than rewriting to `RESTRICT` · matches the §3 DDL literally; NO ACTION and RESTRICT differ only under deferred constraints, which we don't use.
- 2026-07-06 · Part 4 §8 · Seeded now: plans + feature_flags. Deferred: exercises (needs Part 2 §6 + 2B App A METs), definitions (needs P1.8 ported constants), achievements (needs badges.py port), demo-org fixture (needed by Part 3 console work) · each lands with its owning task.
- 2026-07-07 · v1 §19 · Deployment target stays Hetzner per spec; the VPS is provisioned (and spend starts, ~₹400–1,200/mo) only at P0.4b · owner accepts the cost as the stack's one pre-revenue line item; all other services ride free tiers until real usage.
- 2026-07-07 · (tooling) · tsx added as api devDep for `pnpm --filter api dev` · TS runner; dev-only.

## Pending (SPEC GAPs raised, awaiting Kd)

- Part 5 §1.2 vs Part 4 §3.3: plan-row codes for org USD book and org annual (×10) book — `plans` holds one currency+interval per row; codes like `org_micro_us_m` / `org_micro_in_y` need ratifying before P3.1.
- Part 4 §3.3: org plans' subscriber `entitlements` ("console features") shape unspecified — seeded `{}`.
- Part 4 §3.3: `name_key` convention unspecified — using `plan.<code>` until ratified.
