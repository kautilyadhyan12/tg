# 2026-11-25 · GitHub's checks run at once (branch `ci-parallel`)

## How work is done

- **2026-11-25, Kd: "we need to do something about this long run in github, it is taking way too much time"; "go" on the plan.** The one long check becomes parts that run at the same time, each on a free machine of its own; the six checks `master` requires keep their names; nothing costs money.
- **Every test runs on every code push** (the plan Kd said go to). The terminal's own, his to overrule: no check is skipped by what a push touched and nothing is remembered from an earlier run, because tests in one package read files in another and a skip could not be shown safe.
- **The terminal's own, his to overrule:** each part has a time limit of 25 minutes; a part that grows past it goes red and is split again, so the wait cannot creep up unseen as it did from 2026-10-12 to 2026-11-24.
