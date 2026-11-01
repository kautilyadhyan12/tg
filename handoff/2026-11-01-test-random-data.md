# 2026-11-01 · Two old tests that failed on random data (branch `test-random-data-collisions`)

- **Why:** both went red on PR #429, in tests that job did not touch. `cardExpiry.routes.test.ts`: the gym's name holds the clock (`Remind Gym 17935555692531`), which held the card's 5555. `memberList.leak.test.ts`: a random id in the name held digits the import took for a card number, and removed. The second is the "200 for 409" kind's neighbour, not proven the same.
- **Fixed:** the first checks "ending in 5555"; the name in the second holds no digits. No app code changed. Both files pass on `aihg_b`.
