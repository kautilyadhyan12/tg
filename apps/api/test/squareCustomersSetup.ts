// What Members in Square left behind before it was taken out with Square Point of Sale (18d-iii-b-v, Kd, 2026-10-30): each
// current record linked to the customer Square already had with the same email or phone and the same name, or added as a
// customer of its own carrying the record's id. Tests of what still reads those rows (Delete permanently, Square's merges)
// put them in place with it, straight into Postgres and the fake.
import { randomBytes } from "node:crypto";
import type { Sql } from "postgres";
import { cardNameParts } from "@app/shared";
import { readPhone } from "../src/modules/orgs/memberList/phone.js";
import { sameNameForSquare } from "../src/modules/orgs/payments/squareSameName.js";
import type { Account, fakeSquare } from "./fakeSquareTerminal.js";

type FakeSquare = ReturnType<typeof fakeSquare>;

/** The gym's current records not yet in this Square account linked or added; how many of each. */
export async function putMembersInSquare(
  sql: Sql,
  square: FakeSquare,
  gym: { id: string; acct: Account },
  environment: "sandbox" | "production" = "production",
): Promise<{ linked: number; added: number }> {
  const accountId = gym.acct.merchantId;
  const people = await sql<{ id: string; full_name: string; email: string | null; phone_e164: string | null }[]>`
    SELECT e.id, e.full_name, e.email::text AS email, e.phone_e164 FROM gym_member_list_entries e
    WHERE e.gym_id = ${gym.id} AND e.former_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM gym_square_customers c
                      WHERE c.gym_id = e.gym_id AND c.entry_id = e.id AND c.environment = ${environment} AND c.account_id = ${accountId})
    ORDER BY e.id`;
  const taken = await sql<{ customer_id: string }[]>`
    SELECT customer_id FROM gym_square_customers
    WHERE gym_id = ${gym.id} AND environment = ${environment} AND account_id = ${accountId} AND customer_id IS NOT NULL`;
  const records = await sql<{ id: string }[]>`SELECT id FROM gym_member_list_entries WHERE gym_id = ${gym.id}`;
  const country = gym.acct.country === "US" ? "US" : "CA";
  const held = new Set(taken.map((t) => t.customer_id));
  const recordIds = new Set(records.map((r) => r.id));
  const fold = (email: string | null | undefined): string => (email ?? "").trim().toLowerCase();
  const customers = square.customersOf(gym.acct).filter((c) => !held.has(c.id));
  let linked = 0;
  let added = 0;
  for (const p of people) {
    const ours = customers.find((c) => c.reference_id === p.id && c.creation_source !== "MERGE");
    const same = customers.find((c) => {
      if (c.reference_id != null && recordIds.has(c.reference_id)) return false;
      const byEmail = fold(p.email) !== "" && fold(c.email_address) === fold(p.email);
      const phone = (c.phone_number ?? "") === "" ? null : readPhone(c.phone_number ?? "", country).e164;
      const byPhone = p.phone_e164 !== null && phone === p.phone_e164 && (fold(c.email_address) === "" || fold(p.email) === "" || fold(c.email_address) === fold(p.email));
      return (byEmail || byPhone) && sameNameForSquare({ givenName: c.given_name ?? null, familyName: c.family_name ?? null }, p.full_name);
    });
    const found = ours ?? same;
    if (found !== undefined) {
      await sql`
        INSERT INTO gym_square_customers (gym_id, entry_id, environment, account_id, customer_id, joined_at, made_as)
        VALUES (${gym.id}, ${p.id}, ${environment}, ${accountId}, ${found.id}, ${ours === undefined ? new Date() : null}, ${ours === undefined ? null : p.id})`;
      held.add(found.id);
      customers.splice(customers.indexOf(found), 1);
      linked += 1;
      continue;
    }
    const id = `CUS${randomBytes(6).toString("hex").toUpperCase()}`;
    const { givenName, familyName } = cardNameParts(p.full_name);
    square.customer(gym.acct, {
      id,
      given_name: givenName === "" ? null : givenName,
      family_name: familyName === "" ? null : familyName,
      email_address: p.email,
      phone_number: p.phone_e164,
      reference_id: p.id,
      creation_source: "THIRD_PARTY",
    });
    await sql`
      INSERT INTO gym_square_customers (gym_id, entry_id, environment, account_id, customer_id, made_as)
      VALUES (${gym.id}, ${p.id}, ${environment}, ${accountId}, ${id}, ${p.id})`;
    added += 1;
  }
  return { linked, added };
}
