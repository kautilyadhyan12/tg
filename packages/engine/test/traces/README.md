# Golden traces (Part 2 §7)

One recorded session per `.jsonl` file: JSON header line (with the authored
`expected` block — the locked truth), then one PoseFrame per line (§7.1).

- Recorded by the web app's dev "record trace" toggle (P1.3, §7.2).
- Fixture matrix per exercise before it leaves beta: §7.3 (≥6 traces).
- Parity traces for squat/jump-squat/chair-squat carry the *Python analyzer's*
  outputs as `expected` (§7.5).
- Raw video is never stored — stick-figure data only (privacy invariant).

Empty until task P1.3 records the first fixtures.
