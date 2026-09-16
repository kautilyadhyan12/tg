# Load the USDA food table

**When.** Once per environment, after the migrations have run and before anyone
uses the food search there (ROADMAP Stage 4 item 1, and 7a-iii-a). Also after a
future card moves to a newer FoodData Central release.

**Symptoms that it has not been run.** The food search finds the app's own 318
foods and packaged products, but no USDA food; `SELECT count(*) FROM usda_foods`
returns 0. Nothing errors — the USDA rung simply finds nothing.

**What it does.** Downloads the two published FoodData Central releases (SR
Legacy 2018-04, 5.8 MB, and FNDDS 2024-10-31, 3.2 MB) into a cache folder and
upserts all 13,225 foods and their household measures into `usda_foods` and
`usda_food_portions`, in one transaction. The data is public domain, CC0 1.0: no
key, no account, no rate limit. The app credits USDA under the search results.

**Run it.** The database address is the tool's own argument — it does not read
`apps/api/.env` and does not fall back to `DATABASE_URL`, so the address is
always typed out for the database that is meant.

```bash
corepack pnpm --filter api exec tsx tools/import-usda.ts --database-url=<the environment's DATABASE_URL>
```

Local development, for reference:

```bash
docker compose -f infra/docker-compose.dev.yml up -d postgres redis
corepack pnpm --filter api exec tsx tools/import-usda.ts --database-url=postgres://aihg:aihg@localhost:5433/aihg
```

Add `--cache=<dir>` to keep the two zips somewhere other than the system temp
folder. A re-run on a warm cache with nothing to change took 9.7 s (measured
2026-09-16); a first load also writes 44,394 rows.

**Verify recovered.** The tool prints its own counts; they should read:

```
sr_legacy: 7793 foods, 14449 household measures
fndds: 5432 foods, 16720 household measures
13225 foods in the table; 44394 rows written.
```

Then, in the app, search the food box for `cappuccino`: "Coffee, Cappuccino"
comes back under the app's own foods, with the grey line "USDA FoodData Central"
and the credit under the list.

**Safe to re-run.** Every write is an upsert keyed by USDA's own `fdc_id`, and a
row that would not change is not written, so a second run ends with
`13225 foods in the table; nothing changed.` A run that fails part-way changes
nothing at all: it is one transaction.

**If it reports foods left alone.** A line such as `41 foods in the table are
from an older release and were left alone` means USDA retired those entries in
the release being loaded. They are deliberately NOT deleted — a saved meal may
name one, and a person's meal must not lose its food because a survey changed.
