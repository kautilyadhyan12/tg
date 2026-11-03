// Signed forms of deleted members (ROADMAP 18u-iii): the gym's own owner alone reads them, as
// Connect Square is theirs alone; a co-owner or anybody else on the staff is refused, and anybody
// not on its staff is told the gym is not there.
import {
  DELETED_FORMS_PAGE_SIZE,
  DELETED_FORMS_WORDS,
  deletedFormResponseSchema,
  deletedFormsResponseSchema,
  type DeletedFormKind,
  type DeletedFormResponse,
  type DeletedFormsQuery,
  type DeletedFormsResponse,
} from "@app/shared";
import type { Sql } from "postgres";
import { CONSENT_PROOF_RETENTION_DAYS } from "../../../retention.js";
import { consentProofCutoff } from "../../privacy/purge.js";
import { getStaffAuthority } from "../repo.js";
import { ORG_NOT_FOUND_MESSAGE, OrgsError } from "../service.js";
import * as repo from "./repo.js";

export interface DeletedFormsDeps {
  sql: Sql;
  now: () => Date;
}

type Limit = () => Promise<boolean>;

const DAY_MS = 24 * 60 * 60 * 1000;
const keptUntil = (deletedAt: Date): string => new Date(deletedAt.getTime() + CONSENT_PROOF_RETENTION_DAYS * DAY_MS).toISOString();

/** 404 for anybody not on the gym's staff, as every staff route answers; 403 for staff but its own owner. */
async function requireOwnOwner(deps: DeletedFormsDeps, gymId: string, userId: string): Promise<{ name: string; timezone: string }> {
  const [gym, authority] = await Promise.all([repo.gymOf(deps.sql, gymId), getStaffAuthority(deps.sql, gymId, userId)]);
  if (gym === null || authority === null) throw new OrgsError(404, "org_not_found", ORG_NOT_FOUND_MESSAGE);
  if (gym.ownerUserId !== userId) throw new OrgsError(403, "owner_only", DELETED_FORMS_WORDS.owner_only);
  return gym;
}

export async function listDeletedForms(
  deps: DeletedFormsDeps,
  userId: string,
  gymId: string,
  query: DeletedFormsQuery,
  limit: Limit,
): Promise<DeletedFormsResponse | null> {
  const org = await requireOwnOwner(deps, gymId, userId);
  if (!(await limit())) return null;
  // One more than a page: whether there is a next one.
  const { rows: read, total } = await repo.listForms(deps.sql, {
    gymId,
    cutoff: consentProofCutoff(deps.now()),
    pattern: repo.searchPattern(query.q),
    limit: DELETED_FORMS_PAGE_SIZE + 1,
    after: repo.readCursor(query.after),
  });
  const rows = read.slice(0, DELETED_FORMS_PAGE_SIZE);
  const last = rows.at(-1);
  return deletedFormsResponseSchema.parse({
    forms: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      signedName: row.signedName,
      signer: row.signer,
      member: row.member,
      agreementName: row.agreementName,
      signedAt: row.signedAt.toISOString(),
      deletedAt: row.deletedAt.toISOString(),
      keptUntil: keptUntil(row.deletedAt),
    })),
    total,
    next: read.length > DELETED_FORMS_PAGE_SIZE && last !== undefined ? repo.cursorOf(last) : null,
    timezone: org.timezone,
  });
}

export async function readDeletedForm(
  deps: DeletedFormsDeps,
  userId: string,
  gymId: string,
  kind: DeletedFormKind,
  formId: string,
  limit: Limit,
): Promise<DeletedFormResponse | null> {
  const org = await requireOwnOwner(deps, gymId, userId);
  if (!(await limit())) return null;
  const cutoff = consentProofCutoff(deps.now());
  const kept = (deletedAt: Date) => ({ gymName: org.name, timezone: org.timezone, deletedAt: deletedAt.toISOString(), keptUntil: keptUntil(deletedAt) });
  if (kind === "waiver") {
    const row = await repo.waiverForm(deps.sql, gymId, formId, cutoff);
    if (row === null) throw new OrgsError(404, "form_not_found", DELETED_FORMS_WORDS.not_found);
    return deletedFormResponseSchema.parse({
      kind,
      ...kept(row.deletedAt),
      signed: { name: row.name, signer: row.signer, at: row.at.toISOString(), by: row.by, version: row.version, text: row.text },
    });
  }
  const row = await repo.agreementForm(deps.sql, gymId, formId, cutoff);
  if (row === null) throw new OrgsError(404, "form_not_found", DELETED_FORMS_WORDS.not_found);
  return deletedFormResponseSchema.parse({
    kind,
    ...kept(row.deletedAt),
    signed: {
      name: row.name,
      signer: row.signer,
      at: row.at.toISOString(),
      by: row.by,
      version: row.version,
      text: row.text,
      facts: row.facts,
      emailedAt: row.emailedAt?.toISOString() ?? null,
      agreementName: row.agreementName,
      via: row.via,
    },
  });
}
