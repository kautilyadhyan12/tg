# Stop a gym's Square connection from our side

ROADMAP Stage 2 item 18d-ii; `apps/api/tools/square-stop.ts`. A gym connects its own Square
account (18d-i) and disconnects it with its own Disconnect button. This tool takes back OUR
app's permission at a gym's Square account without the gym pressing anything. It leaves the
gym's Square account, its money and its customers alone: Square's revoke ends only the tokens
our app holds for that account.

## Symptoms

- We were hacked, or `PAYMENT_TOKENS_KEY` or a database copy got out: every gym's Square
  access must stop now, and the gyms would not know to press Disconnect.
- A gym is cheating its members (charging cards it should not) and will not disconnect.

## Steps

1. Get, from escrow, the environment's `DATABASE_URL`, `SQUARE_ENV`, `SQUARE_APPLICATION_ID`,
   `SQUARE_APPLICATION_SECRET` and `PAYMENT_TOKENS_KEY` into a key file that is not in git
   (the laptop's is `apps/api/.env.square.local`). Never paste them into a terminal.
2. From `apps/api`, see what would be stopped. Nothing changes without `--yes`:

   ```
   $env:DATABASE_URL='<the environment's database>'
   corepack pnpm exec node --env-file=<the key file> --import tsx tools/square-stop.ts --gym <gymId>
   corepack pnpm exec node --env-file=<the key file> --import tsx tools/square-stop.ts --all
   ```

   Each line names a Square account and, under it, every gym here holding it. One Square
   account can be connected to two gyms of one owner: Square's revoke ends the account's
   access for both, so both are listed.
3. Run the same line again with `--yes`. Each account reads `stopped`: Square ended its tokens,
   and every gym holding it is marked disconnected, with an `org.payments_square_stopped` note
   in `audit_log`. `refused` or `unavailable`: Square did not stop it; the gym is left
   connected. Run it again; the tool exits 1 while any is left.
4. After a leak, also rotate `SQUARE_APPLICATION_SECRET` in Square's Developer Console and
   `PAYMENT_TOKENS_KEY` (no gym is connected any more, so nothing locked under the old key is
   lost), then tell the gyms to connect again.

## Verify recovered

- The tool's dry run (no `--yes`) prints "No connected Square account" for what was stopped.
- The gym's Settings → Payments reads "Square was disconnected", and a person's Card on file
  says to connect Square. Its cards stay in the gym's own Square account; reconnecting the
  same account shows them again.
- Square's own token check refuses the old tokens (a minute or so after: Square's check lags a
  revoke by some seconds, seen 2026-10-20).
