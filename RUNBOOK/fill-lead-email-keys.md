# Fill the lead email keys (once per database that already holds leads)

ROADMAP 20c-v-b; migration `0052_lead_email_results`. The Leads list finds a lead's email
problems (a bounce, an address the email service refuses, a spam report) by the key kept
on the lead, `gym_leads.email_hmac`. The api writes it with every address from 0052 on;
leads written before 0052 have none until this is run.

## Symptoms

- The Leads page shows no "Email problems" chip, and no row is tagged, although a lead's
  own panel says "Emails to this address bounce".
- `SELECT count(*) FROM gym_leads WHERE email IS NOT NULL AND email_hmac IS NULL;` is above 0.

## Steps

1. Run after the migrations, with the SAME `INVITE_HMAC_SECRET` the api runs with (escrow
   name `INVITE_HMAC_SECRET`). On any database that is not local the tool refuses to run
   without it: the development key would write keys the live api never matches, and a
   second run fills only empty keys, so it could not repair them.

   ```
   DATABASE_URL=<the environment's database> INVITE_HMAC_SECRET=<from escrow> NODE_ENV=production corepack pnpm --filter api exec tsx tools/lead-email-hmacs.ts
   ```

2. It prints how many leads it filled. Run it again: it prints 0.

## Verify recovered

- `SELECT count(*) FROM gym_leads WHERE email IS NOT NULL AND email_hmac IS NULL;` is 0.
- A lead known to have bounced is tagged "Email bounces" on the Leads page.
