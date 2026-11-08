# Migrating a rule the running api would break

A migration that tightens a CHECK the running api still writes against (first: `0228_delete_account_web_code`,
ROADMAP Stage 5 21b-ii, which makes the app's delete codes carry the account) must not run under the old api.

**Symptoms** of running it under the old api: the old api's writes of the refused shape answer 500 until it is
restarted (for 0228: the app's "Email me a code" in Delete account), or the migration fails and rolls back when
one such write lands between its `DELETE` and its `ADD CONSTRAINT`.

1. Stop the api and the worker.
2. Run the migrations: `corepack pnpm --filter api exec drizzle-kit migrate`.
3. Start the new api and worker.

**Verify recovered:** the migration is in `drizzle.__drizzle_migrations`, and the write it guards works on the
new api (for 0228: Settings, Delete account, Email me a code, then the code deletes the account).
