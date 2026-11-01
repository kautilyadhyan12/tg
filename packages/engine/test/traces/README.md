# Golden traces (Part 2 §7)

One recorded session per `.jsonl` file: JSON header line (with the authored
`expected` block — the locked truth), then one PoseFrame per line (§7.1).

- Recorded by the web app's dev "record trace" toggle (P1.3, §7.2).
- From a video: `measure-video` (Part 2 §11.2); count its reps by eye, give it a plain `--label` (a file name can hold a person's name, and this project's GitHub is public) and pass `validate-trace` before storing one.
- Fixture matrix per exercise before it leaves beta: §7.3 (≥6 traces).
- The `.responses.jsonl` beside a parity trace holds the *Python analyzer's* outputs
  (§7.5). `expected` holds the count of finished stand-ups on the clip's hip height
  (see `test/definitions.truecounts.test.ts`), except where its line in that test says otherwise. Every header says its picture's `aspect`.
- `../cross-check-traces` holds body points of exercises with no rules yet, for the cross-check (Part 2 §11.2, tool 4): nobody has counted them, so they are not stored tests.
- Raw video is never stored — stick-figure data only (privacy invariant).

Empty until task P1.3 records the first fixtures.
