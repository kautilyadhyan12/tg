// The register (spec Part 3 §14.3; ROADMAP 18b-i).
//
// Selling and taking a sale back need `billing.members`, the notebook's own tick: a sale
// is a payment staff say they were handed. Changing the products and the tax needs
// `memberships.manage`, the tick for what the gym sells and what each costs. Whoever
// holds either may read the page. Writes go through `requireWritablePrivilege`, so a gym
// with no live plan reads its register and cannot change it.
//
// Every amount is worked out here, from the product's own price, the gym's own tax and
// the gym's own discount; the sale's day is the gym's own, never the caller's.
//
// Discounts (18b-ii-a) are changed by whoever changes prices, and used by whoever sells.
import type { Sql } from "postgres";
import {
  DISCOUNT_WORDS,
  PURCHASES_SHOWN,
  REGISTER_WORDS,
  SALES_SHOWN,
  SALE_PEOPLE_FOUND,
  discountNothingOffWords,
  discountRefusalWords,
  memberCurrencyForCountry,
  memberPurchasesResponseSchema,
  outOfStockWords,
  productCurrencyWords,
  sellPageResponseSchema,
  salePeopleResponseSchema,
  sellProductResponseSchema,
  type MemberPaymentMethod,
  type MemberPurchasesResponse,
  type OrgPrivilege,
  type SellPageResponse,
  type SalePeopleResponse,
  type SalesTax,
  type SaveGymDiscountRequest,
  type SaveGymProductRequest,
  type SellProductRequest,
  type SellProductResponse,
  type UpdateGymDiscountRequest,
  type UpdateGymProductRequest,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { MEMBER_LIST_BY_HAND_WORDS } from "@app/shared";
import { OrgsError, requireStaff, requireWritablePrivilege } from "../service.js";
import { paymentsOn } from "../memberships/billsSql.js";
import * as discounts from "./discountsRepo.js";
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

const isoDiscount = (d: discounts.DiscountRow) => ({ ...d, archivedAt: d.archivedAt === null ? null : d.archivedAt.toISOString(), updatedAt: d.updatedAt.toISOString() });

const shownSale = (s: repo.SaleRow, today: string, canSell: boolean) => ({
  ...s,
  soldAt: s.soldAt.toISOString(),
  canUndo: canSell && !s.undone && s.soldOn === today,
});

async function read(deps: RegisterDeps, gymId: string, viewer: Viewer): Promise<SellPageResponse> {
  const today = dayInTz(deps.now(), viewer.timezone);
  // A sale names who bought it and a payment who paid: both are read only for whoever
  // may record one. Staff who only change prices are sent the products and the tax.
  const [row, paid, offered] = await Promise.all([
    repo.readRegister(deps.sql, gymId, today, SALES_SHOWN, viewer.canSell),
    viewer.canSell ? paymentsOn(deps.sql, gymId, today, SALES_SHOWN) : null,
    discounts.readDiscounts(deps.sql, gymId),
  ]);
  if (row === null) throw new OrgsError(404, "org_not_found", "Organisation not found.");
  // The day's total is in the gym's own money. What was taken in another (the gym changed
  // its country) is added to nothing, and counted so the screen can say so.
  const currency = memberCurrencyForCountry(row.country);
  const sold = row.totals.find((t) => t.currency === currency);
  const mine = (paid?.sums ?? []).filter((s) => s.currency === currency);
  const of = (method: MemberPaymentMethod): number => mine.filter((s) => s.method === method).reduce((n, s) => n + s.totalMinor, 0);
  const paidMinor = mine.reduce((n, s) => n + s.totalMinor, 0);
  const otherCurrency =
    row.totals.filter((t) => t.currency !== currency).reduce((n, t) => n + t.count, 0) +
    (paid?.sums ?? []).filter((s) => s.currency !== currency).reduce((n, s) => n + s.count, 0);
  // Parsed, not cast: a method or an amount the contract does not know fails here.
  return sellPageResponseSchema.parse({
    currency,
    today,
    tax: row.tax,
    products: row.products.map(iso),
    archived: row.archived.map(iso),
    archivedTotal: row.archivedTotal,
    discounts: offered.live.map(isoDiscount),
    archivedDiscounts: offered.archived.map(isoDiscount),
    archivedDiscountsTotal: offered.archivedTotal,
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
      count: sold?.count ?? 0,
      payments: mine.reduce((n, s) => n + s.count, 0),
      totalMinor: (sold?.totalMinor ?? 0) + paidMinor,
      taxMinor: sold?.taxMinor ?? 0,
      cash: (sold?.cash ?? 0) + of("cash"),
      card_at_desk: (sold?.card_at_desk ?? 0) + of("card_at_desk"),
      bank_transfer: (sold?.bank_transfer ?? 0) + of("bank_transfer"),
      link: of("link"),
      company: of("company"),
      refundedMinor: (paid?.refunds ?? []).filter((r) => r.currency === currency).reduce((n, r) => n + r.totalMinor, 0),
      discountMinor: sold?.discountMinor ?? 0,
      otherCurrency,
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
    discountId: req.discountId,
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
    case "currency_changed":
      throw new OrgsError(409, "product_currency_changed", productCurrencyWords(outcome.name, outcome.was, outcome.now));
    case "out_of_stock":
      throw new OrgsError(409, "out_of_stock", outOfStockWords(outcome.name, outcome.left));
    case "discount_not_found":
      throw new OrgsError(409, "discount_not_available", DISCOUNT_WORDS.not_available);
    case "discount_refused":
      throw new OrgsError(409, `discount_${outcome.reason}`, discountRefusalWords(outcome.name, outcome.reason));
    case "nothing_to_pay":
      throw new OrgsError(409, "discount_nothing_to_pay", DISCOUNT_WORDS.nothing_to_pay);
    case "discount_nothing_off":
      throw new OrgsError(409, "discount_takes_nothing_off", discountNothingOffWords(outcome.name));
    default: {
      const never: never = outcome;
      throw new Error(`unhandled sale outcome: ${JSON.stringify(never)}`);
    }
  }
}

function throwOnDiscountFailure(outcome: discounts.DiscountWriteOutcome): void {
  switch (outcome.kind) {
    case "ok":
      return;
    case "not_found":
      throw new OrgsError(404, "discount_not_found", DISCOUNT_WORDS.not_found);
    case "too_many":
      throw new OrgsError(409, "too_many_discounts", `You can have ${String(outcome.cap)} discounts at a time. Archive one you no longer offer first.`);
    case "name_taken":
      throw new OrgsError(409, "discount_name_taken", DISCOUNT_WORDS.name_taken);
    case "code_taken":
      throw new OrgsError(409, "promo_code_taken", DISCOUNT_WORDS.code_taken);
    case "changed":
      throw new OrgsError(409, "discount_changed", DISCOUNT_WORDS.changed);
    case "product_not_found":
      throw new OrgsError(409, "product_not_for_sale", DISCOUNT_WORDS.product_not_found);
    case "no_currency":
      throw new OrgsError(409, "no_member_currency", DISCOUNT_WORDS.no_currency);
    default: {
      const never: never = outcome;
      throw new Error(`unhandled discount outcome: ${JSON.stringify(never)}`);
    }
  }
}

const discountInput = (req: SaveGymDiscountRequest): discounts.DiscountInput => ({
  name: req.name,
  code: req.code,
  kind: req.kind,
  percentBp: req.percentBp,
  amountMinor: req.amountMinor,
  startsOn: req.startsOn,
  endsOn: req.endsOn,
  maxUses: req.maxUses,
  allProducts: req.allProducts,
  productIds: req.productIds,
});

export async function createDiscount(deps: RegisterDeps, userId: string, gymId: string, viewer: Viewer, req: SaveGymDiscountRequest): Promise<SellPageResponse> {
  throwOnDiscountFailure(await discounts.createDiscount(deps.sql, { ...discountInput(req), gymId, actorUserId: userId }));
  return await read(deps, gymId, viewer);
}

export async function updateDiscount(
  deps: RegisterDeps,
  userId: string,
  gymId: string,
  viewer: Viewer,
  discountId: string,
  req: UpdateGymDiscountRequest,
): Promise<SellPageResponse> {
  throwOnDiscountFailure(
    await discounts.updateDiscount(deps.sql, { ...discountInput(req), gymId, discountId, readAt: new Date(req.updatedAt), actorUserId: userId, now: deps.now() }),
  );
  return await read(deps, gymId, viewer);
}

export async function archiveDiscount(deps: RegisterDeps, userId: string, gymId: string, viewer: Viewer, discountId: string): Promise<SellPageResponse> {
  throwOnDiscountFailure(await discounts.archiveDiscount(deps.sql, { gymId, discountId, actorUserId: userId, now: deps.now() }));
  return await read(deps, gymId, viewer);
}

export async function restoreDiscount(deps: RegisterDeps, userId: string, gymId: string, viewer: Viewer, discountId: string): Promise<SellPageResponse> {
  throwOnDiscountFailure(await discounts.restoreDiscount(deps.sql, { gymId, discountId, actorUserId: userId, now: deps.now() }));
  return await read(deps, gymId, viewer);
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
