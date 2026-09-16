# HANDOFF — the last thing each chat did (newest first, ten lines each)

Format: date · what was built or decided · what is verified (commands run) · what is open. Older
entries move to `archive/records/` when this file passes forty entries. The record before
2026-09-07 is `archive/records/HANDOFF-2026-07-06-to-2026-09-07.md`.

## 2026-09-16 · 7a-iv-a built: adding a food by measure (branch `food-measures`)

- Kd, shown 7a-iv's plan, ruled the portion redesigned on the professional apps' model (RULINGS 2026-09-16, from two research agents reading MyFitnessPal, Cronometer, MacroFactor, Lose It!, Yazio, Cal AI, SnapCalorie and Foodvisor's own help pages): every food carries its measures, a photo row starts at one only within 30 % of the photo's grams, three pull requests. *"Go, all three (Recommended)"*. ROADMAP 7a-iv → 7a-iv-a, -b, -c.
- Measured for the plan: on his eight plates the model writes a count of 1 for almost every food (mashed avocado, brie, strawberries); within 3× his scrambled eggs, 100 g, became one large egg, 61 g, and a mug of iced coffee, 250 g, USDA's "medium", 496 g.
- Server: the search gives each food its measures and where it starts (`measures.ts`: USDA's household measures named by the importer's rule, moved here; our list reads the entry it cites; its own serving where no USDA measure has its name, at any weight; a label's serving; g and oz). No measure is made of a USDA row of amount 0 whose text states none (frozen kale's 94 g "package (10 oz)") or a survey "Guideline amount" row, and the importer's serving skips them too (local re-import: kale serves by "0.33 cup", 67 g); a name over 40 characters is cut at a clause end only where 20 stay, and never leaves a bracket open; an "oz" serving starts at one ounce only when it weighs one. An item may be `{canonical, measure, amount}`: weighed from the server's list (`unknown_measure`, `portion_out_of_range`), stored as `measure {id, name, amount}` (no migration), kept by an edit that sends the same grams (a food twice in one meal: each item by its place). A saved dish weighs by the food's own "cup" or "half cup", else 1 g a ml, and is stored as a measure; a scan never applies a saved dish (RULINGS 2026-07-18: a saved Medium bowl was used for any "katori").
- Web: `MeasurePicker` in Add food and "Add an ingredient" (saved meal, photo sheet): − / + by half (ten grams), typed amounts, the food's measures then saved dishes, "How full?" for a dish, "Save a new dish…" at Appendix B's global sizes (cup 240, mug 325, bowl 375 ml, or typed); a saved meal reads "Apple: 1.5 × medium (3" dia), 273g". The photo sheet's scanned rows are 7a-iv-b's.
- Our 318 foods on the loaded table: 310 with USDA measures, 139 keep their own serving, 110 have a cup of their own; every start is one of the food's measures; no duplicate id.
- Verified: shared tsc 0 · eslint 0 · 125/125 · api tsc 0 · eslint src test tools 0 · full api on local Postgres 1237/1258 in 68 files, the 21 in `catalog.seed` and `workouts.sync` (ROADMAP 10's race) 30/30 alone; an earlier run 1227/1227 · both route files green on a fresh migrated, seeded database with no USDA table (dropped after) · web nutrition and auth 154/154 · full web 2257 passed, `poseAssets.contract` failing to parse as before · web lint on the changed files: only the 7 errors `Nutrition.jsx` already had · checker 318 foods match · engine grep empty.
- 41 deliberate breaks, each red on its own test, files restored identical (27 of them for the kept scan, the under-1 g amounts and the USDA rows above: no margin, not per person, minutes rounded up, not forgotten at sign-out or on saving, a refusal unsaid, an amount-0 or filler row kept, a cut too short, a bracket left open, the last cup, an edit of one food twice, the importer's first row); the first 14: an unknown measure accepted, the dish's cup ignored, a measure kept for new grams, our list's cited entry unread, no serving dedupe, a saved katori applied to a scan, the amount ignored, a dish read without its owner, the web sending grams, the picker without the server's grams, every food at grams, no measure arm, the meal list without measures, a dish past full.
- Fixed on the way: the "too large dish" route test passed for the wrong reason (`dry_sabzi` is no food, so it was refused as unknown); it now uses beef stew's 255 g cup and checks the error code.
- Kd's click-through: all nine steps passed. From it (RULINGS 2026-09-16): the native `<select>` (a white list on Windows) became `common/Select.jsx`, which opens upward where it would run off the window (headless Edge at 1280×800 and 400×800: off-screen, then on it); a box closes only by its X; "my dish" back to grams keeps the dish's grams with Undo; the X asks before closing an unsaved scan, saying the whole minutes truly left, and Photo Log brings it back within `MEAL_SCAN_TTL_SECONDS` less 30 s, with "New photo" (`unsavedScan.js`: kept in memory above the page, for the signed-in person only, forgotten at sign-out); an amount under 1 g, or one the server refuses, says so in Add food and on an added ingredient's row; 44 px controls, 16 px amounts, Add food a bottom sheet on a phone. Tests: `select.render` 3, `nutritionPhotoSheetClose.render` 8; 7 more deliberate breaks each red (one first stayed green: the test clicked the page's own fixed decoration, not the box's backdrop — fixed); web nutrition, Settings and console 980/981, `settingsHealth` 9/9 alone (ROADMAP 10). Next: CI, the §6 re-check in the reviewer's own chat, merge on Kd's word; a database loaded before this card runs the USDA import again (RUNBOOK `load-usda-food-table.md`); then 7a-iv-b.

## 2026-09-16 · Review rounds ruled: re-checks in the same reviewer chat, a round ends with no Critical/High open (records only, uncommitted)

- Kd, after nine hours for PR #73 and PR #74: *"yes record it and update the rulebook"*. Measured first from the commit times: building 2 h 37 min, review rounds 6 h 02 min, 3 and 4 rounds against the cap of 2, the building and reviewing chats all on Opus.
- `RULINGS.md`: one new 2026-09-16 line under "How work is done"; the "Independent review is KEPT" line and the 2026-09-08 and 2026-09-15 lines carry an AMENDED marker.
- `CLAUDE.md`: §2.6 rewritten (re-checks in the same reviewer chat, the round ends at no Critical/High, Lows never buy a round, risky code is RUN in round one); §4 Tests adds the picking-rule table test before review; §6 now holds two prompts, round one and the re-check.
- Nothing else changed: no code, no tests, no commit. Records ride on the next feature's pull request (§2.8).
- For the 7a-iv chat: `git status` shows `CLAUDE.md`, `RULINGS.md` and `HANDOFF.md` modified before you start. They are this ruling; add them to your first commit with your feature's files. The four dashboard images are still someone else's, uncommitted.
- Next: 7a-iv, from master, its own chat.

## 2026-09-16 · 7a-iii-b: the last re-check's Lows fixed, merged on Kd's "fix and merge" (PR #74)

- The re-check of 82d8a8d found no Critical or High; three Lows and one weak test, all fixed.
- The USDA tie margin is its own constant, `USDA_TIE_KCAL` (10), apart from the macros' rounding `ENERGY_SLACK_KCAL`; the spec's amendment line adds "or within 10 kcal of the nearest entry's".
- The subject of 82d8a8d leaves out "by more than 10 kcal"; the fix commit and the merge message say the rule whole.
- Test: `usda.table` +1, two foods at the tie's edge (an entry outside the error exactly 10 kcal further than the nearest ties and wins as the plainer; 11 further loses).
- Verified: api tsc 0 · eslint src test tools 0 · `usda.table` + `nutrition.scan.unit` + `nutrition.unit` + `nutrition.scan.routes` 104/104 on local Postgres · the SQL margin set to 9 and to 11 each turns the new test red, file restored identical (sha256).
- Not this chat's: the four dashboard images still changed on disk, uncommitted.
- Next: 7a-iv, from master, its own chat.

## 2026-09-16 · 7a-iii-b: the re-check of 4dd4a3d fixed (1 High, 3 Low); the re-check of these fixes next (branch `scanner-prices-every-food`)

- CI green on 4dd4a3d, all six checks (run 35100211807; migrations skipped).
- High: an entry outside the model's error tied with one inside it (mushrooms at 80 → "Mushrooms, pickled" 46). Now the reviewer's rule: an entry ties if it is within the model's error (`EnergySeen.slack`) of what it saw, or within 10 kcal (`ENERGY_SLACK_KCAL`) of the nearest entry of its step. The real function on the loaded table (13,225 rows) gives the reviewer's simulated column on all 24 of its cases: mushrooms 80 and plantain 250 → "cooked with oil"; pumpkin 50/75/100/150 → "Pumpkin, cooked"; sweet corn 130 → "Corn, sweet, yellow, frozen, kernels on cob, unprepared" (98; was "white, raw" 86); apricots 77 → "frozen, sweetened" (98); the rest unchanged.
- The reviewer's class sweep through the real function: 5,267 cases; an entry outside the error picked while one inside existed 110 times (732 before), none more than 10 kcal further than the nearest entry (the most 10.0).
- Lows: a nameless food past the 20th is named by its hint, by one rule the sheet shares (`shownFoodName`); the spec's two lines say "calories per 100 g … more than three times, and more than 10 kcal" and "the plainest entry whose energy is near the model's"; `scanMatch.ts`'s two comments and the ROADMAP line say the rule as it now is.
- Tests: `usda.table` +1 (mushrooms at 80; a food both of whose ways are inside a wide error) · `nutrition.unit`'s overflow test runs a nameless 21st food through `scanSheet`.
- Verified: shared tsc 0 · eslint 0 · 107/107 · api tsc 0 · eslint src test tools 0 · `nutrition.scan.unit` + `nutrition.unit` + `usda.table` + `nutrition.scan.routes` 103/103 on local Postgres · 5 deliberate breaks each red (the old rule, no error margin, no 10 kcal, overflow named by `item.name`, the sheet dropping unknown_items), files restored identical (sha256). Full suite left to CI.
- Next: push, CI, the fresh-chat re-check of these fixes only (§6), Kd's click-through, merge on Kd's word; then 7a-iv.

## 2026-09-16 · 7a-iii-b: the re-check of 23ba391 fixed (1 High, 2 Low); merge on Kd's word (branch `scanner-prices-every-food`)

- CI green on 23ba391, all six checks (run 35096798653; migrations skipped, none changed).
- High: the band's edge and the "nearest" fallback named a way of cooking by a few kcal (pumpkin at 75–150 → "Pumpkin, canned, cooked" 56 over "Pumpkin, cooked" 52). Now, as the reviewer measured: every entry within the model's error (`EnergySeen.slack`, 30 % or 10 kcal) of the nearest entry of its own name step ties, and the plainest wins. On the loaded table: pumpkin 50/75/100/150 → "Pumpkin, cooked"; sweet corn 130 → "Corn, sweet, white, raw"; papaya 120 → "Papaya, raw"; unchanged: radishes 16 raw and 60 pickled, apple 52 raw and 120 baked, iced coffee 5 brewed and 40/44 pre-lightened, tofu 80, water 0, lemon 30, egg 140, mango 60, turnip 70, orange 47; the known cost, plantain 250 → "Plantain, raw" (122).
- Low: a reply of 21–30 foods is read again, its first 20 the rows and the rest named in unknown_items (31 still breaks the contract, as before). Low: the spec's two amendment lines say the table wins "unless its calories are more than three times from the model's own".
- Verified: shared tsc 0 · eslint 0 · 107/107 · api tsc 0 · eslint 0 · `nutrition.scan.unit` + `nutrition.unit` 58/58 · `usda.table` + `nutrition.scan.routes` 44/44 on local Postgres · 4 deliberate breaks (no slack, no tie key, the nearest across every step, foods past 20 kept) each red, files restored identical. Full suite left to CI.
- The local API runs on port 3000 against the local database for Kd's click-through; the web server on 5173 was already running.

## 2026-09-16 · 7a-iii-b: the review of PR #74 fixed (2 High, 6 Low, 4 weak tests); the re-check of these fixes next (branch `scanner-prices-every-food`)

- Kd ruled one thing (RULINGS): our list's foods keep the old portion rule until 7a-iv — *"Wait for 7a-iv (Recommended)"*. Bacon still reads 100 g on the toast plate.
- H1: a USDA food is served at the grams the model saw, USDA's first measure once where it gave none. Pumpkin on "download (3)" is 60 g · 31 kcal (was 460 g · 239), the lemon on (4) 40 g (was 65).
- H2: among the entries one name finds in the same step, the plainest whose kcal per 100 g agrees with the model's (30 % or 10 kcal), else the nearest, else (no estimate) the release rule. The review's own fix, the nearest over every match, was run on the loaded table and dropped: "orange" 47 → "Orange juice, 100%, NFS", "egg" 140 → "Egg Salad…", "steak" 250 → "Steak sandwich…". The real function on the loaded table: radishes 16 → "Radishes, raw" (was pickled) · apple 52 → "Apple, raw" (was dried, 243) · tofu 80 → extra firm (was fried) · water 0 → "Water, NFS" (was tonic) · iced coffee 40 and 44 → "Iced Coffee, pre-lightened and pre-sweetened" (31), where the plates had the model's estimate.
- Lows: L1 macros together no heavier than the food, and divided before multiplied (0.69 g of protein read 100.00000000000001 g per 100 g the other way, which a meal refuses) · L2 `MAX_SCAN_FOODS` 20 in the prompt and the schema, any other food named in unknown_items; the prompt is 84 characters longer, its cost not measured · L3 Change restarts the stepper at ×1 on the row's grams; Undo gives back the scan's count while the grams are the scan's · L4 one hide list for Change and "Add an ingredient": every food on the sheet, as scanned or as it is now, whatever the grams boxes hold · L5 a hint that says there is none asks no table; with no name either, no row · L6 the spec's Stage 1 heading marked amended.
- Outside the diff, from the review: the sheet now says "Calories from a photo are an estimate. A photo cannot detect allergens." (`PHOTO_SCAN_CAUTION`, RULINGS 2026-09-09; the web never had it).
- Weak tests: T1 the eight plates moved into `nutrition.scan.routes`, through the route, the real lookup and a preview of the draft, with the 51 USDA rows they can reach copied from the loaded table; green on that table and on an empty scratch database (`aihg_plates_scratch`, migrated and seeded as CI does) · T2 USDA grams unlike the measure, with a count · T3 the weight rule per macro and together · T4 every vessel through the sheet. The plates' own accounts run on an app of their own: eight more sign-ups passed the 20-an-address sign-in limit the file shares.
- Verified: shared tsc 0 · eslint 0 · 107/107 · api tsc 0 · eslint src test tools 0 · `nutrition.scan.unit` 22/22 · `nutrition.unit` 36/36 · `nutrition.scan.routes` + `usda.table` 43/43 on local Postgres with the USDA table loaded, and 43/43 on the empty scratch database · full api suite 1193/1193 in 66 files on the second run (the first lost 3 in `catalog.seed` to item 10's race, another file's `zz_p22_hidden` exercise counted; 7/7 alone) · web nutrition files 57/57 · engine grep empty · web eslint on `Nutrition.jsx`: the same 7 errors as the committed file (not a CI gate).
- 21 deliberate breaks, each red on the test that claims to catch it, after 19 controls green on the untouched tree; every file restored identical (sha256). Among them: each High reverted, the energy key dropped, made "nearest", or put above the name steps, the service passing no energy, the lookup unwired, each Low reverted, two vessels moved off Appendix B, the caution line removed.
- Not this chat's: four dashboard images changed on disk before this chat; untouched and uncommitted. The scratch database `aihg_plates_scratch` is left in the local container (Kd stopped its removal).
- Next: push, CI, Kd's click-through, the fresh-chat re-check of these fixes only (§6), merge on Kd's word; then 7a-iv.

## 2026-09-16 · 7a-iii-b built: the scanner prices every food it sees (branch `scanner-prices-every-food`)

- What a person sees: every food the photo shows is on the sheet, each row tagged Our list · USDA · Packaged product, or "~120 g · estimate" for a food no table has; the sheet's total, a saved meal and the day's line read "about" while an estimate is in them; "Change" swaps a row's food at the same grams (sent as an added food), with Undo; the sheet credits USDA and Open Food Facts as the search box does. Kd: *"go"* to the plan.
- Server: the reply is one list per food (`mealVision.ts`: vessel from a fixed list, whole pieces, a word where a number belongs is unknown, a list of the wrong length breaks the contract); `scanMatch.ts` prices our list → USDA (`usdaFoodForScan`: whole description, head, then every word with the first-word refusal; FNDDS, fewest words) → a packaged product holding every word → the estimate; a table food over 3× and 10 kcal per 100 g from the model's energy gives way to it; the item carries `per100g`, so a saved meal's grams change without a table; an `est_` canonical is never looked up by name. No migration, no dependency.
- Gemini calls, 9 of the 10 (one unused), tokens in + out: shape check on "download (3)" 610 + 375, $0.001121, all 7 foods in list form but every whole number written "150.0", so the prompt now says "never end in .0". Then the eight: minimalist 606 + 222 $0.000737 · (1) 617 + 393 $0.001168 · (2) 617 + 262 $0.000840 · (3) 617 + 300 $0.000935 · (4) 607 + 177 $0.000625 · (5) 611 + 160 $0.000583 · (6) 606 + 311 $0.000959 · download 617 + 155 $0.000573; no thinking tokens. Average $0.000802 a scan (802.425 micro-USD), under the $0.00086 gate; $0.000679 before (`results.json`). Replies and results in `D:\Projects\ai-home-gym-plates\out-7a-iii-b\`.
- The eight on the loaded USDA table: 44 foods, 35 from a table (33 our list, 2 USDA: pumpkin, lemon), 9 estimates (2 overruling USDA's brewed iced coffee at 1 kcal per 100 g), 0 left out. Replies pinned as `test/fixtures/plates/` through `scanSheet`. Records' slip: the biggest plate is (3), not (2).
- Left for later cards, measured: a table food's portion is still the old rule (bacon 100 g, 548 kcal, where the model saw 30 g — 7a-iv); USDA's scan answer for a bare word our list lacks can be poor ("chicken" → "Chicken, back", "egg" → "Egg, creamed"), words our list covers today; an unlisted alcoholic drink fails the macro-energy check and reads "Not in the total".
- Tests: `nutrition.scan.unit` 20 (bounds, 3× both ways, the order, the eight plates) · `nutrition.scan.routes` 5 (estimate scanned, stepped, saved, patched; forged `est_` refused in a new meal, a preview, a confirm and another person's meal; a stranger 404s; 3× through the route; USDA through the route) · `usda.table` +5 · `scan-cost.unit` 7 · web `nutritionPhotoSources` 6; the old Groq/Gemini contract tests moved to the list form.
- Verified: api tsc 0 · api eslint src test tools 0 · shared tsc 0 · eslint 0 · 106/106 · full api on local Postgres 1178/1178 in 66 files (the run before lost `auth.routes`' setup to item 10's `p21-%` race; 20/20 alone) · web nutrition 25/25, web full 2164 passed with `poseAssets.contract` failing to parse (on this machine before this card) · engine grep empty · 35 deliberate breaks each red (the 900 kcal one only after its test was sharpened), files restored identical.
- Tool: `tools/measure-scan-cost.ts` (+ `scan-cost.ts`): at most ten photos a run, no retries, the key from the GEMINI_API_KEY line only and never printed, refuses an output folder inside the repository.
- Not this chat's: four dashboard images changed on disk today (`Screenshot (221).png` 13:49, `weeklychallenges.png` 13:57, `latestbadges.png` 14:09, `thisweek.png` 14:42) with no other chat running; untouched and uncommitted.
- Next: CI, Kd's click-through (the toast plate), the §6 review round, merge on Kd's word; then 7a-iv.

## 2026-09-16 · 7a-iii-a: the re-check of 0dd5ba1 found no Critical or High; its two test gaps fixed; merge on Kd's word (branch `usda-food-table`)

- The re-check found no defect at any severity and two Low test gaps; per §2.6 these fixes get no further re-check.
- Step 1's first half, a whole name that IS what was typed, was untested: an SR Legacy "Zqxhead" now must rank above the survey release's "Zqxhead split", which the release rule would otherwise put first.
- A place Open Food Facts leaves empty (its deadline passed) goes back to USDA: the test's provider answers nothing for one query, and the box of 15 must hold 15 USDA foods.
- Verified: api tsc 0 · eslint 0 on both files · `usda.table` + `nutrition.usda.routes` 30/30 on local Postgres · two deliberate breaks (the equals half deleted; empty places not given back), each red on its own test, files restored identical.
- Three dashboard images (`Screenshot (221).png`, `latestbadges.png`, `weeklychallenges.png`) changed in the folder from another session; untouched and uncommitted.
- CI green on 25525c8 (run 35076157262; the Neon migration job skipped, no migration changed). Kd: *"mergee"*; merged (PR #73), branch deleted. Next: 7a-iii-b, from master, its own chat.

## 2026-09-16 · 7a-iii-a: the review of d0042c3 fixed (2 High, 3 Low, 4 weak tests); the re-check of these fixes next (branch `usda-food-table`)

- H1: an accented query found nothing ("jalapeño", "purée", "soufflé" 0 rows each) — the index is plain and the entry below took the fold off the query. The review's fix (fold the query alone) would hide every name a later release spells with an accent, so BOTH sides fold with one rule (`usdaWords.ts`): the importer stores `search_text` (the description folded, lower case), 0031 builds the index from it, the head steps read it, `first_word` is folded. Rebuilt local table: jalapeño 4 = jalapeno 4, purée 5, soufflé 8, sautéed 14, açaí 3, pâté 6; pumpkin, banana, oats, orange juice and cappuccino still lead with the same food.
- 0031 edited in place (unmerged): Kd's Neon holds 21 migrations and no `usda_foods` (read-only check); locally its tables and record were dropped and it was applied again.
- H2: a search waits at most 3 s for packaged products, both addresses under one deadline (`OFF_SEARCH_TIMEOUT_MS`); three live searches took 0.8–2.0 s and the fallback's 503 came after 2.5 s. Not run beside USDA's read, which takes milliseconds.
- Lows: packaged products take at most half the places left (4 → 2 + 2; 15 → 12 + 3 as before); a short measure loses its dangling comma (fdc 175258 "cup", 0 left) and a measure with no letter is dropped (0 in either release); the digest is the one the tool was built against — USDA's download page shows none (read today) — in `usda-files.ts`, the RUNBOOK and ROADMAP, and a download failing it is never cached.
- Weak tests: the order fixtures now make each of the three steps red when deleted (the review proved step 2 was not; step 3 was not either); the reserve through the route at 15, 6, 5, 4, 3, 2 and 1 places; accents in both directions and in the head steps. The pinned digests stay untestable in CI (no network): every import and checker run checks them, and both passed today.
- Verified: api tsc 0 · eslint 0 · the four touched files 102/102 · full local 1133/1141, the 8 all `workouts.sync` (a login 500, then 401s; 23/23 alone; ROADMAP 10) · import 13,225 foods and 44,394 rows, a second run `nothing changed` · `check-food-sources` 318 foods, every number matching · 16 deliberate breaks, each red on its own test, files restored identical.
- Not this chat's: two images in `apps/web/public/images/dashboard/` (`Screenshot (221).png` at 13:49, `weeklychallenges.png`) changed while two other sessions were open on this folder; left untouched and uncommitted.
- CI green on 0dd5ba1, all six checks (run 35074076850): gitleaks 20s · what changed 4s · engine grep 10s · the edited 0031 on a Neon branch 65s · api tests on local Postgres 105s (`workouts.sync` green there) · typecheck/lint/test 211s. Open: the fresh-chat re-check of these fixes only, merge on Kd's word. Next: 7a-iii-b, from master, its own chat.

## 2026-09-16 · 7a-iii-a: the plain food ranks above the dishes made from it, and a jar has room again (branch `usda-food-table`)

- What a person sees: typing "pumpkin" gave Muffin, Bread, Cookie, Pie and Pancakes before the vegetable, and "banana" gave Banana split — 13,225 foods tied on "fewest words" and USDA's own id broke the tie. Now what was typed is matched against the HEAD of USDA's own "food, then qualifiers" name in three steps (the head IS what was typed · the description STARTS with it · its first word is the first word typed), then the old rules. Measured on the loaded table: pumpkin → Pumpkin, cooked · banana → Banana, raw · oats → Oats, raw · orange juice → Orange juice, 100%, NFS · cappuccino → Coffee, Cappuccino (unchanged, the one Kd walked).
- The packaged rung had rank but no room: in a box of 15 a generic word left nought for a jar — measured today, curated + USDA before the fix: "milk" 10 + 5, "peanut butter" 2 + 13, "banana" 2 + 13, "greek yogurt" 1 + 14. Now the last three places are held for a packaged product ("milk" 10 + 2 + 3, "peanut butter" 2 + 10 + 3), the reserve never takes the last place USDA has ("bread" 13 + 1 + 1), and a query USDA cannot answer still gives the whole page to jars ("yakult" 0 USDA rows, "oreo" 2, "nutella" 2). Still last, as Kd ruled. THREE is my number, not his — one line changes it.
- A measure's name is cut at a space, not at the fortieth character: 129 rows sat at exactly 40, 110 of them ending mid-word ("3 oz with bone, cooked (yield after bone") and 19 in a trailing space; after the re-import 6 sit at 40, all ending on a word, 0 with a trailing space.
- One word rule now, in `src/modules/nutrition/usdaWords.ts`, for the importer's `first_word`/`word_count` AND the typed query: accents kept (Postgres indexes `crème`, so folding to `creme` could only hide a row) and a decimal kept inside a number (it indexes `3.25`, so 3 and 25 found nothing — 9 descriptions carry one).
- Each release is checked against its published SHA-256 on every run, cache included, before a row is written — the cache is a folder in the shared temp directory and this tool gets pointed at production. And the importer takes `--database-url-env=NAME`, so a real environment's password is never typed on a command line or left in shell history; the RUNBOOK now says so.
- Re-imported into the LOCAL database with the new rules: 13,225 foods, 132 rows written (the measure names and the decimal word counts), everything else left alone.
- New tests: the three order steps on fixture foods (a plain food, a dish that starts with its name, a dish that merely holds it), one food per null guard (protein, carbohydrate and fat were dead to the suite), the ten-word cap, an accented name and a decimal one, the packaged reserve through the route, the digest check on a cached file, the importer's database argument, and the third food in the web list (it was never read).
- Verified: api tsc 0 · api eslint 0 · shared tsc 0 and eslint 0 · engine purity grep prints nothing · `check-harnesses` 24 scripts parse · `check-food-sources` 318 foods, every number still matching · full api suite on local Postgres 1131/1131 in 63 files, run with nothing else on the machine · web food-search render 3/3 and the nutrition pages 19/19 · the search reads 6–9 ms off the index for a word a person types, 20 ms for the widest in either release ("cooked", 2,448 rows).
- Item 10's flake seen again, and not this diff: a full run that shared the machine with other commands lost `catalog.seed` (59 exercises where it asserts 58 — another file's seed) and `workouts.sync` (a login 500 under load); both pass re-run on their own, and the clean full run above is green.
- 15 deliberate breaks — each of the three order steps, the word cap, each of the three null guards, the accent fold, the decimal split, the mid-word cut, the digest check, a silent fall back to `DATABASE_URL`, the reserve set to nought, the reserve taking USDA's last place, and the web list's third row — each red on the test that claims to catch it, each file restored identical.
- Open: CI on this push, then the re-check of these fixes, then merge on Kd's word. Next: 7a-iii-b (the scanner prices every food it sees), from master, its own chat.


## 2026-09-16 · 7a-iii-a built: every USDA food in the food search (branch `usda-food-table`)

- Kd asked whether USDA should rank ABOVE our 318-food list and asked to be argued with, not agreed with. Answer, now RULINGS 2026-09-16: 313 of the 318 copy their numbers from a named USDA entry, and the other 5 are where USDA's own entry is wrong for how the food is made here (its paneer, from milk and vinegar, carries 22 g of carbohydrate against CoFID's 0.9 g, the figure he ruled on 2026-09-14) — so OUR LIST FIRST, then USDA, then packaged products. *"go"*.
- Built: migration `0031` (`usda_foods` with seventeen nutrients per 100 g, a generated English `tsvector` behind a GIN index, and `usda_food_portions`); `tools/usda-files.ts` (the zip and CSV readers, moved out of `check-food-sources.ts`, which now reads them from there), `tools/usda-table.ts` (the upsert), `tools/import-usda.ts` (the runnable tool); the search rung and canonical lookup in the nutrition repo; `nutritionSourceSchema` gains `usda`; the grey "USDA FoodData Central" line and USDA's credit under the search results.
- Loaded into the LOCAL database, the tool's own counts: sr_legacy 7,793 foods and 14,449 measures, fndds 5,432 and 16,720 — 13,225 foods, 44,394 rows written. A second run: `nothing changed`. RUNBOOK `load-usda-food-table.md`; Stage 4 item 1 already names it for production.
- Two traps in the data, both tested: the survey release does not write its portions in `seq_num` order (fdc 2705504 runs 3, 4, 1, 2), and its "Quantity not specified" row can carry a gram weight (280 g), so it cannot be dropped by weight — it is dropped by name. One food has no nutrients at all, FNDDS 2705383 "Milk, human"; the search never offers a food with no energy figure.
- Verified: api tsc 0 · eslint 0 · shared tsc 0 · eslint 0 · 106/106 · full api suite on local Postgres 1117/1117 in 63 files (a first run that shared the machine with the full web suite lost 11 to timeouts; alone it is green — ROADMAP item 10's known seed race, not this diff) · web nutrition files 32/32 · migrations 0001–0031 applied to a scratch database built from nothing · the search reads 0.4 ms off the GIN index.
- Found and fixed while probing boundaries: `usda_sr_2147483648` raised `value "2147483648" is out of range for type integer` instead of answering null — a 500 out of a canonical anyone can type. The id is now bounded to what the `integer` column holds; a test covers it, and removing the bound turns that test red.
- 18 deliberate breaks, each red on the test that claims to catch it and each file restored identical: both halves of the search order, prefixing every word, dropping the query sanitiser, offering an unpriceable food, ignoring the canonical's release, falling through to Open Food Facts, USDA before our list, USDA after packaged products, two nutrients on one column, the survey measure read from the wrong column, portions unsorted, keeping "Quantity not specified", the serving off the last measure, writing an unchanged row, both web notices, and the integer bound just added.
- FOR KD, measured, not blocking: a GENERIC word now fills the box with USDA and leaves no room for a packaged product ("milk" matches 370 USDA foods, "peanut butter" 84, in a box of 15); a BRAND still reaches its jar, because USDA stocks no brands ("yakult" 0, "oreo" 2, "nutella" 2, "monster energy" 5). Nothing was removed. If he would rather a jar always showed, the change is to keep the last few places for packaged products — his call, noted in `service.ts` beside the rung.
- Pre-existing and NOT this diff: `apps/web/src/hooks/poseAssets.contract.test.js` fails to parse on this machine (valid UTF-8, unmodified since 2026-08-18, imports nothing of this card); the rest of the web suite is 2,158 passed. Proven local-only, not inferred: CI's `typecheck / lint / test` job runs the web suite on Linux and passed on this branch.
- CI green on 2cb23eb, all six checks (run 35061848022): what changed 9s · gitleaks 16s · engine grep 10s · drizzle migrations on a Neon branch 59s · api tests on local Postgres 1m58s · typecheck/lint/test 3m23s. PR #73.
- Kd's click-through PASSED, all nine steps (2026-09-16): our Cappuccino above USDA's, the source line under each USDA food, both credits under the list, paneer at 1 g of carbohydrate against USDA's 22 g, and a USDA food added at its own 30 g measure and saved.
- Open: the §6 review round on PR #73, then merge on Kd's word. The two zips are cached at `%TEMP%\ai-home-gym-food-tables`.
- Next: 7a-iii-b (the scanner prices every food it sees), from master, its own chat.

## 2026-09-16 · 7a-iii planned (Fable, plan only — no code): split into 7a-iii-a and 7a-iii-b; 7a-v, 7d and two after-launch lines; Kd: "go"

- Kd asked, with 7a-iii, for what the market's scanners show (micronutrients, secondary macros, portion edits, cooking-method tags, rings, weekly trends, a diet-quality score) on one condition: model cost must not rise. Ruled (RULINGS 2026-09-16, three lines): every nutrient from the USDA table, never the model; 7a-v after 7a-iv; 7d after 7c; the score and the "Cooked how?" chip after launch; the scanner at Google's default temperature (spec Part 2B §3.2 carries the note).
- Measured today: USDA SR Legacy 7,793 foods, FNDDS 5,432 (zips 5.8 MB and 3.2 MB); FNDDS carries all seventeen nutrient columns for 5,431 foods, SR 7,231–7,713 (vitamin D 5,185); household measures for 7,533 and 5,395. Licence read on fdc.nal.usda.gov: public domain, CC0 1.0, list the source.
- The 2026-09-15 scanner chat's scratchpad still holds the eight plates and its scripts: `C:\Users\kautilya\AppData\Local\Temp\claude\D--Projects-ai-home-gym\e6003647-c0fd-4d45-9431-c2c0cfee53de\scratchpad\vision\` — `small\` the 768 px plates, `out-trimmed\results.json` the baseline (211 output tokens and $0.00068 a scan on average; the biggest plate, "download (2)", 301), `proof.mts` and `keys.mts` the measuring scripts. 7a-iii-b copies `small\` and `results.json` to `D:\Projects\ai-home-gym-plates\` first — never into the repository, which is public.
- Reply shapes sized on that plate's measured reply (889 chars → 301 tokens, 2.95 a token): today's keys + five numbers ≈ 401 tokens, short keys ≈ 253, one array per food ≈ 168. Estimates until 7a-iii-b measures them.
- Split, sizing being the chat's (RULINGS 2026-09-08): 7a-iii-a the USDA table in the food search (migration 0031, the import tool, search); 7a-iii-b the scanner (the compact reply, matching by rule with the 3× cross-check, estimate rows, tags, "Change", the cost gate at $0.00086).
- Records only, committed on branch `usda-food-table`, not pushed: RULINGS, ROADMAP (7a-iii-a/b, 7a-v, 7d, Stage 4 item 1, After launch), the spec note, this entry. No code; no suite run (nothing to prove).
- Next: an Opus chat builds 7a-iii-a on this branch (plan to Kd first, ten lines or fewer); then 7a-iii-b from master; then 7a-iv.

## 2026-09-16 · PR #72's fourth re-check: no defects; its weak test and one Low test gap fixed; merged

- The re-check found the High closed (a refused try takes off only its own count, in either order with a give-back) and no new defect. Still open: one weak test and one Low test gap.
- Weak test: `test/redis.scripts.test.ts`, the only test of the counter scripts production runs, was skipped in CI (seen in 3240506's log), so a broken script could merge green. CI's database job now starts a Redis (`redis:7-alpine`) beside its Postgres and sets `TEST_REDIS_URL`.
- Low: the test took any window from 1 to 90 s. Now a first count's window must read 85–90 s, and a later count or a take-off on a 30 s window 25–30 s.
- Verified: api tsc 0 · eslint 0 · redis scripts 3/3 on the local Redis · three deliberate breaks (a fixed 30 s first window; a later count cutting it to 1 s; a take-off setting 5 s) each red on the new test and green on the old, `src/redis.ts` restored identical.
- CI green on b8c9a9a (run 35028211311), the Redis test run there: 3 tests, 60 of 60 test files passed, none skipped.
- Per §2.6 these fixes get no further re-check: no Critical or High is open. Kd: *"merge"*.
- Next: 7a-iii, from master, its own chat.

## 2026-09-16 · PR #72's third re-check fixed (1 High, 1 weak test); a re-check of that fix next

- The re-check passed the Critical and the four weak tests and found one High: the quota check counted a try it refused over the limit and never took it off, so a scan given back after an outage was not free again. A free person (2 a day) whose last scan hung while they tried again (429) was told, after that scan failed, "Daily photo-scan limit reached" with one scan left.
- Fix, the reviewer's: a refused try takes its count off (`decrIfPositive`, in `requireQuota`, so for the coach and routes too); a take-off that fails is logged `quota.refusal_not_uncounted`.
- Tests: the review's sequence through the route (200 · a scan held at the scanner · 429, still 2 counted · the held scan busy, 1 counted · 200); a second refused coach question leaves the count at 5.
- Weak test: the production Lua was run by nothing (every route test uses the in-memory Redis). `test/redis.scripts.test.ts` runs count, give-back and take on the compose Redis; `test:local` sets `TEST_REDIS_URL`; CI has no Redis and skips it (seen skipped without it).
- Verified: api tsc 0 · eslint 0 · nutrition + entitlements routes + entitlements unit + redis scripts + sentry 73/73 on local Postgres and Redis · full local 1074/1074 · 6 deliberate breaks each red (no take-off: both route tests; `c >= 0`; a missing counter decremented; SET for DECR, the window lost; every count resetting the window; take keeping the value), files restored identical.
- Next: CI, the fresh-chat re-check of this fix only, merge; then 7a-iii.

## 2026-09-16 · PR #72's second re-check fixed (1 Critical, 1 High, 2 Low, 4 weak tests); a re-check of these fixes next

- Critical: @sentry/node 10.63 sent a request's body (first 10,000 characters), headers, cookies and query string, and each outgoing call's query string as a breadcrumb, whatever sendDefaultPii says. `src/sentry.ts` (the API and the worker) keeps no body and takes the request and the breadcrumbs off every event. The review's fix left the breadcrumbs: a food search's words still went (measured).
- High: a scan that fails for anything but the photo (an outage, a refusal, a fault, one after the model answered too) gives back what it took, on the server: the scan it counted (`refundQuota`, a Lua decrement that never goes below zero nor makes a key), or a new free retry for a scan that rode one. Three failures in five minutes pause that person's scans in `validateScan`, before a free retry is spent or a scan counted. The review's fix (a free retry per failure) was not enough: that token lives in the open photo sheet for ten minutes, so closing the sheet still lost the scan.
- The failure that starts the pause says "unavailable", not "in a minute"; the pause is shorter than a free retry lasts, so one given back as it begins outlives it.
- Web: a 503 keeps the free retry held unless it brings a new one; a 400 `invalid_retake` drops it: "That free retry has run out. Pick the photo again."
- Lows: a word that says there is none is never named under "Not in the total" (an item's reads as its hint); "The review's case:" gone from the test.
- Tests: what Sentry is sent, through the real SDK on a real port with a recording transport (red on the old options: all seven kinds of request data went); the pause at 4:59.999 and 5:00 in literal minutes; the web's free retry through every answer; the prompt's no-value words read from the prompt.
- Verified: api tsc 0 · eslint 0 · nutrition unit 35/35 · entitlements unit 12/12 · nutrition routes 47/47 + sentry 1/1 on local Postgres · full local 1070/1070 (the run before: 1050 passed and `auth.routes`' setup failed at its `p21-%` user delete; 20/20 alone; ROADMAP 10) · shared tsc 0 · eslint 0 · 106/106 · web 47/47 in the five files that draw Nutrition (its 7 old lint errors, none on changed lines) · the Lua on the local Redis · 24 deliberate breaks each red, files restored identical.
- Next: CI, the fresh-chat re-check of these fixes only, merge; then 7a-iii.

## 2026-09-16 · PR #72's re-check fixed (1 High, 5 Low, 4 weak tests); a re-check of these fixes next

- High: an outage's free retry never ran out and every HTTP error was an outage, so a photo Google answers 400 bought endless provider calls for one scan. Now only 408, 429, a 5xx, the network, the timeout or a reply that is not the provider's is an outage, with a free retry at most 3 times per person in 10 minutes (`MAX_OUTAGE_RETRIES`, counted in Redis, fail closed); any other status is a refusal: 503 `nutrition_unavailable`, no free retry, logged as an error.
- A fault (anything thrown that is not a `VisionProviderError`) is answered like a refusal, since a retry meets the same fault (it was "busy" with a free retry); it is logged with its error and sent to Sentry with the request id through app.ts's `reportError`, which the central error handler now uses too (L4).
- Only the model's answer carries usage, and the error's constructor enforces it, so a reply that is not the provider's writes no zero-token ledger row (DECISIONS 2026-07-12: no completion, no row). Every `nutrition.scan_failed` line carries the request id.
- Lows: "unknown" is no name for a meal, container or size (`NO_VALUE_WORDS`); Groq's empty or null content is "unreadable" with its usage; ROADMAP 7a-i's count line and item 7's line (what the scanner does, not the review story).
- Web: a 503 other than "busy" reads "Try again later · Meal scanning is unavailable right now." with no free retry (it fell to the generic error toast).
- Tests: the chain ends at the third free retry, per person, and starts again after 10 minutes; the review's case through the real Gemini adapter (a fetch answering 400: five tries 503, 503, 429, 429, 429 and 2 provider calls); a real 429 and a broken reply ledger nothing; a fault reaches Sentry with the response's request id; HTTP 300–599 on both providers; empty answers on both; 503 `nutrition_unavailable` and `quota_unavailable` never say busy.
- Verified: api tsc 0 · eslint 0 · nutrition unit 35/35 · full local 1065/1065 · shared tsc 0 · eslint 0 · 106/106 · web 49/49 in the six files that draw Nutrition (its 7 old lint errors, none on changed lines); every new test red before the fix; 15 deliberate breaks each red (the review's "any 503 is busy" among them), files restored identical.
- Next: CI, the fresh-chat re-check of these fixes only, merge; then 7a-iii.

## 2026-09-15 · PR #72 brought up to master, and its review fixed (1 High, 8 Low, 5 weak tests); the re-check of the fixes next

- Master (#71) merged into the branch (4fe2bd9): a photo count left out reads as unknown, as every left-out field does; the scan response keeps #71's `pieces` and drops `cuisineGuess`. Proved: api tsc 0 · eslint 0 · unit 54/54 · local routes 44/44 · shared 106/106 · web 41/41.
- H1: a scanner outage (an HTTP error such as a 429, a network failure, the 30 s timeout, a reply that is not the provider's, a bug) answers 503 `scanner_unavailable` with a fresh free retry every time, even on a retry, and logs `nutrition.scan_failed` with the reason; the photo sheet says "Meal scanning is busy right now — try again in a minute (free retry)" under "Try again". A reply the model sent that cannot be used keeps the photo wording and one retake, logged as a warning.
- Lows: the prompt says every item has a name and a canonical_hint (L1); a reply naming no food is a poor photo (L2); a meal named "N/A", "none" or "null" is "Meal" (L3); a switched-off scanner answers 503 before a scan is counted (L4); temperature goes to Kd in 7a-iii's plan (L5); the scanner's reply schemas are in `@app/shared` (L6); the orgs comment says 7 vs 2 (L7); #72's entry below is ten lines (L8).
- Weak tests: the real scanner wired with and without a key; the spare model's ledger row (660); the 30 s timeout on both providers; "Meal" for an unnamed plate; white painted before the photo, in order.
- Verified: api tsc 0 · eslint 0 · unit 55/55 · local nutrition + entitlements routes 50/50 · shared tsc 0 · eslint 0 · 106/106 · web 44/44 (web lint is not a CI gate: 7 old errors in Nutrition.jsx, none on changed lines). 16 deliberate breaks, one per fix, each red; files restored identical.
- Left as they are: the coach and Open Food Facts adapters still hold their own reply schemas (the coach is off; Stage 4 item 8 replaces the live search).
- Next: CI, the fresh-chat re-check of these fixes and of the merge's conflict resolution, merge; then 7a-iii.

## 2026-09-15 · PR #71's last re-check: no Critical/High; three Lows and one weak test fixed; merged

- The re-check of the kind-first fix found no Critical or High: three Lows in the records and one missing test. Kd: *"fix and merge"*; per §2.6 the fixes are not re-checked.
- Test: a container named by a serving word alone is that serving: servings of rice in a "serving", portions in a "portion", helpings in a "helping" ×3 are 300 g. The reviewer's break (a serving word dropped from such a name) turns it red (100 g); file restored identical.
- Records: the entry below says why "trays of chicken nuggets" never reaches a count (the list finds no food); 7a-i's line keeps the rule, not the rounds, and is ticked; 7a-iv's line describes the whole serving-word problem with each spelling its own test plate.
- Measured by a scratch run: nuggets ×6 are 96 g in "serving", "portion", "helping" or nothing, 16 g in "1 serving", "one serving", "Serving", "single serving"; rice ×3 300 g in "serving", 100 g in "portion", "Portion", "1 portion". Left for 7a-iv, as ruled.
- Verified: api tsc 0 · eslint 0 · nutrition unit 27/27 (outputs in the chat); CI green on 603883e (run 34996184794).
- Next: bring PR #72 up to master (a trial merge conflicts in HANDOFF, ROADMAP, RULINGS, nutrition service.ts and vision.adapter.ts), prove it, then its fresh-chat review; then 7a-iii; then 7a-iv.

## 2026-09-15 · PR #71's re-check of the two: one High in H1's fix, fixed; a re-check of that fix next

- The re-check passed H2's fix and found one High in H1's, three Lows and three weak tests; every number reproduced first by a scratch run of HEAD and 3fd14d4.
- High: H1 read a container by the last word of its name, so one named kind first was read as something else: bowls of stew chunks ×2 in a "bowl with lid" 255 g (was 510), plates of nuggets ×2 on a "plate with rice" 32 g ×2 (16), cups of palak paneer cubes ×2 in a "cup and saucer" 200 g (400).
- Fix: a container is the words of its name that name a container, wherever they stand, never a serving word where another is; a name with none is its last word ("steel flask"). The review's own fix (the last word, or any container word) left "bowl (1 serving)" open: six servings of nuggets were 16 g, now 96.
- Lows: the comment on servings in a serving bowl; "half cup" and "small" off `CONTAINER_WORDS` (a measure and a size name no container); the entry below no longer gives examples no user meets.
- Tests: kind-first names, a trailing serving word, a size, a food and no container word in the word-by-word table; plural container names; the real-food test reads the list with `findCurated`. 9 deliberate breaks each red (the review's rule among them), files restored identical.
- Sweep of 1,278,144 cells (22,824 hints the list resolves × 56 containers, count 3): against 3fd14d4 only H1's serving-word rows (3,703) and H2's (1,104, each its singular's old reading) differ; against the review's fix only the four names ending in a serving word (1,104).
- Verified: api tsc 0 · eslint 0 · nutrition unit 27/27 · foods 22/22 · with routes 83/83 on local Postgres; CI green on 2084a24.
- Found, unchanged since 3fd14d4: a container named by a serving word alone ("single serving") is one of no known size, so six servings of nuggets in it are 16 g (96 in "serving" or in nothing); on 7a-iv's line, whose fixed vessel list reads it as unknown.
- Next: the fresh-chat re-check of this fix only, merge; then #72's review; then 7a-iii; then 7a-iv.

## 2026-09-15 · PR #71's re-check of the four: two Highs in H2's fix, fixed; a re-check of the two next

- The re-check passed H1, L2 and L4 and found two Highs in H2's fix; every number in it reproduced by a scratch run of HEAD first.
- H1: a plural matched any word of the photo's container, so six "servings" of nuggets in a serving bowl were 2,100 g (96) and on a serving plate 16 g. A plural now counts the photo's container only where it is what the container is, the last word of its name or of each name an "or" joins: katoris or bowls in a katori or small bowl ×3 stay 525 g.
- H2: any plural before "of" read as a container: stacks of roti ×8 were one roti (40 g, was 320), and piles of beef stew chunks ×6 1,530 g (found here). Where the photo shows none, only `CONTAINER_WORDS` (what each Appendix B container is, the vessel and pack units, plate, tray, the serving words) or a saved dish's name counts containers; any other plural reads as its singular.
- Tests: the review's rows by the list's own servings; every word of every Appendix B name and four free-text names × every unit × cut tails; nine layout words equal their singular; the word list pinned. 8 deliberate breaks each red (the review's "last word only" among them), file restored identical.
- Sweep, HEAD against the fix: 6,085,248 resolves (318 foods × 416 phrasings × 23 containers × no count or 3): 12,780 changed are H1's kind, 5,602 H2's, 0 elsewhere; every H2 change equals its singular's old reading.
- The list's trade: a plural the food list's matcher does not skip (baskets, thalis, trays, boxes, platters) finds no food at all ("trays of chicken nuggets"), so no scan reaches its count. What users met was H1's cost: a container named kind first ("bowl with lid") read as its last word, so bowls of stew chunks ×2 were 255 g, not 510; fixed in the entry above.
- Verified: api tsc 0 · eslint 0 · nutrition unit 27/27 · foods 22/22 · with routes 83/83 on local Postgres.
- Next: CI, the fresh-chat re-check of these two fixes only, merge; then #72's review; then 7a-iii; then 7a-iv.

## 2026-09-15 · PR #71's four fixes (H1, H2, L2, L4), the reviewer's way; the re-check of the four next

- Kd asked for 7a-iv from master; master has neither #71 nor #72 and 7a-iii is unbuilt, so he kept his order: *"#71's fixes now (Recommended)"*.
- H1: fill scales a food's own serving only where the serving is all its container holds (`WHOLE_VOLUME_UNITS`); red wine in a glass at 0.4 is 150 g, pho in a bowl at 0.6 400 g.
- H2: a plural before "of" (no cut, no "pieces") counts those containers where the photo shows none or one of that name: stew-chunk bowls ×2 510 g, large bowls of dal ×2 550 g; unknown size and no vessel food: no count (plates of nuggets ×2 16 g). "A plate of nuggets" ×6 stays 96 g; "servings of" count servings.
- Chosen over a vessel word list: an unlisted container ("trays of nuggets") would be read as nuggets again. Found by a before/after sweep and fixed: without the photo guard, scoops of ice cream in a cup were two cups.
- L2: the cap reads the top of the range (29 mugs of coffee: 325 g). L4: 0, 2.5, 31, "3", true, {} read as unknown; a missing count still rejects.
- Verified: api tsc 0 · eslint 0 · nutrition unit 26/26 · foods 22/22 · with routes 82/82 · full local 1043/1046 (catalog.seed 3, 7/7 alone: ROADMAP 10's flake); 15 deliberate breaks each red, files restored identical.
- Sweep of 518,976 old/new resolves over 318 foods × 24 phrasings × 9 containers × fill × count: every change is H1, H2 or L2, none elsewhere.
- Left, not among Kd's four: the prototype test's piece line cannot fail (it goes with the resolver in 7a-iv); L3's water cup now multiplies by a plural count ("cups of rice" ×2 480 g), still 7a-iv's.
- Next: CI, the fresh-chat re-check of these four fixes only, merge; then #72's review; then 7a-iii; then 7a-iv.

## 2026-09-15 · The portion is redesigned (7a-iv), Kd's ruling on PR #71's third re-check; #71's four fixes next

- The third re-check found two more Highs (a poured serving shrunk by fill: red wine 150 → 60 g; a vessel before "of" never setting what the count counts: "bowls of beef stew chunks" ×2 got worse) and four Lows. Kd: *"i think serious design problem is there … too many crtical high coming constanly … forget about current set up"*.
- Root cause named: the server reads English (cut, piece, vessel, pack and unit words) to decide what a count counts and what a container holds, so every review finds the next phrase — the weight copy's shape (RULINGS 2026-09-10, six rounds).
- The design, *"go"* (RULINGS 2026-09-15, ROADMAP 7a-iv): the model fills a form with fixed choices (its gram estimate, a count of whole pieces only, one vessel from a fixed list, fill); a five-rung ladder (saved dish · count × USDA piece weight · vessel × fill × USDA cup weight · the model's estimate marked "estimate" · the serving); one 3× cross-check against the estimate in place of every word list; the sheet names the measure; a fixed set of test plates in CI.
- Measured: the USDA zips the food checker downloads carry `food_portion.csv` (SR in `modifier`, FNDDS in `portion_description`): 313 of 313 USDA-cited foods have a household weight, 258 a piece, size or cup weight — banana 118 g, egg 50 g, nugget 16 g, cornflakes cup 30 g, rice cup 158 g, cola can 370 g.
- Order, Kd's: #71 takes only the two High fixes and Lows 2 and 4, the reviewer's way (on the 7a-i line), a re-check of the four, merge · #72 · 7a-iii with the form in its reply · 7a-iv. L1, L3 and item 10's cornflakes are on 7a-iv's line.
- Records only, on this branch: RULINGS (Nutrition), ROADMAP 7a-i, 7a-iv and 10, this entry. No code changed; no suite run (nothing to prove). 7a-iii's line lives on PR #72's branch; the rebase after #71 puts 7a-iii above 7a-iv.
- Next: a fresh chat fixes #71's four findings, a failing test first for each, proves them and hands Kd the re-check prompt; then #72's review; then 7a-iii.

## 2026-09-15 · Stage 4 item 7: the meal scanner on Gemini 3.5 Flash-Lite, branch `gemini-meal-scanner`, PR #72

- Kd's rulings of 2026-09-15 are in RULINGS: 3.5 Flash-Lite at low picture detail (2.5 is refused to new accounts), the reply trimmed (*"lets do the trim"*), the app 18+, a gym member 7 scans a day, the $79–$379 ladder, gym payment links, subscriptions bought on the web, a sole proprietorship, no model or price swap unasked.
- Measured on his eight plates (40 calls; his page: claude.ai/artifact/2UHRMZ3Kv3vAHDMnmUExjA): $0.00068 a scan at low detail with the trimmed reply, against $0.00093 untrimmed and $0.00182 on Groq, the same foods found.
- Built: the Gemini provider (key in a header, JSON mode, minimal thinking, low detail, 30 s timeout, thought tokens billed as output); `MEAL_VISION_MODEL` picks the provider and `MEAL_VISION_MODELS` prices each model; a left-out field reads as unknown; a no-meal photo asks for a retake; `cuisineGuess` left the response; the browser sends a 768 px JPEG; gym members 7 scans.
- Verified: api tsc 0 · eslint 0 · unit 35/35 · local routes + db.migration 68/68 · shared 105/105 · web 35/35.
- The repository went public the same day, on Kd's word, with its safeguards (RULINGS 2026-09-14, amended).
- Kd's click-through found the matching flaw, not a #72 defect (two topped toasts read as "Avocado", "Sandwich (turkey)" and a Nescafé sachet); he ruled the redesign, ROADMAP 7a-iii. No more click-through of #72 is needed.
- Next: #71's re-check, #72's review, merge both; then 7a-iii.

## 2026-09-15 · 7a-i: PR #71's third re-check fixed (3 High, 4 Low, 5 weak tests); its re-check next

- Why a High again: each rule was tried only on the unit or word its finding named. A count is now first read for what it counts (cut bits, "pieces", a vessel named before "of", or the food), then the unit's rule; a test runs every unit of every rule against every cut word, "pieces" and container.
- H1: a cut word stops a count whatever the rule: beef stew chunks ×6 is one 255 g cup (was 1,530). H2: "pieces" is whole only for `WHOLE_PIECES` (nugget, meatball, slice, a label's piece, roti, chapati, puri, idli, medu vada, samosa): hot dog pieces ×8 is 102 g (was 816); dosa and paratha pieces now read as torn.
- H3: `servingOf` reads a label's grams and its pack, pack words added to `COUNT_RULES`: "1 bottle (65 ml)" ×3 is 195 g (was 65), "1 oz (28 g)" 28 g (was 1; off ROADMAP 10).
- Lows: a product's name must hold a noise word unless it measures the food before "of" (glass noodles is no Cup Noodles); accents folded; "Not in the total", the pointer gone when the meal is full; mugs of coffee ×2 650 g as mugs; cola by USDA's own 370 g can (SR portion "1 can or bottle (12 fl oz)").
- From its security pass: a count over 30 reads as unknown; one weighing past `MAX_ITEM_GRAMS` (shared) is not used. Found and fixed, older: a photo container or size named "constructor" blanked the grams or crashed a paid scan (priors are Maps now).
- Found fixing L4 and fixed: "cups of cornflakes" ×2 became 480 g (Appendix B's water cup); a container that is the food's own serving now weighs that serving × fill: 60 g.
- Verified: api tsc 0 · eslint 0 · unit 24/24 · foods 22/22 · routes 34/34 · full local 1044/1044; shared tsc 0 · eslint 0 · 106/106; web nutrition 36/36, Nutrition.jsx its 7 lint errors as on master; 14 deliberate breaks each red on every targeted run, files restored identical.
- Found, not fixed (ROADMAP 10): the list's matcher drops a noise word that is a food's own, so "peanut butter cups" is peanut butter and "tea leaves" tea.
- Next: CI, the fresh-chat re-check of these fixes, merge.

## 2026-09-15 · 7a-i: PR #71's second re-check fixed (3 High, 2 Low, 3 weak tests); a re-check next, on Kd's word

- Why every round found a High: each fix read a count from the words of the one example it was given. Now the food's serving unit decides (`COUNT_RULES`, every unit ruled in a test).
- H1: "pieces" counts whole things (nuggets, pizza, roti, idli, samosa as Appendix B's), a cut only of `CUT_UP_PIECES` (fruit, potato, egg). Idli pieces ×4: 160 g, as idli ×4 (the review's 152 was four of the list's 38 g idli).
- H2: a "vessel" serving (can, bottle, pot, glass, cup, bowl) is the count × one of what it is shown in: a saved dish, a known container, else its serving; a yogurt's "cup" is its pot, with or without a count.
- H3: a packaged product prices a scanned item only where its name holds every word of the hint (`holdsEveryWord`, noise words aside). L1: a blank name reads as its hint; the model's own unknowns trimmed and deduplicated. L2: "Not in our food list".
- Tests: the reviewer's rows; every unit × 7 containers × fill × count; every cut word; the scan reply parsed with `mealPhotoAnalysisSchema`; red wine, glasses of beer, samosa pieces now count. 7 deliberate breaks each red, files restored.
- Verified: api tsc 0 · eslint 0 · nutrition unit 41/41 · routes 34/34 · full local 1039/1039; shared tsc 0 · eslint 0 · 106/106; web nutrition 40/40, Nutrition.jsx its 7 lint errors as on master.
- Found, older than this PR (ROADMAP 10): Open Food Facts' "1 oz (28 g)" is a 1 g serving; cornflakes in a cereal bowl weigh 375 g, and a count of two now 750 g.
- A second chat was open on this branch in the same folder; Kd was asked to stop it. Next: CI, the fresh-chat re-check of these fixes (Kd, RULINGS 2026-09-15), merge.

## 2026-09-15 · 7a-i: PR #71's re-check fixed (3 High, 5 Low, 1 weak test), a third round as §2.6 allows

- H1: a count never multiplies a cut: banana slices ×10 is one banana's 120 g (was 1,200). A cut counts only as the serving itself ("pizza slices",
  "bread slices"); `CUT_WORDS`/`VESSEL_WORDS` in portion-priors, and a test classes every word the matcher drops as a cut, a vessel or neither.
- H2: a can, bottle or pot in a dish the person saved is the dish's (beer in a 568 ml glass: 568 g, was 350); another vessel beside a pack blocks its count.
- H3 (its text was cut from Kd's paste; rebuilt from its title and the code): a scanned item no food matches is named in `unknownItems`, not dropped silently.
- L1: two versions of one food are never told apart by bracket length: all 15 orders of roti/chapati/flatbread are the homemade roti (93 of 27,113 hints changed,
  all roti; 13 more are spring rolls, L2). L3 milk chocolate by the ounce. L4 the scan sends `pieces`; the stepper starts there. L5 moved to 7a-i-b, as allowed.
- Verified: shared tsc 0 · eslint 0 · 106/106; api tsc 0 · eslint 0 · unit 38/38 · routes 33/33 · full local 1035/1035; web nutrition 35/35 (Nutrition.jsx
  its 7 lint errors, as on master); checker: 318 foods match; 14,826 matrix scans, no cut or saved-dish pack multiplied; 19 breaks red, files restored.
- Next: CI; Kd's click-through (the photo sheet's count can't be clicked: tests only); the fresh-chat re-check of these fixes; merge.

## 2026-09-14 · 7a-i: PR #71's review fixed (2 High, 9 Low, 3 weak tests); Kd on roti, paneer, English names, fruits

- H1: a photo's count multiplies a food's own serving only where it is one piece or a sealed pack, and an Appendix B piece only for a hint ending in it:
  six nuggets 96 g (was 16), a veggie burger its 100 g patty (was an egg's 50). The review's own fix, serving × count for every food, would log ten grapes as 1 kg.
- H2 true (USDA has store-bought roti, naan and paratha). Kd, RULINGS 2026-09-14: both rotis, named; naan and paratha USDA's; paneer the UK table's; English
  names beside Indian ones; fruits at 7a-i-b. Found fixing it: a saved roti_chapati would price as the store-bought roti, so a canonical is looked up first.
- Lows: notice links (ODbL 4.3a, Open Food Facts' terms); Greek yogurt "(plain, nonfat)"; "Egg roll (vegetable, fried)"; jelly, chips, beans not aliases;
  shepherds pie, chilli; code-less products keyed with their brand; RULINGS 2026-08-24 amended; the inventory doc archived; every diet written out in a test.
- 318 foods (USDA SR 241, FNDDS 72, CoFID 5), every number matches its table; master's 131 all found, 55 with changed kcal, 187 new.
- Verified: api tsc 0 · eslint 0; unit 36/36; nutrition routes 33/33; full local api 1033/1033; web nutrition 32/32; web eslint 0 on the test, Nutrition.jsx
  its 7 as on master; 13 deliberate breaks each red (the scan-wiring break only in the route test), files restored byte for byte.
- Next: CI; Kd's click-through (the names, the notice links); the fresh-chat re-check of the fixes; merge.

## 2026-09-14 · 7a-i built: the food list from named tables, every food's diet, branch `bigger-food-list`

- Next was 7a-i, not 5a as the entry below says: RULINGS 2026-09-12 puts the food list before goals. Kd said *"go"* to the plan (RULINGS 2026-09-14).
- 317 foods, 131 kept under their canonicals and 186 new (44 meat, fish and eggs); each cites USDA SR Legacy (238), USDA FNDDS (72) or UK CoFID (7);
  55 old foods' kcal per 100 g changed to their table's. Every food has `diet`; `DIET_LADDER`/`dietAllows` moved to `@app/shared`. Fibre may be null.
- Matching by whole words: on master a search pick of peanut butter, orange juice, sweet potato, butter chicken and three more was priced as another
  food, and the scan took "tea" for steak; of 637 hints, 56 are now found, 34 now the right food, 2 now none ("hot", "mango lassi").
- `tools/check-food-sources.ts`: every number matches; a 1-kcal change and a wrong entry each reported, exit 1. The summary harness's M4 anchor re-anchored.
- Verified: api tsc 0 · eslint 0; shared tsc 0 · eslint 0 · 106/106; unit 57/57; nutrition routes 32/32; full local api 1023/1026 (catalog.seed, 7/7
  alone: ROADMAP 10's flake); 13 deliberate breaks each red (a 14th survived: a redundant lookup, removed), files restored byte for byte.
- Kd's click-through passed (*"all the tests passed"*), and so did his second, of "name · brand" over "Packaged product · Open Food Facts" (RULINGS
  2026-09-14); the licence notice came after it. Found: Stage 4 items 7 (the Gemini scanner unbuilt) and 8 (Open Food Facts' 10 searches a minute per IP).

## 2026-09-14 · 4d merged (PR #70): the review's findings fixed (no Critical/High), no re-check on Kd's word

- Three Lows fixed: SignUpNote's header no longer says the console draws the note; the 4d entry below is ten lines; setup's test has its
  space back (`onboardingCompleted: false`).
- One weak test fixed: with the note's purpose check taken out of the profile read, every note test stayed green (no other note has v3
  words for the route to take). The test now puts the other two notes' rows at v3 straight into the log; that break, and "any note but the
  health step's", now fail it at the new line, the server file restored byte for byte after each.
- The review's phone-app note: the phone's sign-in must read the same `signUpDisclaimerAgreed` or it skips the note (added to Stage 5 item 2).
- Verified: api tsc 0 · eslint 0 · health + users routes 31/31; web eslint 0 on both files · setup and sign-up note tests 86/86; CI green on c9d131f.
- Kd ended the round without the re-check (RULINGS 2026-09-08): *"no re-check needed, merge when ci is green"*. Next: 5a, goals on the server.

## 2026-09-14 · 4d built: "Before you start", the sign-up note, branch `sign-up-note`, PR #70

- Kd picked a screen of its own straight after signing in (*"Own screen after sign-in (Recommended)"*), once per account. His click-through passed
  with one change: the note is the training side's, never the console's, and staff meet it when they come to train (RULINGS 2026-09-14, amended).
- Kd found v2's words read as "this app should not be followed" and wrote his own; with his go to three changes they are the sign-up wording's v3.
- Built: the profile's `signUpDisclaimerAgreed` (this person's tap, on the sign-up note, in today's words, read from the consent log);
  `ProtectedRoute` draws the note in place until then and fails closed on a profile it cannot read; the six console routes pass
  `requireSignUpNote={false}`. Setup's tick and its hook are shared (`DisclaimerTick`, `useDisclaimerTap`).
- Verified: CI green on 2226f3d; locally api 999/1013 (the 14 red all workouts.sync, ROADMAP 10), 22 breaks each red, headless Edge at 400 and 1000 px.
- Kd's click-through of the console change passed (*"all passed"*): `kd.staff@example.com` reached the console with no note, then met it
  through Train and ticked v3.

## 2026-09-14 · 4c-ii merged (PR #69): Kd's click-through passed; the review's findings fixed (no Critical/High)

- Kd's click-through passed on the local database (*"all test passed"*).
- Review, four Lows fixed: no healthy weight is named for an age or height the plan cannot take (Settings lets 13 be typed); the
  target is read on the row its wheel shows (one row under a weight it would read the same as) on screen 3, in the box and in the
  plan's answers; under 18 the words say "for your height and age"; `versionFor` is `formulaFor`, and ROADMAP 4c-ii is plain words.
- Three weak tests fixed: a weight exactly at the floor (no cut, no finish date of today), Settings in pounds, Settings' gender box.
- Verified: shared tsc 0 · eslint 0 · 104/104; api tsc 0 · eslint 0 · test:local plan + nutrition + onboarding routes 157/157; web
  eslint 0 on the touched files but Settings.jsx (its four, as on master) · the eleven files drawing setup or Settings 390/390;
  nine deliberate breaks, the review's three among them, each red, every file restored byte for byte.
- CI green on cd77a61, all five jobs. Kd waived the re-check (no Critical/High, RULINGS 2026-09-08): *"merge"*. Next: 4d, the sign-up tap.

## 2026-09-14 · 4c-ii built: a too-low target is said on "Your target" as it is picked, branch `too-low-target`

- Kd said *"go"* to the plan's three recommendations (RULINGS 2026-09-14): the number box keeps its line; the target stays pickable;
  16 and 17 are held to the teen healthy weight (Cole and colleagues, 2007, BMJ, Table 4), not the adult BMI 18.5.
- Built: the line under the target wheel, and in Settings' target box, from one shared rule the plan maths runs to and the contract
  checks the flag against; said only where the plan's kilograms are under it AND it reads under it as the screen shows it. ROADMAP 4c-ii.
- Found and fixed: in pounds the number box said "below 111.1 lb" of a 111.1 lb target (stored as 50.39 kg). Seen in headless Edge:
  the line was lost on the page's picture (now on a panel of its own), and Settings said nothing of a typed 50.35 (it read rows).
- Verified: shared tsc 0 · eslint 0 · 104/104; api tsc 0 · eslint 0 · test:local plan + nutrition + onboarding + health 176/176; web
  eslint 0 on the touched files but Settings.jsx (its four errors are on master too) · the eleven files drawing setup or Settings
  385/385 · full run before the last fix 2117/2117 in 75/76 (poseAssets.contract, the known local red); sixteen breaks each red.
- Next: CI; Kd's click-through (local: `kd.lowtarget@example.com`); the fresh-chat review; merge; then ask Kd if 4d is next.

## 2026-09-14 · 4c merged (PR #66); GitHub: cheaper checks (PR #67), the lock on master, Pro

- Kd's click-through of 4c passed on the local database (*"all test passed"*); the re-check of 11d99e1 was skipped on his word (no
  Critical/High); merged as faa41f7, branch deleted.
- Kd: "Your target is below the lowest healthy weight…" must be said on "Your target" as the weight is picked, not first at the end
  (RULINGS 2026-09-14): ROADMAP 4c-ii, next, before 4d; its plan asks him two lines (the number box keeps its line; the target stays pickable).
- Kd: a click-through tests only what its card changed, all steps in one list (RULINGS 2026-09-14); set the test account up beforehand on
  the local database, so his first step is the card's own screen.
- GitHub's 90 % minutes warning: 1,816 billed minutes 2026-09-01 to 14, 842 (46 %) on record-only pushes. Kd: stay private, no name scrub,
  GitHub Pro (3,000 minutes a month); the Actions budget stays at $0, so the checks pause if the minutes run out; $8 only when told.
- PR #67 (merged, 5969053): the `what changed` job skips the four code jobs for a records-only push, and the Neon migration job unless
  `apps/api/drizzle` changed; anything uncertain runs everything. Proven: the code push ran six jobs (16 min), the records push two (2 min).
- `master` is locked: pull requests only (a direct push is refused, admins included), six required checks, a skipped job counts as passed.
  CLAUDE.md §2 now says records ride on the feature's pull request.
- Next: plan 4c-ii with Kd (ten lines or fewer), then build it; after it, ask Kd if 4d is next.

## 2026-09-14 · 4c finished after its review, branch `plan-screen`, PR #66

- The plan's list is headed "Your answers" · "You told us a professional has cleared you. Follow their advice." · "Go to …" under Finish opens
  its screen as Adjust does, so it offers "Back to your plan" · posterCode's kept-code checks wait for the join page's effect.
- Screen 3's "Best if you also build muscle" shows only where another pace would cut more. The plan carries `dailyChangeKcalByPace` (the plan's
  own maths at each pace), so the calorie floor, a weight under the healthy floor and a target out of reach leave the mark off, as under 18 and a
  health yes do; before there is a plan, those two answers decide. The contract refuses a picked pace's figure that is not the plan's, or one under the floor.
- Verified on 11d99e1: shared tsc 0 · eslint 0 · 104/104; api tsc 0 · eslint 0 · test:local plan + onboarding + nutrition 153/153; web eslint 0
  on touched files · model + onboarding render + posterCode 153/153; six deliberate breaks each red; gitleaks clean; CI green, all five jobs.
- Next: Kd's click-through (local, `kd.pace@example.com`: 165 cm, 50 kg, target 45, then 60 kg); merge; ask Kd if 4d is next.

## 2026-09-13 · 4c: "Your plan", the last setup screen; Kd: tell them about building muscle, branch `plan-screen`, PR #66

- Built: after "Your code", the plan: the number, "Your workouts" (the week as asked; Safe mode's "not yet" words in its place; "Follow their
  advice" for a cleared yes), every answer with an Adjust, the plan's note and its tap. Finish is there and waits for both taps.
- Adjust's screen offers "Back to your plan" (the first open question, else the plan); Adjust is held during a finish. Seen in headless Edge
  at 1000/700/400 px: eleven step names ran together, so the step bar is wider, in even columns.
- Kd picked "Tell them" (RULINGS 2026-09-13): Build muscle and a cut eaten over 500 kcal a day raise `cut_limits_muscle_gain`, naming the
  gentle pace, which screen 3 marks. Calories unchanged. Murphy & Koehler's words were read on Europe PMC (PMID 34623696) before asking.
- Verified: shared tsc 0 · eslint 0 · 104/104; api tsc 0 · eslint 0 · test:local plan + onboarding + nutrition 132/132; web eslint 0 · three
  setup files 148/148 · full run on 4367dfe: 2101/2101 tests in 75/76 files (poseAssets.contract fails to load, the known local red); 14 breaks red; login-door anchors match.
- Found, on ROADMAP: 4d the sign-up disclaimer tap was never built; 5b the Nutrition rings never say why there is no cut. posterCode's "someone
  already set up lands on the join page" failed once under load, then passed twice. Next: CI, click-through, review, merge; ask Kd if 4d is next.

## 2026-09-13 · 4b-ii-b re-check fixed and merged (PR #65); Kd: setup asks nothing about running

- Re-check: no Critical/High. O11 re-aimed at `@app/shared`; a census found 13 more orgs-harness rows dead since 8c28c02
  and 0eff79a (it had not started on master either): all 14 re-aimed, its start-up check passes for 286, the 14 run 14/14 red.
- The shared and api tests read the source: the link's schema and the join lookup must call `normaliseJoinCode`; an exact
  inline copy turns only the new test red. shared tsc 0 · eslint 0 · 104/104; api tsc 0 · eslint 0 · orgs.unit 23/23.
- Kd's Finish click-through passed (*"all passed"*); CI green on 4631f35, all five jobs; merged 2026-09-13 (PR #65).
- Kd asked if typing the join link lets a hacker skip a step: no. Sign-in, a live code, rate limits and the gym's confirm
  are all on the server.
- Kd: setup must not be "never ending". It asks nothing about running now (RULINGS 2026-09-13): 4b-iii moved to 7b. His
  run-advice idea and "the chat part will be completely deleted" wait on 7b's and item 9's plans. Next: 4c.

## 2026-09-13 · 4b-ii-b review fixed (1 High, 5 Low, 3 weak tests), branch `poster-code`, PR #65

- High: Finish dropped a poster code never sent. Kd picked "Join page, code ready" (RULINGS 2026-09-13): Finish lands on
  the join page with the code in its box, still unsent; a code already sent finishes to the app as before.
- Lows: a link with no code now drops an older kept one · `normaliseJoinCode` in `@app/shared` is the one rule for the
  server's lookup and the web's link · two HANDOFF entries cut to ten lines · ROADMAP Stage 5 item 7 says a QR each.
- Harnesses: login-door D13 re-aimed at `useConsoleSignOut`, P1–P11 added: 28/28 red. join-door aborted at J1 because six
  multi-line anchors missed CRLF checkouts; it now follows line endings: 36/36 red. Restores byte-exact.
- Weak tests: posterCode checks its four copied routes against App.jsx; the Finish test flipped; the shared rule broken on purpose turns shared and api red.
- Verified: shared tsc 0 · eslint 0 · 103/103; api tsc 0 · eslint 0 · unit 22/22 · the typed-code join test on local
  Postgres; web eslint 0 · full 2089/2089 (poseAssets.contract fails to load, the known local red); gitleaks clean.
- Next: the fresh-chat re-check of these fixes; Kd's click-through of the Finish step; CI; merge; then 4b-iii.

## 2026-09-13 · The invite card, planned (Fable, plan only — no code); PR #65 still awaits its review

- Kd's click-through of 4b-ii-b passed (*"all passed"*). He asked what "Sign in to use your code EMH283" is and where the QR
  went: the line names a join link's kept code; no QR exists, and nothing in the app makes the join link today.
- He ruled the invite card (RULINGS 2026-09-13): downloaded and put up, never social media; a join QR and a QR each for the
  Android and iPhone app; the organisation's logo big (its name when it has none), the app's small.
- Then: built WITH the phone app (Stage 5 item 7). He REFUSED the chat's one-QR simplification: the app's QR stays, as big as
  the join QR, with the app's name. Stage 2 starts with the email invite (items 3 and 5): Kd agreed (*"i agree with you"*).
- CI run 34759344217 failed once in "drizzle migrations on Neon branch" with no migration changed on the branch; the next
  run passed all five jobs. If it recurs, look at Neon's `ci-<run_id>` branches first.
- Next: the review of PR #65 in a fresh chat; fixes; merge; then 4b-iii. The card waits for Stage 5.

## 2026-09-13 · 4b-ii-b: a poster's code survives sign-in and setup, "Your code" first (Kd), branch `poster-code`, PR #65

- Kd picked option 1 (RULINGS 2026-09-13): not set up → "Your code" moved to the front of setup, filled in, sent only by
  "Ask to join"; set up → the join page with it; the sign-in page says "Sign in to use your code …" (Train door only).
- Built, no server change: the code is kept in the tab like the door (`CarryJoinCode`; `rememberJoinCode` / `readJoinCode` /
  `forgetJoinCode`), and only a code the server could have made (`linkedJoinCodeSchema`, `@app/shared`).
- Verified: shared tsc 0 · eslint 0 · 102/102; api tsc 0; web eslint 0 on touched files · full 2080/2080 (poseAssets.contract
  fails to load, the known local red); 20 deliberate breaks, all red; gitleaks clean.
- The gym QR Kd asked about was never built; it became the invite card (the entry above).
- Local: API 3000 on the LOCAL Postgres, web 5173; live code EMH283 (Step 22b Gym 987027, trialing).
- CI green on PR #65; Kd's click-through passed (*"all passed"*). Next: a fresh-chat review, fixes, merge.

## 2026-09-13 · 4b-ii's last fixes: "In 3–4 hours", a reset cannot slip past a finish, tidier records, PR #64

- Kd picked "In 3–4 hours" for the yogurt idea's timing ("Later today" did not count from the workout; RULINGS
  2026-08-06, amended again). Changed in `summaryContent.ts`, both summary tests and ROADMAP 4b-ii.
- New test: a profile PUT that finishes setup while a reset holds the account is refused (409, health named),
  never finished with no health answer. Moving the "already finished" read outside the lock turns it red (200).
- HANDOFF's 2144cda entry cut to ten lines; the no-diet rule labelled the chat's choice; schema comment rewritten.
- Verified: api tsc 0 · eslint 0 · the four touched test files 93/93 · full local suite 999/999 · gitleaks clean.
- Kd's click-through passed (*"all passed merge"*); CI green on 04eab8e, all five jobs; merged 2026-09-13 (PR #64).
- Next: 4b-ii-b (a poster's code survives sign-in and setup). API 3000 on the LOCAL Postgres and web 5173 running.

## 2026-09-13 · The post-workout meal ideas in the market's words (4b-ii), branch `food-and-gym-code`, PR #64

- Commit ce4420e: the seven meal-idea lines on ROADMAP 4b-ii, in `summaryContent.ts` and its two tests — potatoes for
  rice, "Later today" for "1 hour before bed", chickpeas in the vegetarian and vegan salad. Bands, thresholds and
  diet swaps unchanged.
- Verified locally: shared tsc 0 · eslint 0; api tsc 0 · eslint 0; `test:local` on the two summary files 39/39;
  gitleaks on the staged files, no leaks.
- Open: CI on PR #64, Kd's fresh-chat re-check of 2144cda + ce4420e, merge; then 4b-ii-b.

## 2026-09-13 · The click-through of the fixes passed; the plan for Kd's next asks (Fable, planning only — no code)

- Kd's click-through of 2144cda passed (*"as for the tests all passed"*). CI is green on attempt 2 of run
  34738247155: attempt 1 sat queued for 2 h 25 min with no runner assigned (GitHub Actions "operational" on its
  status page); `gh run cancel` then `gh run rerun` fixed it — no code change.
- Kd plans with Fable 5.1 (max) and builds with Opus — *"don't start coding, you just need to make the plan so
  that Opus can follow"*. This chat wrote the plan into RULINGS, ROADMAP and here, and changed no code.
- He ruled the post-workout meal ideas' words (RULINGS 2026-08-06, amended again): no "1 hour before bed" on a
  post-workout card, and no rice-first food for a Western market. The seven lines, with their diet swaps, are on
  ROADMAP 4b-ii; Opus changes them on this branch before the re-check.
- He asked for options on the dashboard's Recommended box — Exercise · Food · Running — each showing its kind
  (RULINGS 2026-09-13): ROADMAP 7a-ii, built with 7a's engine; Exercise joins at 6b, Running at 7b. Two questions
  for him sit on that line (the design as read; whether the web shows the week's runs). Asked in chat, unanswered.
- Kd then asked whether the post-workout ideas repeat every day (today: yes — seven fixed lines; from 7a they vary,
  drawn from the food list) and said a non-vegetarian can eat veg too (RULINGS 2026-09-13: the diet is a ceiling,
  never a demand; 7a includes veg dishes for non-vegetarians). Variety waits for 7a — *"wait for 7a is fine"*.
- Local: API 3000 on the LOCAL Postgres and web 5173 running from this chat. Accounts: `kd.meals.0913@example.com`
  (finished, vegan, one 560 kcal workout, id `f45b13f5-2316-4fe9-a77c-26112c01bd3e`) and `kd.code.0913@example.com`
  (setup unfinished, a refused request to join `2LY3BZ`); the sign-in code prints in the API log.
- Next: an Opus chat on this branch — the wording change, checks, push, then it hands Kd the re-check prompt;
  a fresh chat re-checks 2144cda + that commit; merge; then 4b-ii-b, 4b-iii, 4c, 7a-i, 7a, 7a-ii, 7c.

## 2026-09-13 · 4b-ii: the finish gate on the profile PUT, meal ideas that follow the diet (2144cda), PR #64

- Meal ideas after a workout follow the diet (Kd, RULINGS 2026-08-06 amended): a vegan gets tofu and soy yogurt.
  No diet answer gets the ideas every diet can eat — the chat's choice, from RULINGS 2026-07-15, not Kd's ruling.
  The card carries the food-allergy caution, its words now `FOOD_ALLERGY_CAUTION` in `@app/shared`.
- The profile PUT no longer finishes setup with answers open: the PATCH's 409 and list, the users row locked
  first; a finish already stored is kept, so Settings saves still work.
- Screen 9's meals hint promises nothing; Settings offers "Not set" for meals only while none is stored; screen
  11's "Try again" goes to the code box. A poster link's code is split out as ROADMAP 4b-ii-b.
- Verified: api tsc/eslint 0, full local 981/998 (17 = item 10's `workouts.sync` flake, 23/23 alone); web full
  2046/2047 (poseAssets.contract, the known local red); 19 deliberate breaks, each red for its own reason.
- Open: CI, merge.

## 2026-09-12 · Screen 9 (food) and screen 11 (the gym code), item 4b-ii, branch `food-and-gym-code`

- Kd asked for two NEW things and ruled the order (RULINGS 2026-09-12): the food list grows to about 300 and is
  not vegetarian-first (the market is Western), and a person may build their own diet plan beside the app's —
  both before launch, after the setup screens. New roadmap lines 7a-i and 7c; nothing else re-ordered.
- He also asked what a meal scan does when the food is not in our list. Answered from the code: our table, then
  foods a search already pulled in, then Open Food Facts; no match means the item is dropped from the totals and
  named ("Couldn't identify: …"), or, if nothing matched, "we couldn't match it to our nutrition data" plus
  "Add an ingredient". It never invents a number (RULINGS 2026-08-24) — which is what 7a-i is for.
- Built: screen 9 asks the diet (four choices, Kd's order) and meals a day (2–6), saved as you go; screen 11 is
  the join door's own two components, the ones Settings' Gym tab draws. Migration `0030` adds both columns with
  their CHECKs and no backfill. Both food answers gate the finish beside `health`; the code never can.
- Finish moved to the LAST screen with them, so the disclaimer tap (screen 8) is named and reachable from there,
  and Back is now held while a finish is out — the step bar already was, and that gap was found by its own test.
- Verified: shared tsc/eslint 0, 94 · api tsc/eslint 0, CI-shaped 299, FULL local suite 989/989 (the
  `workouts.sync` flake passed this run too) · web 2041 (poseAssets.contract is the known local encoding red,
  confirmed untouched by this branch) · web lint's 4 in Settings.jsx are master's 4, checked line by line
  against HEAD's own file · gitleaks clean · six deliberate breaks, each turning a different new test red.
- Kd's click-through PASSED on 2026-09-13 (*"the testes passed"*), with copy changes he asked for on the way —
  the "What {gym} can see" sheet, now RULINGS 2026-09-13 and ROADMAP 8a, NOT built on this branch.
- Open: the fresh-chat review of PR #64 (CI is green on 9687895, all five jobs), then merge. 8a's plan must raise
  two things with Kd, both on its ROADMAP line.
- Local: API 3000 on the LOCAL Postgres and web 5173, both started this session (two stale servers from the
  2026-09-12 chat were killed first — the one on 3000 was answering with master's code). The click-through
  account is `kd.food.0912@example.com`, seeded through screens 1–8 so it lands on Food; the sign-in code
  prints in the API log. Live join code on the local database: `2LY3BZ` (Step 22b Gym 075154).
- Next: 4b-iii (running), then 4c, then 7a-i (the bigger food list), then 7c (your own diet plan). Worth Kd's
  word at some point: the diets are listed vegetarian-first, as his ruling names them; a Western audience may
  want Non-vegetarian first.

## 2026-09-12 · 4b-i's last round: three Lows and two weak tests, merged as PR #63

- No Critical/High in the last review, so this is the end of the round (RULINGS 2026-09-08). Kd: *"fix and merge"*.
- The health question takes no answer while a finish is out. A finish the server refuses over it forgets what the
  screen holds; an answer tapped in that window could be stored and then forgotten, leaving nothing chosen over an
  answer the server has. The buttons now wait for the finish, as they already waited for a health save.
- The note under the question promises no detail AT ALL, not "we never ask what the condition is" — the question
  also asks about medicine, an injury and pregnancy, so naming one of the four was narrower than the truth.
- The unanswered screening is ONE shared constant (`UNANSWERED_HEALTH_SCREENING`), parsed through the contract where
  it is defined and read by the server and both screens; the two hand-written copies are gone.
- Two tests that could not fail now can: the build's own `VITE_APP_VERSION` goes through the clip (the rule was
  tested, the wiring was not — a blank or over-long one 400s every disclaimer tap), and "above the fitness form"
  pins the whole form, not just its Save button (a card inside the form passed before).
- Verified: shared tsc/eslint 0, 91 · api tsc/eslint 0, CI-shaped 299, local db health + onboarding routes 58 ·
  web 2026 (poseAssets.contract the known local encoding red, red on master too) · eslint 0 on the five touched
  web files · gitleaks clean · five deliberate breaks red, one per fix, each restored.
- Kd's click-through of screen 8 passed on 2026-09-12 (*"smoke passed"*), so the roadmap line is ticked.
- Next: 4b-ii (screen 9, food, and screen 11, the gym code, applied first).

## 2026-09-12 · 4b-i's review fixed (two rounds), PR #63

- A finish the SERVER refuses over the health question now forgets the answer this screen was holding, so the
  question comes back with nothing chosen and the next tap really saves, and answering it clears the sentence.
  Before, a reset on another device left "answer the health question" standing over an answer shown as given.
- The note under it names BOTH stored facts and says what is never asked — "what the condition is", since the
  "it" three clauses back could be read as the clearance. Finish also waits for the health save to land.
- A blank `VITE_APP_VERSION` now falls back like an unset one, so a build that set it empty cannot 400 the tap.
- Verified: shared tsc/eslint 0, 90 · onboarding 53 · health + settings 14 · full web 2024 (poseAssets.contract the
  known local red) · lint 0 on the touched files · all six fixes red first · four tests strengthened — but two of
  those four still could not fail for what they claimed, which the next round found and fixed (entry above).

## 2026-09-12 · The health question (item 4b-i), branch `health-question`

- Kd ruled cuisine out entirely — not at sign-up, not in meal suggestions (RULINGS 2026-09-12). 4b split into 4b-i
  (health), 4b-ii (food + the gym code) and 4b-iii (running) in `ROADMAP.md`; this card is 4b-i.
- Built: screen 8 asks the ONE question with the medicine clause, "Check first" and the disclaimer tap (recorded on
  the 3b consent route); Settings' Fitness tab asks it with the SAME component and saves on the tap. Finishing is
  refused while it is unanswered (`missing: ["health"]`, its own shared enum — the PLAN's list never carries it).
- `0029` DROPS `user_fitness_profiles.medical_conditions` with everything typed in it; the notes box and its untrue
  "Helps the AI give safer advice" hint go with it; the profile PUT now refuses the field. Reset clears the health
  answer with the rest, in one transaction; the consent log is never touched. Disclaimers gain v2 (the comparison
  with the app goes, "follow their advice" stays). A yes saves nothing until "Check first" is answered.
- Verified: shared tsc/eslint 0, 89 · api tsc/eslint 0 · CI-shaped (no DATABASE_URL) 299 · local db.migration 27,
  users.onboarding + users.fitness 49, privacy/health/users 67, full local 979 + the 8 `workouts.sync` are item 10's
  shared-database flake (23/23 alone) · web 2011 (poseAssets.contract the known local red) · web lint's 4 in
  Settings.jsx are master's 4 · seven deliberate breaks each turned a new test red.
- Open: Kd's click-through, the fresh-chat review, CI, merge. Worth his word at the click-through: the disclaimer tap
  is asked once per visit to the wizard, so someone the rings send back to answer one question ticks it again.

## 2026-09-12 · 4a-iv merged (PR #62)

- The last re-check found no Critical/High and two Lows, both fixed: Reset's box now keeps "any yes or no you gave to
  the health question", so it cannot be read as keeping the medical notes it clears; a test comment rewrapped.
- Verified: api tsc 0 · api eslint on the migration test 0 · web reset test 4 of 4 · gitleaks clean · web lint's 4 in
  Settings.jsx are master's 4 at the same lines · PR #62 CI green on 1e89c47; merged, branch deleted.
- Open: 4b is next. The hint under Settings' notes box, "Helps the AI give safer advice", is untrue while the coach is
  off (RULINGS 2026-08-18); it goes with the box at 4b (noted on its line).

## 2026-09-12 · 4a-iv re-check fixed (one High in a fix, two weak tests), PR #62

- High: Reset's box promised "any health answer you gave" is kept, but the reset deletes Settings' Medical Conditions /
  Notes text with the row, and the web has never asked the yes/no health question. The box now says the notes are
  cleared and any answer to the health question is kept.
- Tests: the reset test saves notes as Settings does and checks the box is empty after; `0028`'s test adds a Flexibility
  person with an old Weight Loss tick (stays on "maintain", no cut).
- Verified: api tsc/eslint 0 · api touched files 64 · web reset file 4 · web lint's 4 are master's 4, same rules · two
  deliberate breaks (0028 reading the tick first; a reset keeping the notes) green on the old tests, red on the new.
- Open: CI, one re-check of these fixes (a High was open, CLAUDE.md §2.6), merge.

## 2026-09-12 · 4a-iv review fixed (no Critical/High; six Lows, three weak tests), PR #62

- Lows: screen 1's ruling says what Kd passed (the one line under the heading stays); Reset's confirm box names the
  health answer it keeps; `0028` keeps an old-form Weight Loss tick as "Lose weight" (a main goal still outranks it);
  Gain weight's protein note cites Iraki 2019 (1.6–2.2 g/kg in a surplus), Build muscle keeps Morton; two stale labels.
- Tests: screen 1 is one heading over its twelve tiles and nothing else; a health yes survives a reset and still holds
  the cut; a Fitness-tab save after a reset starts from the cleared answers.
- Verified: shared + api tsc/eslint 0 · api touched files 64 · web touched files 107 · web lint's 4 are master's 4 ·
  five deliberate breaks red (the three tests, the migration's old-form row, the gain note).
- Kd: a reset keeps the health answer until 4b (RULINGS 2026-07-20, amended). Open: CI, the re-check or its waiver, merge.

## 2026-09-11 · Many goals, and a gym (item 4a-iv), branch `many-goals-and-a-gym`

- Kd ruled: people who already chose Build muscle are asked their weight choice, never given one (RULINGS 2026-09-11).
  His click-through: screen 1 as one grid three to a row under "Your goal"; a ninth goal, Stay healthy; "A gym".
- Built: screen 1 asks the weight choice (lose · keep · gain) and any of nine goals; Build muscle sets protein to 2.2 g/kg
  (Morton 2018). `0028`: `weight_goal` replaces `main_goal`, goals and equipment CHECKed, "none" alone. Settings asks the
  same questions; Reset = `DELETE /v1/users/me/onboarding` (the name, weigh-ins and health answer stay).
- Verified: shared + api tsc/eslint 0 · api touched files and CI-shaped green, full local 963 + the shared-database flake ·
  web full 1998 (poseAssets.contract the known local red) · four deliberate breaks red.
- Local: API 3000 (local Postgres), web 5173; `kd.muscle.0911@example.com` is a Build-muscle person as 0028 left them.
  Kd's click-through passed (2026-09-11); PR #62. 4c carries a pace note for Kd; 6a defines Stay healthy (WHO).

## 2026-09-11 · 4a-iii merged (PR #61); Kd: building muscle is not gaining weight

- Kd's click-through passed (the test account ended on Weight Loss, target 68 kg, renamed; no server errors). Merged as
  de6814b, a merge commit like #60's; CI green on 55ceb9f; branch deleted.
- Kd: Muscle Gain is not weight gain, so choosing it must never ask a target weight (RULINGS 2026-09-11). That is what
  4a-iv's goal split builds (RULINGS 2026-09-10). Its roadmap line no longer assumes "build muscle → gain" for people who
  already chose it: the 4a-iv plan asks Kd keep or gain, with the science.
- The first sheet's steps 5–6 never showed: Kd fixed the target at step 4 (80 kg, above 73). Right behaviour; a step
  that is only for looking must say "don't change it yet".
- Local: API 3000 on local Postgres and web 5173 still running from this chat.
- Open: 4a-iv, plan first (ten lines to Kd), starting with where Build muscle's people land.

## 2026-09-11 · 4a-iii last re-check: no Critical/High; its three Lows and three weak tests fixed, PR #61

- Settings reads the goal the calories follow: the fitness-profile reply carries `mainGoal`; the Profile tab judges a
  target by it, not by the list's first weight goal, and the Fitness tab ticks it when an old list holds both.
- The rings' wrong-side card: "Time to set a new target weight. Pick one to see your daily calories and macros." (true
  for a reached target too); the link still says "Pick a new target". The entry below is cut to ten lines.
- Tests: the Settings rename takes the server's spelling, a refused rename changes nothing; a Settings save of both
  weight goals, from Flexibility and from the old form, keeps only the first.
- Verified: shared + api tsc/eslint clean · shared 83 · api route files 49 · web changed files 51; web lint's 4 are
  master's 4. Red on the old code: web 6. Deliberate breaks red: rename 2; server 4 (a save keeping both weight goals,
  the contract without `mainGoal`). Full suites left to CI.
- Open: CI, Kd's click-through (API 3000 local, web 5173, `kd.wheels.test`), merge; no review round left (§2.6).

## 2026-09-11 · 4a-iii re-check fixed (one High, four Lows), branch `rings-read-the-plan`, PR #61

- High: a name changed on "About you" reaches the sidebar and the greeting at once. The onboarding page passes on the
  name the server holds after every save that lands, not only at Finish; a Settings rename does the same, and Settings'
  header and Account tab show the name again (they read `fullName`, which the profile never had).
- Lows: the rings name a wrong-side target as its own case (`targetWrongSide`: "Your target weight no longer fits your
  goal" + "Pick a new target"); a Settings save keeps only the weight goal the calories follow; Settings' target box
  refuses a typed wrong-side target in screen 3's sentence (a stored one is named, the rest still saves); two comments.
- Verified: shared + api tsc/eslint clean · api unit 19, route files 68, full local 961 + two sign-in files red under load
  (alone 40/40), no-database 298 · web 1984 (poseAssets.contract the known local red; the onboarding page tests now wait
  3 s/15 s, the full run pushed two past the defaults) · lint adds nothing · new tests red on old code (api 9, web 11).
- Open: fresh-chat re-check of these fixes, Kd's click-through (API 3000 local, web 5173, `kd.wheels.test`), CI, merge.

## 2026-09-11 · 4a-iii review round 1 fixed, and Kd's goal ruling, branch `rings-read-the-plan`, PR #61

- Kd rejected my first H1 fix (the rings asked "your goal" again): a change takes effect at once (RULINGS 2026-09-11).
  A Settings save now moves the calories: a ticked weight goal sets them, else the main goal while ticked, else the
  first ticked; Weight Loss and Muscle Gain untick each other. Screen 1's goal goes first; only a goal that fights it leaves.
- A target on the wrong side of the weight makes the rings ask for the target, not show the held weight as the goal's number.
- L1–L3 fixed (name saved before "Back to the app"; Sign out beside it; "for a weight-loss goal"). Tests mount the page
  through ProtectedRoute; every new test red on the old code; deliberate breaks red (guard 5, failed save 1, chip 2).
- Verified: api tsc/eslint 0 · changed 86 · full local 978 + catalog.seed's known race (alone 7/7) · no-database 298 ·
  web 1970 (poseAssets.contract the known local red); Settings.jsx's 4 lint errors predate this.
- Open: fresh-chat re-check, Kd's click-through (API 3000 local, web 5173, `kd.oldform.0911`), CI, merge. Reset keeping
  the v2 answers is on 4a-iv.

## 2026-09-11 · One daily-calories number: the rings read the plan (item 4a-iii), branch `rings-read-the-plan`

- Kd rejected the protein question as first framed (cap at 35 % or keep) and asked for the science. Researched
  (ISSN 2017, ACSM/AND/DC 2016, Longland 2016, Devries 2018, Weijs 2025): grams per kilo, never a share of the calories;
  a body over BMI 30 is counted at its BMI-30 weight (120 kg at 175 cm: 184 g, not 240). RULINGS 2026-09-11.
- Built: `/v1/nutrition/targets` reshapes the plan from `users/service getUserPlan`, the function the onboarding routes
  use (old −400/+300 calculator retired). Empty rings name the open questions; "Answer now" → onboarding's first open
  screen → back to Nutrition; a finished person there gets "Back to the app", not "Sign out". The protein working
  carries `referenceBmi`; "How is this worked out?" names each goal's source. The `fitness_goals` mirror stays (Settings).
- Verified: shared tsc/eslint 0, 83 · api tsc/eslint 0, unit 74, local routes 84, CI-shaped 297, full local 951 + the two
  known flakes (pass alone, 30) · web 1963 (poseAssets.contract the known local red). New tests red on the old src; 13 of
  13 deliberate breaks red. Local: API 3000 on local Postgres, web 5173; `kd.oldform.0911@example.com` is the old-form
  person (120 kg, 175 cm, missing goal + "your day"); the sign-in code prints in the API log.
- Open: Kd's click-through, the fresh-chat review, CI, merge. Then 4a-iv (its line now carries the Settings-goal gap).

## 2026-09-11 · Screens 1–7: the re-check's four Lows (item 4a-ii), branch `onboarding-screens-1-7`, PR #60

- The fresh-chat re-check of round 1 found no Critical/High and four Lows; all four are fixed here. No third review (§2.6).
- Wheels: a slow drag that rests and goes on saves where the finger lifts, not where it rested (a gesture never settles
  while a finger is down; a touch that is cancelled ends it too).
- Plan check: besides each line's own sum, every figure the plan panel prints twice must agree — the weight, the formula's
  constant, the pace's kg a week, kcal per kilo, kg to move, and the two floors the flags name. The Mifflin-St Jeor
  constants and the kg-between sum moved to `@app/shared`, so the calculator and the check share them.
- Tests: the gesture test is split (a press let go, a mouse wheel, a finger lifting, a touch or a press the browser
  cancels), plus Tab away and the slow drag; two contract tests. Each of the 8 wheel handlers and 9 new checks, removed
  in turn by hand, turns a test red (17 of 17); files restored.
- Verified: shared tsc/eslint 0, 83 · api tsc/eslint 0, plan.unit 53, CI-shaped 306, local onboarding routes 34 · web
  eslint 0 (touched files), onboarding 68, full 1954 (poseAssets.contract is the known local encoding red).
- Kd's click-through of the wheels passed, the scroll fix's cost included (on a phone a wheel is tapped before it is
  flicked; kept, RULINGS 2026-09-11). All five CI jobs green on 697995f; merged 2026-09-11 as PR #60, branch deleted.
- Next: 4a-iii, which opens by asking Kd the protein question in its ROADMAP line. Then 4a-iv → 4b.

## 2026-09-11 · Screens 1–7: Kd's second look and review round 1 (item 4a-ii), branch `onboarding-screens-1-7`, PR #60

- Built Kd's second look (RULINGS 2026-09-10/11): flick wheels with − and +, the name first, plain push-up and plank
  questions, "How is this worked out?", two drawn icons, a target wheel that offers only the goal's side.
- Review round 1: 3 High, 6 Low, all fixed. Re-picking the rows on show saves nothing (rows, not kg: 70 kg reads 154.3 lb
  = 69.99 kg); a wheel turns only once tapped or focused, so scrolling the page never sets an answer; the target shows on a
  row it offers in either unit; the contract checks the working's products as well as its sums.
- CORRECTED: Kd was told the macros sit inside the IOM ranges. They don't: the golden loss plan is 44.2 % protein and
  30.9 % carbs (IOM 10–35 % and 45–65 %). He has been told; the choice is the first question of 4a-iii (ROADMAP).
- Verified: shared 83 · api plan.unit 52, CI-shaped 305, local onboarding routes 34 · web 1948 · tsc/eslint 0 · burn within
  2 kcal of 3a's. Headless Edge, mouse and touch: the old wheel saved age 35 under a page scroll; the new one scrolls the page.
- Open: the fresh-chat re-check of the fixes, Kd's click-through of the wheels, CI, merge. Then 4a-iii → 4a-iv → 4b.

## 2026-09-10 · Onboarding screens 1–7 (item 4a-ii), branch `onboarding-screens-1-7`

- Built: seven screens replace the old five-step form (`pages/Onboarding.jsx` + `pages/onboarding/`): one goal · about you
  (typed, kg·cm or lb·ft) · target (lose/gain only) · your day · your training (checks skippable, plank timer) · your week ·
  equipment ("No equipment" exclusive; an old "none"+equipment answer loads without "none"). Taps save through one queue;
  the server's number and its flags in words on every screen once it exists; a returning person lands on the first gap.
- Server: PATCH refuses `onboardingCompleted: true` while the plan lacks an answer (409 with the list, inside the save's
  transaction, so a refused body writes nothing). The pace table moved to `@app/shared`. Rings' move split out as 4a-iii.
- Verified: shared tsc + 81; api tsc + eslint 0; local Postgres plan.unit + users.onboarding 79; web eslint 0 (touched
  files); web 1921 passed (poseAssets.contract is the known local encoding red). Run red first: finish rule off (409→200),
  date formatter without UTC (Los Angeles showed Nov 18), and the wizard's sign-out mutants D16/D17 by hand.
- Found: `mutate-login-door.mjs` aborts at D9 (anchor is the "I run a gym" label renamed 2026-09-07); not re-anchored.
  CI's first run failed `xpDisplay` "non-array recommendations" (reads the message without waiting; 3/3 locally): item 10.
- Kd clicked through: passed. His look changes, built the same day (RULINGS 2026-09-10): line icons for emoji, a big units
  switch first, a clickable step bar, no number box before the number, the disclaimer's first sentence only under it.
  Pushed as 7508a3d; all five CI jobs green.
- FIVE FIXES REMAIN on this branch before the review, from his second look (build them first, plan first, tests alongside):
  (1) Flexibility and Pull-up bar icons drawn by hand in lucide's line style — the library's wheelchair and arrow are
  wrong; (2) age, height, weight and target become flick wheels with + and − buttons — nothing typed, nothing pre-filled
  (RULINGS: tap-only screens; "Not set" until touched, as Settings' slider does); (3) "About you" opens with "What should
  we call you?", the one typed box that stays, saved as `displayName` (a code sign-in names the account after the email's
  local part today; Settings can change it); (4) screen 5 asks "How many push-ups can you do in a row?" and "How long can
  you hold a plank?" as plain questions with a "Not sure" tap — no timer, no test wording; nothing reads the two numbers
  until 6a; (5) "How is this worked out?" under the number: the SERVER sends the steps (it alone knows the day factor,
  the MET and the protein table), the screen prints each with Kd's own numbers and the source named in maths.ts's header.
- Then: tests, Kd's click-through again, the fresh-chat review, merge. After merge: 4a-iii (rings, small) → 4a-iv (goals
  and gym) → 4b (health). Kd builds the rest with a different model; his goals ruling is in RULINGS and its design in 4a-iv/6a.
- OPEN DECISIONS, to ask in the next plan: B "A gym" on screen 7 (recommended yes) · C the health question gains "or take
  any medicine, including for weight loss" (recommended yes) · D "follow their advice over the app's" stays on sign-up,
  the health step and the plan screen for the lawyer to reword (recommended yes). Kd has not answered these.
- Local servers (memory `run-api-locally-env-file`): API on local Postgres, web on 5173; the sign-in code prints in the
  API log. `kd.onboarding.test@example.com` has finished onboarding on the local database — use a fresh address, or
  Settings → Reset onboarding. Until 4a-iii the Nutrition rings can show a different daily number.
- Two more asks from Kd, both for 4b, NOT this branch (each needs a column): veg / non-veg on the food screen, and a
  running question for everyone on screen 5 plus the runner's own on screen 10 — ruled and specified in RULINGS
  2026-09-10 and ROADMAP 4b / 7b.

## 2026-09-10 · Weight has one source and no copy (item 4a-i-b), branch `weight-one-source`, PR #59

- Built (Kd's redesign, RULINGS 2026-09-10): `0027` re-runs 0026's backfill, drops `users.weight_kg`, adds the
  `source` CHECK, clears ages under 16; every screen reads the newest weigh-in (`currentWeightKg`); re-sending the
  weight already showing writes nothing; the web profile form sends only what changed (the old onboarding form does not).
- Also fixed: the Mongo import skips the profile weight of a person it could not import (it stopped the run);
  the spec's workout-calorie rule keeps "≤ workout time"; stale "weight is on the user row" comments corrected.
- Verified: api tsc + eslint 0; shared tsc 0; web 34 (userApi, the new Settings form render test, measurements);
  local Postgres migrate.nutrition + db.migration + users.onboarding 62. The new import test failed first; Settings
  forced to send the weight, and the reader made to ignore a clear, each turned a new test red.
- Kd waived the re-check (no Critical/High); merged 2026-09-10 (PR #59, five CI jobs green, branch deleted). Item 10
  gains a defect: workout calories use the weight on the day it syncs, not the day it was done. Next: 4a-ii.

## 2026-09-10 · Onboarding v2 server half (item 4a-i), branch `onboarding-plan-server`, PR #58

- Built: `GET`/`PATCH /v1/users/me/onboarding` — answers saved as you go, the live plan or the list
  of what is missing (contracts in `packages/shared/src/onboarding.ts`); migration `0026` adds five
  answer columns, then a typed row under every existing weight. One main goal (RULINGS 2026-09-09).
- Weight (RULINGS 2026-09-10): the history is the one source, `users.weight_kg` its cache. A typed
  weight is a `self_reported` row dated after everything else; a same-day retype edits it; a clear is
  a typed row with no weight. Every history write takes the users row first and refuses a deleted account.
- Verified after the last review round (no Critical/High left): api tsc + eslint 0; shared tsc + eslint
  0, 81 tests; local Postgres users.onboarding 34, nutrition.routes 30, db.migration 23, migrate.nutrition
  4, users.routes 8; web 2; a fresh database takes all 26 migrations; six deliberate breaks each failed a test.
- Kd waived the re-check of the last fixes (no Critical/High). Merged 2026-09-10 (PR #58, all five CI
  jobs green, branch deleted). Next: 4a-ii, the seven screens (the `fitness_goals` mirror ends there).

## 2026-09-09 · Item 3c struck (allergen tags); next is 4a

- Kd was offered the 3c plan (tag the 131 curated foods, a "contains …" line on search and meals, no
  allergy question) and ruled it not needed: every meal suggestion gets a food-allergy caution line
  instead, built with 7a; nothing ever asks about allergies. RULINGS and ROADMAP updated; no code touched.
- Worth knowing for 7a: the food list is code (`apps/api/src/modules/nutrition/foods.ts`), not a
  table, so there is no allergen data to reach for — the caution line is the whole answer.
- Open: Stage 1 item 4a (onboarding screens 1–7) starts in a fresh chat on a branch off `master`.

## 2026-09-09 · Health screening, Safe mode and the consent log (Stage 1 item 3b), branch `health-screening`

- Kd ruled mid-plan (RULINGS 2026-09-09): ONE general health question, no named condition ever
  asked or stored (a fitness app, not a medical one); any yes = no calorie cut, cleared or not;
  changeable after sign-in. The plan contract's health block is now `{ hasCondition, safeMode }`
  and the no-deficit reasons `under_18 · health_answer · safe_mode`.
- Built: `packages/shared/src/health.ts` (screening + consent contracts, `deriveHealthFlags`, the
  three disclaimer wordings v1 with a test that bans "safe for you" / "treats" / "cures");
  migration `0025` (`user_health_screenings` 1:1 with two CHECKs incl. the contradiction guard;
  `consent_log` append-only, wording copied verbatim, FK with NO cascade); routes GET/PUT
  `/v1/users/me/health-screening`, GET/POST `/v1/users/me/consents`; `getPlanHealth(sql, userId)`
  in users/service is the flag every plan route reads (4a uses it); the API's macro-rings number
  (`/v1/nutrition/targets`) now holds the −400 cut for a yes AND under 18, and the response says so
  (`noCalorieCut`); nothing on the web screen shows it yet — 4c owns that.
- Privacy: `user_health_screenings` on the Day-14 delete list and in the export; `consent_log`
  KEPT after a purge (proof of the tap, like audit_log) and exported — Kd was asked to confirm the
  keep, not yet answered.
- Review round 1 (2026-09-09): three High, six Low, five test gaps. Fixed: the under-18 rule was
  missing from the targets route (H1, now tested at 16/17/18 in unit + route); consent POST gets a
  30/hour per-person limit, the list returns `total` beside the capped 100, the export read is
  bounded at 1000; a repo-level test for the active-only inserts; the PK column asserted by name;
  the re-run 429 was the address's 60-second code gap (sign_in_codes now cleared in setup, proved
  both ways). Two are Kd's decisions, asked: the old free-text "medical conditions" box still
  stored on the fitness profile (H2 — comments corrected meanwhile) and consent_log after a purge (H3).
- Verified after the fixes: shared tsc + 66 tests; api tsc + eslint exit 0; `plan.unit` +
  `nutrition.unit` 76; local Postgres per file: `users.health.routes` 19 (twice, back to back) ·
  `db.migration` 21 · `privacy.purge` 21 · `privacy.export` 10 · `users.fitness.routes` 10 ·
  `nutrition.routes` 29. Mutations: under-18 line and the active-only guards removed → 3 tests red.
- Kd ruled the same day (RULINGS 2026-09-09): consent log kept six years past deletion, then
  removed — built as a run-level step of the Day-14 purge (`CONSENT_PROOF_RETENTION_DAYS`,
  `repo.deleteExpiredConsentProof`, fake-clock test); the old conditions box goes at 4b.
- Re-check (fresh chat): one High, five Low, four test gaps — all fixed in this commit. The consent
  limiter's IP dimension capped a whole gym at thirty an hour, so the eleventh person onboarding from
  the gym's wi-fi could not record their tap (`ipMax: 600`, the trial door's pattern); the export's
  1000-row consent cap was silent (the envelope gained `truncated`, schemaVersion 2); the proof now
  outlives six CALENDAR years (`6*365+2` — the old number deleted it two days early); a failed
  consent-expiry step no longer reads as a member's failed purge (its own field, both entrypoints
  still fail the run); the two comments that contradicted RULINGS 2026-09-09 corrected.
- Every new test was run RED against the old code first: 11 people × 3 taps from ONE address all 201 ·
  the export cap AND its count · an ACTIVE user with a stale `deleted_at` keeps their proof (pins the
  `status = 'deleted'` clause) · a failed expiry reports `errors: 0` with its own flag · and an
  UNGATED (so CI runs it) check that the window is never shorter than six calendar years.
- Verified after the re-check fixes: shared tsc + 66 tests; api tsc + eslint exit 0; `plan.unit` +
  `nutrition.unit` 76; local Postgres `privacy.purge` 24 · `privacy.export` 12 · `users.health.routes`
  20 (56 in one run) · `db.migration` 21; the CI-shaped run with no DATABASE_URL 296 passed.
- Re-check round 2 (fresh chat): NO Critical/High — four Lows and three test gaps, all fixed in
  this commit. The export's consent read is ONE statement now (`count(*) OVER ()`, so a tap landing
  between two round trips can no longer make the file announce a cut that never happened) and reads
  NEWEST-first like the list route, so a capped export keeps the taps the person agreed to LAST;
  the consent limiter's address ceiling is the gym-floor 3000 (600 was still under a 300-member
  induction's 900 taps); `noCalorieCut`'s doc no longer points a screen at a flag that cannot
  answer "does the under-18 rule apply to this person" — nothing does, so 4b/4c read the age.
- The shortfall rule lives once now (`purgeShortfall`), called by both entrypoints. Neither
  `src/worker.ts` nor `tools/dpdp-purge.ts` is imported by any test, so deleting
  `|| consentProofExpiryFailed` from both copies left the whole suite green — and a run whose
  six-year expiry failed would have been acked COMPLETED (no failed set, no Sentry, exit 0).
- Every new test was run RED first: the dropped shortfall term · an inline copy put back in
  worker.ts · the export read flipped to oldest-first (the file then led with `older-1000`, the
  fixture's newest row gone) · `truncated`'s `.strict()` and its refine, removed one at a time.
- Verified: api tsc + eslint exit 0; shared tsc + eslint exit 0; shared 69; the CI-shaped run with
  no DATABASE_URL 299 passed; local Postgres `privacy.export` 12 · `privacy.purge` 27 ·
  `users.health.routes` 20 (59 in one run); the FULL local suite 931/939 — the 8 are
  `workouts.sync`, which passes alone (23), ROADMAP item 10's shared-database flake. That full run
  earned its keep: it caught the new cap test stamping its rows from `now()`, which on a loaded
  database put a seeded row ahead of the fixture's own. Stamped from the fixture's row instead.
- Kd ruled the same day (RULINGS 2026-09-09): a card with no screen gets no click-through, so 3b
  is proved by its tests and checks alone. Merged to `master` 2026-09-09 on his word (PR #57, all
  five CI jobs green, branch deleted, roadmap ticked). Only `master` and the stale local
  `workout-calendar-parked` remain.
- Open: Stage 1 item 3c (allergen tags on every food), then 4a. 4b builds the health screen these
  routes are waiting for, and switches off the old free-text conditions box.

## 2026-09-08 · The plan maths and its sanity rules (Stage 1 item 3a), branch `plan-maths`

- Built: the contract `packages/shared/src/plan.ts` (answers so far in, `plan` or `missing` out,
  never both) and the pure calculator `apps/api/src/modules/plan/maths.ts`: resting burn
  (Mifflin-St Jeor, as the nutrition targets), daily burn from the day's factor plus the week's
  training, pace → cut or surplus, macros (the targets' protein table, 25 % fat, 50 g carb floor),
  finish date from a "today" the caller passes (no clock). Flags: target wrong direction ·
  target below the healthy weight (BMI 18.5; the plan runs to the floor) · over a year (with the
  gentlest pace that fits, or null) · calorie floor 1200 applied · no deficit (under 18,
  pregnancy, heart, blood pressure, diabetes). Health unanswered = no condition rule yet.
- Engineering choices: day factors are the no-exercise ones (1.2 / 1.3 / 1.45 / 1.6) because
  training is added on top at 5 MET; paces 0.25 / 0.5 / 0.75 kg a week, the same table for a gain.
- Verified: shared + api tsc and eslint exit 0; `test/plan.unit.test.ts` 36 passed; shared 59 passed.
  `tools/plan-preview.ts` prints the numbers for one person (the click-through). No screen, no
  route, no migration — 4a builds the route and screens on this contract.
- Review round 1 (fresh chat): 4 High + 7 Low + 5 test gaps, all fixed in the second commit. A target
  the calories cannot reach (the floor left no cut, or more than ten years away) is now the flag
  `target_out_of_reach` with no date, instead of a crash or a finish date in the year 4417; the
  screen's numbers subtract and add up exactly (change = eat − burn on whole kcal; the macro grams
  make the calories, protein giving way to the 50 g carb floor for a heavy body); one rounded
  healthy-weight floor; two-decimal rails and a bounded start day in the contract; the profile's
  age rail is 16 (RULINGS 2026-09-07) on the server and the old web form; the nutrition targets
  now read resting burn, the floor and the macro split from the plan calculator (the activity factor
  and the cut still differ — moved to 4a in ROADMAP); the preview tool's health screen is unanswered
  unless all four answers are given. Safe mode's `safe_mode` reason noted on 3b.
- Verified after the fixes: shared + api tsc and eslint exit 0; `plan.unit` 44 + `nutrition.unit` 28
  passed; shared 59 passed; `users.fitness.routes` 10 passed on local Postgres.
- A live screen moved: the macro rings' protein gram now gives way to the 50 g carb floor, so a
  very short, very heavy or very old profile (the reviewer measured about 0.5 % of a 912 912-profile
  grid; largest change 242 g → 182 g) shows a smaller protein number than before. It was a bug — the
  old number did not fit in the day's calories — not a ruling change.
- Re-check (fresh chat): no Critical/High; three Lows and three test gaps, fixed in the third commit:
  the flag docstring says when the plan holds the weight instead of running to the floor; resting
  burn takes the `Gender` enum again (the nutrition targets narrow their string once, failing loud);
  the no-clock test compares every field under two clocks; the gain-floor test asserts the flag; and
  a grid sweep over the schema's corners (every goal, both formulas, the age/height/weight rails,
  targets on both sides and past the horizon) checks every plan adds up and the contract accepts it.
- Merged as PR #56 on 2026-09-09 (CI green; branch deleted). On the way, the attendance boundary
  test was fixed to never sit on the gym's midnight (CI had run at 00:00 Kolkata and the test's
  own premise failed before the code ran). Kd merged on the re-check's verdict: no Critical/High.
- Open: 3b (health screening, Safe mode, consent log).

## 2026-09-08 · Words by type everywhere else (Stage 1 item 2b), branch `words-by-type`

- Built: one word table in `@app/shared` (`orgWords.ts`) read by the API and by every screen —
  a gym has members and a Trainer, a studio and a personal trainer have clients and a Coach.
  A personal trainer's org has TWO nouns: their console says "business", their clients read
  "trainer". About sixty sentences now follow it: the console shell (Studio console · Clients),
  Overview, roster, Settings, staff, codes, hours, attendance, the plan prompt, and the member's
  join door, My Gyms and attendance card.
- Server: the join refusals name the place in its own word ("Ask the studio for a current one");
  a code matching nothing says "any gym, studio or trainer"; the not-on-plan, archived, staff,
  cheer and nudge messages follow the type. "Gym not found." became "Organisation not found." —
  that 404 cannot know a type, and telling a stranger one would answer a question they were refused.
- Verified: shared + api tsc and eslint exit 0; engine 213 passed; shared 59 passed; web 1857
  passed (the pre-existing `poseAssets.contract.test.js` encoding failure is red on clean master
  too — checked by stashing); api `orgs.routes` + `orgs.hours` + `orgs.attendance` 227 passed and
  `orgs.cheers` + `orgs.nudges` green. The full api run showed 3 failures in `catalog.seed`, which
  pass alone: the shared-database flake ROADMAP item 10 already carries (`zz_p22_hidden` is
  `exercises.routes`'s fixture).
- New tests: `packages/shared/test/orgWords.test.ts`, `apps/web/src/pages/console/orgWords.render.test.jsx`
  (a studio and a trainer console, each with the gym asserted beside it as the control), plus
  cases in the My Gyms, join-door, consoleView and staffView suites and two api route tests.
- Judgement calls for Kd: the console has no "Workouts" label to swap for "Sessions" — its tiles
  count VISITS by his own ruling, and the only "workout" words mean the member's own history, so
  that third of §2.2's vocabulary row has no site today. A member in a gym AND a studio sees the
  neutral "My organisations", because no type's word is true of that list.
- Kd clicked through on 2026-09-08 and passed it, skipping the steps whose ground was
  already covered by item 2a's smoke. PR #55, CI green on all five jobs.
- Review round 1 (fresh chat): six Lows, zero High, security pass clean. All six fixed — the
  console front door now says Coach; the member's archived refusal uses the member's word;
  the seat-cap and trainer-scope refusals follow the type; the attendance switch names what
  the member's app calls the place; `privilegeCopy` re-indented. The reviewer's seven test
  gaps are closed: every new `orgType` parameter now has a literal-string observer at a
  studio (unit suites), plus My Gyms rendered at a studio with scheduled hours and the
  membership card's three rows at a studio. Web 1876 passed; api orgs suites 267 passed.
- Kd waived the re-check (zero Critical/High, six Lows all fixed, CI green): *"no extra review
  needed"*. Merged to `master` 2026-09-08 (PR #55), branch deleted. Next: roadmap Stage 1 item 3a.

## 2026-09-08 · Organisation types (Stage 1 item 2a), merged as PR #53

- Built: `personal_trainer` joins `gym` and `studio` as a creatable type; migration `0024` widens
  `gyms_org_type_check` (clinic stays readable). The create screen is "Create your organisation"
  with three type cards and words that follow the type (a gym has members; a studio and a trainer
  have clients); `/console` sends a person who runs nothing straight to `/console/new`; a personal
  trainer's assistant (staff role `trainer`) gets the client list; a studio's trainer is told so in
  the studio's word; the migration test asserts the deployed CHECK equals `orgTypeSchema`.
- Verified: shared + api tsc, api eslint exit 0; `orgs.routes` + `db.migration` on local Postgres
  169 passed; web 1836 passed (pre-existing `poseAssets.contract.test.js` encoding failure remains).
- Kd clicked through all nine steps: passed. He ruled on trial abuse (RULINGS 2026-09-08); Stage 3
  item 2 split into 2a–2e. Review re-check found four Lows, fixed; CI green; merged, branch deleted.
  Next: roadmap Stage 1 item 2b (words by type on every other screen).

## 2026-09-07 · Sign-in by email code (Stage 1 item 1), branch `sign-in-by-email-code`

- Built: `POST /v1/auth/code/send` and `/verify` (codes HMAC-stored in new table `sign_in_codes`,
  migration 0023; ten-minute life, one resend after 60 s, two a day per address, five guesses,
  single use, address is the tenant); Resend transport with no SDK (`src/email/`); the dev sender
  prints the code in the API log when `RESEND_API_KEY` is unset; production refuses to boot without it.
- Web: one "Get started" screen at `/login` (doors "Train" / "Manage my gym, studio or clients",
  email → code → landing); `/register` and `/forgot-password` fold into it; Settings loses the
  password card and deletes the account with an emailed code (`POST /v1/users/me/delete-code`,
  then `DELETE /v1/users/me {code}`). Password routes stay on the server, switched off on screen.
- Kd amended his ruling mid-plan (RULINGS 2026-09-07): no password at all; one resend; two codes a day.
- Verified per package (the root `turbo` scripts cannot run on Kd's machine: turbo calls a global
  pnpm 11 that refuses the 9.15.4 pin — CI uses the pinned one): api/shared/config/engine tsc +
  eslint green; `auth.code.test.ts` 18 + unit 16 green on local Postgres; touched suites (users,
  orgs delete, auth, google, migration 0023) green; web 1824 green (`poseAssets.contract.test.js`
  fails on clean master too — pre-existing, local encoding); `tools/mutate-auth.mjs` 18 mutants, 17 RED + 1 alive by design
  (four survived the first sweep because a sibling check covered them; the tests were
  strengthened until each fell) — the table is in the PR.
- Review round 1 (Opus, fresh chat) found 4 High + 6 Low; all fixed in the second commit on the
  branch: too-soon keeps the live code on screen · per-IP send ceiling cut to 20/h and ONE
  ceiling across everyone (`CODE_EMAILS_PER_DAY`, default 5000) · the Day-14 purge deletes the
  address from `sign_in_codes` · the undo email is sent and its page `/restore-account` exists ·
  a per-address lock closes the day-cap race · `EMAIL_FROM` shape-checked at boot. Mutants now 18.
- Re-check closed all ten and found two the fixes had introduced, both fixed in the third commit:
  the daily ceiling now counts emails sent, not requests (checked in the preHandler, stepped
  after the send resolves) · Resend says "New code sent." only when one was. Each fix has a test
  that was run red on the old code first; A16 re-run RED against its new anchor.
- Re-checks on 2026-09-08 (three more commits, zero High at any point): a used code still holds the
  sixty-second gap; a too-soon refusal claims only the wait, never that a code was sent or is still
  valid; the too-soon header gives way to a timeless line when the countdown ends, and its words are
  built once with the gap read from `SIGN_IN_CODE_RULES` in `@app/shared`. Each header claim is
  pinned by a test that was run red against the old behaviour. CI green on a2881e6.
- Kd delegated work sizing to the chat; Stage 1 items 3–7 split into lettered one-chat lines in
  `ROADMAP.md` (RULINGS 2026-09-08). The next chat starts at item 2, then 3a.
- Merged to `master` 2026-09-08 on Kd's word (PR #51, CI green, branch deleted). Next: Stage 1 item 2.

## 2026-09-07 · The reset (Fable 5.1, this session)

- Kd ruled the project too slow and the record files "a novel"; gave the chat authority to
  restructure; features are never deleted. Decisions from the session are in `RULINGS.md`
  (bottom of each section, dated 2026-09-07) and the plan is `ROADMAP.md` Stage 1.
- Moved to `archive/`: the six record files, the card and plan files, review prompts, the 35
  smoke sheets, the three record-checking scripts, the old backends and the old root compose
  and env files. Git history is intact (renames). Nothing deleted.
- Rewrote `CLAUDE.md` (the rules), created `RULINGS.md`, `ROADMAP.md`, this file; root `lint`
  no longer runs the record-file guards.
- `master` now holds everything (fast-forwarded from `web-repoint`, CI green on the PR run);
  49 remote and 37 local merged branches deleted; `web-repoint` retired. Only `master` and
  the stale local `workout-calendar-parked` remain (its work was redone on the main line).
- Open: Stage 1 item 1 (sign-in by email code) starts in a fresh chat, on a new branch off
  `master`, with a ten-line plan to Kd first. Kd wants Fable at high effort for it.
- Not touched this session: any `src` file, any test, any migration, the database, the dev servers.
