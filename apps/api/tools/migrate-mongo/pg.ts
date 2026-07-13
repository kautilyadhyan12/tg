// P2.7b — Postgres connection for the migration tool. Uses the existing
// `postgres` dep (no new PG dep). prepare:false + max:1 matches the app's
// single-connection convention for one-shot scripts.
import postgres, { type Sql } from "postgres";

export function connectPg(url: string): Sql {
  return postgres(url, { prepare: false, max: 1 });
}
