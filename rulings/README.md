# rulings/ — Kd's decisions since 2026-10-13, one file for each job

`RULINGS.md` holds every ruling up to 2026-10-13, by topic, and is still law. Since that
day a job writes what Kd decided in a file of its own here, never in that one file: 14 of
19 jobs had each put a ruling in its last lines, so two jobs open together always clashed
(`2026-10-13-records-cannot-clash.md`, the first file here).

- **Name:** `YYYY-MM-DD-<the job>.md`, the day the job began: the same name as the job's
  file in `handoff/`.
- **What it holds:** one line for each thing Kd decided, dated, in his words where they
  were short, under the heading of `RULINGS.md` it belongs to (`## Gyms and the console`,
  `## How work is done`, and the others). What the terminal chose itself is marked as the
  terminal's own, his to overrule. A job in which he decided nothing has no file.
- **It is law** as `RULINGS.md` is: it overrides any terminal's judgement, and where two
  lines differ the newer one stands. A ruling that reverses or amends a line of
  `RULINGS.md` also marks that line there, in place, with the date and this file's name.
- **To find a ruling:** search both together: `grep -rn "the words" RULINGS.md rulings/`.
- What only says what happened (round one, the re-check, the merge) is not a ruling: it
  goes in the job's file in `handoff/`.
