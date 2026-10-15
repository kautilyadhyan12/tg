// Receipts (spec Part 3 §14.3; ROADMAP 18g-i). A receipt names a person and what they
// paid, so it is read only by staff of the gym who may record payments (`billing.members`,
// the notebook's own tick). A stranger gets `requireStaff`'s 404.
import type { Sql } from "postgres";
import { RECEIPT_WORDS, receiptSchema, type Receipt } from "@app/shared";
import { OrgsError, requireStaff } from "../service.js";
import * as repo from "./repo.js";

export interface ReceiptDeps {
  sql: Sql;
}

export async function requireReceiptReader(deps: ReceiptDeps, userId: string, gymId: string): Promise<void> {
  const { privileges } = await requireStaff(deps, gymId, userId);
  if (!privileges.includes("billing.members")) throw new OrgsError(403, "forbidden", RECEIPT_WORDS.no_receipts);
}

export async function getReceipt(deps: ReceiptDeps, gymId: string, number: number): Promise<Receipt> {
  const [row, gym] = await Promise.all([repo.readReceipt(deps.sql, gymId, number), repo.gymOnReceipt(deps.sql, gymId)]);
  if (row === null || gym === null) throw new OrgsError(404, "receipt_not_found", RECEIPT_WORDS.receipt_not_found);
  return receiptSchema.parse({ ...row, gym });
}
