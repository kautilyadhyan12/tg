// REFER A FRIEND — spec Part 3 §16.3; ROADMAP 20e-ii-a.
//
// The worst thing this could do to a real person: mark a lead, or promise a gift, as one
// member's when it is not theirs — another business's member, somebody who has left, or a
// code that was made up — or show a member's name to whoever opens their link. So an
// invite is found by its random code alone and answers only its own business; it works
// only while its member is one and the offer is on, and the enquiry's own transaction asks
// both again before a lead is marked. The invite page names the business, never the member.
//
// The owner sets the offer (`org.manage`); a member reads their own link and the offer
// while they are a member; anybody with a link reads the invite page.
import { randomBytes } from "node:crypto";
import {
  memberCurrencyForCountry,
  minorToPriceText,
  orgTypeSchema,
  REFERRAL_WORDS,
  referralGiftLive,
  referralGiftProblem,
  referralGiftWords,
  referralOfferLines,
  referralPath,
  type MemberReferralResponse,
  type PublicInvite,
  type ReferralGiftInput,
  type ReferralGiftOn,
  type ReferralGiftTerms,
  type ReferralGiftView,
  type ReferralSettings,
  type SetReferralSettingsRequest,
} from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { dayInTz } from "../../gamification/streak.js";
import { gymHasLivePlan, insertAudit, lockOrgRow } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { memberGate } from "../messages/repo.js";
import {
  archiveDiscountInTx,
  codeOrNameTaken,
  createDiscountInTx,
  referralDiscounts,
  updateDiscountInTx,
  type DiscountInput,
  type DiscountRow,
} from "../register/discountsRepo.js";
import * as repo from "./repo.js";

export interface ReferralDeps {
  sql: Sql;
  now: () => Date;
}

type Limit = () => Promise<boolean>;

const notFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");
const inviteNotFound = (): OrgsError => new OrgsError(404, "invite_not_found", REFERRAL_WORDS.not_found);

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
/** 16 letters and digits of `a-z2-7` from 80 random bits. */
export function freshCode(): string {
  const bytes = randomBytes(10);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31] ?? "";
      bits -= 5;
    }
  }
  return out;
}

const terms = (d: DiscountRow): ReferralGiftTerms => ({ ...d, archived: d.archivedAt !== null });

/** A picked gift's words, while its code can be used today; null otherwise. */
function liveGift(discounts: readonly DiscountRow[], id: string | null, today: string): { code: string; words: string } | null {
  if (id === null) return null;
  const d = discounts.find((x) => x.id === id);
  if (d === undefined || !referralGiftLive(terms(d), today) || d.code === null) return null;
  return { code: d.code, words: referralGiftWords(terms(d)) };
}

/** What a gift's discount comes off, in the box's three choices. */
const giftOn = (d: DiscountRow): ReferralGiftOn => (d.forProducts && !d.forMemberships ? "products" : (d.membershipPayments ?? "every"));

function giftView(discounts: readonly DiscountRow[], id: string | null, today: string): ReferralGiftView | null {
  const d = id === null ? undefined : discounts.find((x) => x.id === id);
  if (d === undefined) return null;
  return {
    kind: d.kind,
    percentBp: d.percentBp,
    amountMinor: d.amountMinor,
    currency: d.currency,
    on: giftOn(d),
    code: d.code,
    words: referralGiftWords(terms(d)),
    problem: referralGiftProblem(terms(d), today),
    archived: d.archivedAt !== null,
  };
}

async function settingsView(sql: Sql, org: { id: string; name: string; country: string | null }, today: string): Promise<ReferralSettings> {
  const now = await repo.settingsFor(sql, org.id);
  const picked = [now.memberDiscountId, now.friendDiscountId].filter((id): id is string => id !== null);
  const discounts = await referralDiscounts(sql, org.id, picked);
  const member = liveGift(discounts, now.memberDiscountId, today);
  const friend = liveGift(discounts, now.friendDiscountId, today);
  return {
    on: now.on,
    member: giftView(discounts, now.memberDiscountId, today),
    friend: giftView(discounts, now.friendDiscountId, today),
    currency: memberCurrencyForCountry(org.country),
    memberLines: referralOfferLines(org.name, member?.words ?? null, friend?.words ?? null),
  };
}

export async function getReferralSettings(deps: ReferralDeps, userId: string, gymId: string, limit: Limit): Promise<ReferralSettings | null> {
  const { org } = await requirePrivilege(deps, gymId, userId, "org.manage");
  if (!(await limit())) return null;
  return await settingsView(deps.sql, org, dayInTz(deps.now(), org.timezone));
}

type Side = "member" | "friend";
const CODE_START: Record<Side, string> = { member: "THANKS", friend: "WELCOME" };
/** A code that is taken gets the next of these on its end: THANKS10, THANKS10B… */
const CODE_ENDS = ["", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"];
const giftName = (side: Side, code: string): string => `Refer a friend: ${side === "member" ? "member's" : "friend's"} gift, ${code}`;

/** The discount a gift is kept as: for every membership type or every product, with no
 *  dates and no limit, as the box says. */
function giftDiscount(gift: ReferralGiftInput): DiscountInput {
  return {
    name: "",
    code: null,
    kind: gift.kind,
    percentBp: gift.kind === "percent" ? gift.percentBp : null,
    amountMinor: gift.kind === "amount" ? gift.amountMinor : null,
    startsOn: null,
    endsOn: null,
    maxUses: null,
    forProducts: gift.on === "products",
    allProducts: true,
    productIds: [],
    forMemberships: gift.on !== "products",
    allMembershipTypes: true,
    membershipTypeIds: [],
    membershipPayments: gift.on === "products" ? null : gift.on,
  };
}

/** The discount already gives exactly this gift. */
function sameGift(d: DiscountRow, want: DiscountInput, currency: string | null): boolean {
  return (
    d.kind === want.kind &&
    d.percentBp === want.percentBp &&
    d.amountMinor === want.amountMinor &&
    (want.kind === "percent" || d.currency === currency) &&
    d.forProducts === want.forProducts &&
    d.allProducts &&
    d.forMemberships === want.forMemberships &&
    d.allMembershipTypes &&
    d.membershipPayments === want.membershipPayments &&
    d.startsOn === null &&
    d.endsOn === null &&
    d.maxUses === null &&
    d.code !== null
  );
}

/** "THANKS10" for 10%, "WELCOME500" for ₹500: the first of it, then B, C… that no other
 *  discount of this gym in use has as its code or its name. */
async function freeCode(tx: TransactionSql, gymId: string, side: Side, gift: ReferralGiftInput, currency: string | null, exceptId: string | null): Promise<string> {
  const amount = gift.kind === "percent" ? Math.trunc((gift.percentBp ?? 0) / 100) : Number.parseInt(minorToPriceText(gift.amountMinor ?? 0, currency ?? "USD"), 10);
  const base = `${CODE_START[side]}${String(Number.isFinite(amount) && amount > 0 ? amount : "")}`.slice(0, 16);
  for (const end of CODE_ENDS) {
    const code = `${base}${end}`;
    if (!(await codeOrNameTaken(tx, gymId, code, giftName(side, code), exceptId))) return code;
  }
  throw new OrgsError(409, "too_many", REFERRAL_WORDS.too_many);
}

/** What one discount write answered, as the owner reads it. */
function refused(outcome: { kind: string }): OrgsError {
  if (outcome.kind === "no_currency") return new OrgsError(409, "no_currency", REFERRAL_WORDS.no_currency);
  if (outcome.kind === "too_many") return new OrgsError(409, "too_many", REFERRAL_WORDS.too_many);
  return new OrgsError(409, outcome.kind, "We couldn't save that. Please try again.");
}

/** One gift, kept as its own discount. The same gift keeps its discount and code. A changed
 *  gift changes its discount, and its code, where nobody has used it yet; once somebody has,
 *  that discount is left exactly as it was given and the new gift gets a discount of its
 *  own. "No gift" archives a discount nobody has used. */
async function placeGift(
  tx: TransactionSql,
  ctx: { gymId: string; userId: string; at: Date; currency: string | null },
  side: Side,
  gift: ReferralGiftInput | null,
  current: DiscountRow | undefined,
): Promise<string | null> {
  const live = current !== undefined && current.archivedAt === null ? current : undefined;
  if (gift === null) {
    if (live !== undefined && live.uses === 0) await archiveDiscountInTx(tx, { gymId: ctx.gymId, discountId: live.id, actorUserId: ctx.userId, now: ctx.at });
    return null;
  }
  if (gift.kind === "amount" && ctx.currency === null) throw new OrgsError(409, "no_currency", REFERRAL_WORDS.no_currency);
  const want = giftDiscount(gift);
  if (live !== undefined && sameGift(live, want, ctx.currency)) return live.id;
  if (live !== undefined && live.uses === 0) {
    const code = await freeCode(tx, ctx.gymId, side, gift, ctx.currency, live.id);
    const done = await updateDiscountInTx(tx, { ...want, name: giftName(side, code), code, gymId: ctx.gymId, discountId: live.id, readAt: null, actorUserId: ctx.userId, now: ctx.at });
    if (done.kind !== "ok") throw refused(done);
    return live.id;
  }
  const code = await freeCode(tx, ctx.gymId, side, gift, ctx.currency, null);
  const made = await createDiscountInTx(tx, { ...want, name: giftName(side, code), code, gymId: ctx.gymId, actorUserId: ctx.userId });
  if (made.kind !== "created") throw refused(made);
  return made.id;
}

/** Saved twice it is saved once: the same gifts keep their codes. Switched on needs a gift.
 *  The offer and its codes are written in one transaction under the gym's row lock, so two
 *  saves at once make one code each, never two. */
export async function setReferralSettings(
  deps: ReferralDeps,
  userId: string,
  gymId: string,
  body: SetReferralSettingsRequest,
  limit: Limit,
): Promise<ReferralSettings | null> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "org.manage");
  if (!(await limit())) return null;
  const at = deps.now();
  if (body.on && body.member === null && body.friend === null) throw new OrgsError(400, "no_gift", REFERRAL_WORDS.no_gift);
  await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const before = await repo.settingsFor(tx, gymId);
    const ids = [before.memberDiscountId, before.friendDiscountId].filter((id): id is string => id !== null);
    const discounts = await referralDiscounts(tx, gymId, ids);
    const ctx = { gymId, userId, at, currency: memberCurrencyForCountry(org.country) };
    const memberDiscountId = await placeGift(tx, ctx, "member", body.member, discounts.find((d) => d.id === before.memberDiscountId));
    const friendDiscountId = await placeGift(tx, ctx, "friend", body.friend, discounts.find((d) => d.id === before.friendDiscountId));
    await repo.writeSettings(tx, gymId, { on: body.on, memberDiscountId, friendDiscountId }, userId, at);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.referrals_changed",
      targetType: "gym",
      targetId: gymId,
      meta: { on: String(body.on), memberGift: String(body.member !== null), friendGift: String(body.friend !== null) },
    });
  });
  return await settingsView(deps.sql, org, dayInTz(at, org.timezone));
}

/** The member's own link and the offer, while they are a member. A business that is closed
 *  or on no plan, or has the offer off, answers off; anybody else is not found. */
export async function getMemberReferral(deps: ReferralDeps, userId: string, gymId: string, limit: Limit): Promise<MemberReferralResponse | null> {
  const gate = await memberGate(deps.sql, gymId, userId);
  if (gate === null || !gate.member) throw notFound();
  if (!(await limit())) return null;
  const settings = await repo.settingsFor(deps.sql, gymId);
  if (!settings.on || !gate.open || !gate.live) return { status: "off", gymName: gate.name };
  const tz = await timezoneOf(deps.sql, gymId);
  const today = dayInTz(deps.now(), tz);
  const picked = [settings.memberDiscountId, settings.friendDiscountId].filter((id): id is string => id !== null);
  const discounts = await referralDiscounts(deps.sql, gymId, picked);
  const member = liveGift(discounts, settings.memberDiscountId, today);
  const friend = liveGift(discounts, settings.friendDiscountId, today);
  const code = await repo.linkCode(deps.sql, gymId, userId, freshCode);
  return {
    status: "on",
    gymName: gate.name,
    path: referralPath(code),
    memberGift: member?.words ?? null,
    friendGift: friend?.words ?? null,
    lines: referralOfferLines(gate.name, member?.words ?? null, friend?.words ?? null),
  };
}

async function timezoneOf(sql: Sql, gymId: string): Promise<string> {
  const rows = await sql<{ timezone: string }[]>`SELECT timezone FROM gyms WHERE id = ${gymId}`;
  const row = rows[0];
  if (row === undefined) throw notFound();
  return row.timezone;
}

/** The invite a code is, for a business on a trial or a paid plan; null for anything
 *  else, which every caller answers with the same 404. */
export async function liveInvite(sql: Sql, code: string): Promise<repo.InviteRow | null> {
  const invite = await repo.liveInvite(sql, code);
  if (invite === null || !(await gymHasLivePlan(sql, invite.gymId))) return null;
  return invite;
}

/** What anybody with the link sees: the business, its gift to the friend, and its own page
 *  where it has one. Nothing about the member who sent it. */
export async function publicInvite(deps: ReferralDeps & { robotCheckKey: string }, code: string): Promise<PublicInvite> {
  const invite = await liveInvite(deps.sql, code);
  if (invite === null) throw inviteNotFound();
  const settings = await repo.settingsFor(deps.sql, invite.gymId);
  const today = dayInTz(deps.now(), invite.timezone);
  const discounts = await referralDiscounts(deps.sql, invite.gymId, settings.friendDiscountId === null ? [] : [settings.friendDiscountId]);
  return {
    gymName: invite.name,
    city: invite.city,
    orgType: orgTypeSchema.parse(invite.orgType),
    friendGift: liveGift(discounts, settings.friendDiscountId, today),
    pageSlug: invite.pageShown ? invite.slug : null,
    robotCheckKey: deps.robotCheckKey,
  };
}
