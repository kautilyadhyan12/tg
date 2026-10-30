# Load the packaged-food lists

**When.** Once per environment, after the migrations, before anyone scans a barcode there (ROADMAP
Stage 4 item 1). Again about every three months for Open Food Facts, because its daily files cannot say
a product was deleted, and whenever USDA publishes a new Branded Foods download (twice a year).

**Symptoms that it has not been run.** Every barcode reads "not found"; `SELECT count(*) FROM
off_products` returns 0. Nothing errors, and the nightly update says `not_loaded` and asks nobody.

**What it does.** Reads each file into a staging table, then in one transaction writes what changed and
removes what the file no longer holds. Members keep reading the old rows until it commits. A second run
writes nothing. A file holding under half of what the list holds is refused and nothing changes. It
needs no key or account.

**Sizes, measured 2026-10-30.** Open Food Facts' CSV 1.53 GB, its JSONL 13.3 GB, USDA's zip 452 MB
(3 GB unpacked; the importer reads three of its files). In Postgres, see `handoff/2026-10-30-33b-iii-a.md`.

**The free plan's limit.** Neon's free plan blocks every write in the database past 1 GB ("Exceeding 1
GB of Postgres storage in a project... blocks writes"). Never load these lists on it.

**Run it.** As `load-usda-food-table.md`: the tool never reads `apps/api/.env` or `DATABASE_URL`, and a
real environment passes the variable's NAME, so no password reaches the shell's history.

```bash
curl -L -A "AIHomeGym/1.0 (<the app's address>)" -o off.jsonl.gz https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz
# Download the Branded Foods CSV zip from https://fdc.nal.usda.gov/download-datasets and unpack it into ./usda
read -rs PROD_DATABASE_URL && export PROD_DATABASE_URL      # paste the address; it is not echoed
corepack pnpm --filter api exec tsx tools/import-packaged-foods.ts --database-url-env=PROD_DATABASE_URL --off=off.jsonl.gz --usda=usda
```

**A real server loads the JSONL, a folder's own database the CSV.** The CSV mixes Open Food Facts' own
estimates in with the labels' figures and cannot tell them apart (49 of a real day's 6,010 products
carry only an estimate). The JSONL marks them, and the importer never reads them as a label. The
whole JSONL has not yet been run through the importer: its lines are the daily file's, whose reader was
checked against the CSV on 2026-10-30 (`handoff/2026-10-30-33b-iii-a.md`). Check the counts it prints.

**Then switch on the nightly update.** On the worker, `PACKAGED_FOOD_UPDATES=on` and
`OPEN_FOOD_FACTS_CONTACT=<the app's address>`: their page asks for "AppName/Version (ContactEmail)".
It runs at 04:37. A file it refuses (mostly unusable, or not their shape) changes nothing and reaches
Sentry as a failed job; the next night tries again. Their list of files keeps two weeks: the log line
`packaged.update_gap` means days were missed, and this page's import puts them right.

**Licence.** ODbL 1.0 for Open Food Facts: the notice under the foods stays (section 4.3), and because
our copy is filtered, a free public file must give the method of making it (section 4.6). That is owed
before launch: ROADMAP Stage 4 item 8. Nothing a member makes is ever written to these tables, so
section 4.5 keeps it out of the licence. USDA's data is public domain, CC0 1.0.
