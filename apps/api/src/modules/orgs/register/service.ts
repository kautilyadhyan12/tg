// The register (spec Part 3 §14.3; ROADMAP 18b-i).
//
// Selling and taking a sale back need `billing.members`, the notebook's own tick: a sale
// is a payment staff say they were handed. Changing the products and the tax needs
// `memberships.manage`, the tick for what the gym sells and what each costs. Whoever
// holds either may read the page. Writes go through `requireWritablePrivilege`, so a gym
// with no live plan reads its register and cannot change it.
//
// Every amount is worked out here, from the product's own price and the gym's own tax;
// the sale's day is the gym's own, never the caller's.
import type { Sql } from "postgres";
import {
  PURCHASES_SHOWN,
  REGISTER_WORDS,
  SALES_SHOWN,
  SALE_PEOPLE_FOUND,
  memberCurrencyForCountry,
  memberPurchasesResponseSchema,
  outOfStockWords,
  sellPageResponseSchema,
  salePeopleResponseSchema,
  sellProductResponseSchema,
  type MemberPaymentMethod,
  type MemberPurchasesResponse,
  type OrgPrivilege,
  type SellPageResponse,
  type SalePeopleResponse,
  type SalesTax,
  type SaveGymProductRequest,
  type SellProductRequest,
  type SellProductResponse,
  type UpdateGymProductRequest,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { MEMBER_LIST_BY_HAND_WORDS } from "@app/shared";
import { OrgsError, requireStaff, requireWritablePrivilege } from "../service.js";
import { paymentsOn } from "../memberships/billsSql.js";
import * as repo from "./repo.js";

export interface RegisterDeps {
  sql: Sql;
  now: () => Date;
}

const SELL: OrgPrivilege = "billing.members";
const MANAGE: OrgPrivilege = "memberships.manage";

interface Viewer {
  timezone: string;
  canSell: boolean;
  canManage: boolean;
  /** Keeps the gym's list, so is sent a record's email. */
  seesEmail: boolean;
}

/** Who is asking: staff of this gym holding either tick, or refused. A stranger gets
 *  `requireStaff`'s 404. */
export async function requireReader(deps: RegisterDeps, userId: string, gymId: string): Promise<Viewer> {
  const { org, privileges } = await requireStaff(deps, gymId, userId);
  const viewer = { timezone: org.timezone, canSell: privileges.includes(SELL), canManage: privileges.includes(MANAGE), seesEmail: privileges.includes("members.confirm") };
  if (!viewer.canSell && !viewer.canManage) throw new OrgsError(403, "forbidden", REGISTER_WORDS.no_selling);
  return viewer;
}

/** May record a sale or take one back, at a gym that can be changed. */
export async function requireSeller(deps: RegisterDeps, userId: string, gymId: string): Promise<Viewer> {
  const viewer = await requireReader(deps, userId, gymId);
  if (!viewer.canSell) throw new OrgsError(403, "forbidden", REGISTER_WORDS.no_selling);
  await requireWritablePrivilege(deps, gymId, userId, SELL);
  return viewer;
}

/** May change the products and the tax, at a gym that can be changed. */
export async function requireManager(deps: RegisterDeps, userId: string, gymId: string): Promise<Viewer> {
  const viewer = await requireReader(deps, userId, gymId);
  if (!viewer.canManage) throw new OrgsError(403, "forbidden", REGISTER_WORDS.no_managing);
  await requireWritablePrivilege(deps, gymId, userId, MANAGE);
  return viewer;
}

const iso = (p: repo.ProductRow) => ({ ...p, archivedAt: p.archivedAt === null ? null : p.archivedAt.toISOString(), updatedAt: p.updatedAt.toISOString() });

const shownSale = (s: repo.SaleRow, today: string, canSell: boolean) => ({
  ...s,
  soldAt: s.soldAt.toISOString(),
  canUndo: canSell && !s.undone && s.soldOn === today,
});

async function read(deps: RegisterDeps, gymId: string, viewer: Viewer): Promise<SellPageResponse> {
  const today = dayInTz(deps.now(), viewer.timezone);
  // A membership's payment is the notebook's: read only for whoever may record one.
  const [row, paid] = await Promise.all([
    repo.readRegister(deps.sql, gymId, today, SALES_SHOWN),
    viewer.canSell ? paymentsOn(deps.sql, gymId, today, SALES_SHOWN) : null,
  ]);
  if (row === null) throw new OrgsError(404, "org_not_found", "Organisation not found.");
  const of = (method: MemberPaymentMethod): number => paid?.byMethod.get(method) ?? 0;
  const paidMinor = of("cash") + of("card_at_desk") + of("bank_transfer") + of("link") + of("company");
  // Parsed, not cast: a method or an amount the contract does not know fails here.
  return sellPageResponseSchema.parse({
    currency: memberCurrencyForCountry(row.country),
    today,
    tax: row.tax,
    products: row.products.map(iso),
    archived: row.archived.map(iso),
    archivedTotal: row.archivedTotal,
    canSell: viewer.canSell,
    canManage: viewer.canManage,
    sales: row.sales.map((s) => shownSale(s, today, viewer.canSell)),
    salesNotShown: row.salesTotal - row.sales.length,
    payments:
      paid === null
        ? null
        : paid.payments.map((p) => ({
            id: p.id,
            typeName: p.typeName,
            amountMinor: p.amountMinor,
            currency: p.currency,
            method: p.method,
            paidAt: p.paidAt.toISOString(),
            by: p.by,
            person: { entryId: p.entryId, name: p.personName.trim() === "" ? repo.NO_NAME : p.personName },
          })),
    paymentsNotShown: paid === null ? 0 : paid.count - paid.payments.length,
    totals: {
      count: row.totals.count,
      payments: paid?.count ?? 0,
      totalMinor: row.totals.totalMinor + paidMinor,
      taxMinor: row.totals.taxMinor,
      cash: row.totals.cash + of("cash"),
      card_at_desk: row.totals.card_at_desk + of("card_at_desk"),
      bank_transfer: row.totals.bank_transfer + of("bank_transfer"),
      other: of("link") + of("company"),
      refundedMinor: paid?.refundedMinor ?? 0,
    },
  });
}

export async function getRegister(deps: RegisterDeps, gymId: string, viewer: Viewer): Promise<SellPageResponse> {
  return await read(deps, gymId, viewer);
}

function throwOnProductFailure(outcome: repo.ProductWriteOutcome): void {
  switch (outcome.kind) {
    case "ok":
      return;
    case "not_found":
      throw new OrgsError(404, "product_not_found", "That product was not found.");
    case "too_many":
      throw new OrgsError(409, "too_many_products", `You can have ${String(outcome.cap)} products for sale. Archive one you no longer sell first.`);
    case "name_taken":
      throw new OrgsError(409, "product_name_taken", REGISTER_WORDS.name_taken);
    case "changed":
      throw new OrgsError(409, "product_changed", REGISTER_WORDS.changed);
    case "no_currency":
      throw new OrgsError(409, "no_member_currency", REGISTER_WORDS.no_currency);
    default: {
      const never: never = outcome;
      throw new Error(`unhandled product outcome: ${JSON.stringify(never)}`);
    }
  }
}

export async function createProduct(deps: RegisterDeps, userId: string, gymId: string, viewer: Viewer, req: SaveGymProductRequest): Promise<SellPageResponse> {
  throwOnProductFailure(await repo.createProduct(deps.sql, { ...req, gymId, actorUserId: userId }));
  return await read(deps, gymId, viewer);
}

export async function updateProduct(
  deps: RegisterDeps,
  userId: string,
  gymId: string,
  viewer: Viewer,
  productId: string,
  req: UpdateGymProductRequest,
): Promise<SellPageResponse> {
  throwOnProductFailure(
    await repo.updateProduct(deps.sql, {
      name: req.name,
      priceMinor: req.priceMinor,
      taxed: req.taxed,
      stock: req.stock,
      gymId,
      productId,
      readAt: new Date(req.updatedAt),
      actorUserId: userId,
      now: deps.now(),
    }),
  );
  return await read(deps, gymId, viewer);
}

export async function archiveProduct(deps: RegisterDeps, userId: string, gymId: string, viewer: Viewer, productId: string): Promise<SellPageResponse> {
  throwOnProductFailure(await repo.archiveProduct(deps.sql, { gymId, productId, actorUserId: userId, now: deps.now() }));
  return await read(deps, gymId, viewer);
}

export async function restoreProduct(deps: RegisterDeps, userId: string, gymId: string, viewer: Viewer, productId: string): Promise<SellPageResponse> {
  throwOnProductFailure(await repo.restoreProduct(deps.sql, { gymId, productId, actorUserId: userId, now: deps.now() }));
  return await read(deps, gymId, viewer);
}

export async function saveTax(deps: RegisterDeps, userId: string, gymId: string, viewer: Viewer, tax: SalesTax): Promise<SellPageResponse> {
  await repo.saveTax(deps.sql, { gymId, tax, actorUserId: userId });
  return await read(deps, gymId, viewer);
}

export async function sellProduct(deps: RegisterDeps, userId: string, gymId: string, viewer: Viewer, req: SellProductRequest): Promise<SellProductResponse> {
  const now = deps.now();
  const outcome = await repo.sell(deps.sql, {
    gymId,
    requestKey: req.requestKey,
    productId: req.productId,
    quantity: req.quantity,
    entryId: req.entryId,
    method: req.method,
    totalMinor: req.totalMinor,
    today: dayInTz(now, viewer.timezone),
    actorUserId: userId,
    now,
  });
  switch (outcome.kind) {
    case "ok":
      return sellProductResponseSchema.parse({ saleId: outcome.saleId, register: await read(deps, gymId, viewer) });
    case "product_not_found":
      throw new OrgsError(409, "product_not_for_sale", REGISTER_WORDS.product_not_found);
    case "person_not_found":
      throw new OrgsError(404, "entry_not_found", REGISTER_WORDS.person_not_found);
    case "request_reused":
      throw new OrgsError(409, "request_reused", REGISTER_WORDS.request_reused);
    case "price_changed":
      throw new OrgsError(409, "sale_price_changed", REGISTER_WORDS.price_changed);
    case "out_of_stock":
      throw new OrgsError(409, "out_of_stock", outOfStockWords(outcome.name, outcome.left));
    default: {
      const never: never = outcome;
      throw new Error(`unhandled sale outcome: ${JSON.stringify(never)}`);
    }
  }
}

export async function undoSale(deps: RegisterDeps, userId: string, gymId: string, viewer: Viewer, saleId: string): Promise<SellPageResponse> {
  const now = deps.now();
  const outcome = await repo.undoSale(deps.sql, { gymId, saleId, today: dayInTz(now, viewer.timezone), actorUserId: userId, now });
  if (outcome.kind === "sale_not_found") throw new OrgsError(404, "sale_not_found", REGISTER_WORDS.sale_not_found);
  if (outcome.kind === "not_today") throw new OrgsError(409, "sale_not_today", REGISTER_WORDS.sale_not_today);
  return await read(deps, gymId, viewer);
}

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Who a sale can be for: the gym's own records a name, a member number or (for staff who
 *  keep the list) an email finds. */
export async function findPeople(deps: RegisterDeps, gymId: string, viewer: Viewer, query: string): Promise<SalePeopleResponse> {
  const people = await repo.peopleLike(deps.sql, gymId, `%${escapeLike(query)}%`, SALE_PEOPLE_FOUND, viewer.seesEmail);
  return salePeopleResponseSchema.parse({ people });
}

/** What one person has bought at the desk, for their page. */
export async function getPurchases(deps: RegisterDeps, gymId: string, viewer: Viewer, entryId: string): Promise<MemberPurchasesResponse> {
  const found = await repo.purchasesOf(deps.sql, gymId, entryId, PURCHASES_SHOWN);
  if (found === null) throw new OrgsError(404, "entry_not_found", MEMBER_LIST_BY_HAND_WORDS.entry_not_found);
  const today = dayInTz(deps.now(), viewer.timezone);
  return memberPurchasesResponseSchema.parse({ sales: found.sales.map((s) => shownSale(s, today, viewer.canSell)), notShown: found.total - found.sales.length });
}
