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
  discountStatus,
  orgTypeSchema,
  REFERRAL_WORDS,
  referralGiftLive,
  referralGiftProblem,
  referralGiftWords,
  referralOfferLines,
  referralPath,
  type MemberReferralResponse,
  type PublicInvite,
  type ReferralGiftTerms,
  type ReferralSettings,
  type SetReferralSettingsRequest,
} from "@app/shared";
import type { Sql } from "postgres";
import { dayInTz } from "../../gamification/streak.js";
import { gymHasLivePlan, insertAudit, lockOrgRow } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { memberGate } from "../messages/repo.js";
import { referralDiscounts, type DiscountRow } from "../register/discountsRepo.js";
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

async function settingsView(sql: Sql, gymId: string, gymName: string, today: string): Promise<ReferralSettings> {
  const now = await repo.settingsFor(sql, gymId);
  const picked = [now.memberDiscountId, now.friendDiscountId].filter((id): id is string => id !== null);
  const discounts = await referralDiscounts(sql, gymId, picked);
  const member = liveGift(discounts, now.memberDiscountId, today);
  const friend = liveGift(discounts, now.friendDiscountId, today);
  return {
    on: now.on,
    memberDiscountId: now.memberDiscountId,
    friendDiscountId: now.friendDiscountId,
    discounts: discounts.map((d) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      words: referralGiftWords(terms(d)),
      problem: referralGiftProblem(terms(d), today),
    })),
    memberLines: referralOfferLines(gymName, member?.words ?? null, friend?.words ?? null),
  };
}

export async function getReferralSettings(deps: ReferralDeps, userId: string, gymId: string, limit: Limit): Promise<ReferralSettings | null> {
  const { org } = await requirePrivilege(deps, gymId, userId, "org.manage");
  if (!(await limit())) return null;
  return await settingsView(deps.sql, gymId, org.name, dayInTz(deps.now(), org.timezone));
}

/** Saved twice it is saved once. Each code picked is one of this business's own
 *  discounts; switched on, each has a promo code and is in use or starts later (it is
 *  promised from the day it starts). Switched off, any picked one is kept as it is. */
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
  const today = dayInTz(at, org.timezone);
  if (body.on && body.memberDiscountId === null && body.friendDiscountId === null) throw new OrgsError(400, "no_gift", REFERRAL_WORDS.no_gift);
  await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const ids = [body.memberDiscountId, body.friendDiscountId].filter((id): id is string => id !== null);
    const discounts = await referralDiscounts(tx, gymId, ids);
    for (const id of ids) {
      const d = discounts.find((x) => x.id === id);
      if (d === undefined) throw new OrgsError(404, "discount_not_found", REFERRAL_WORDS.discount_not_found);
      if (!body.on) continue;
      if (d.code === null) throw new OrgsError(409, "no_code", REFERRAL_WORDS.no_code);
      const status = discountStatus(terms(d), today);
      if (status !== "active" && status !== "scheduled") throw new OrgsError(409, "not_live", REFERRAL_WORDS.not_live);
    }
    await repo.writeSettings(tx, gymId, { on: body.on, memberDiscountId: body.memberDiscountId, friendDiscountId: body.friendDiscountId }, userId, at);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.referrals_changed",
      targetType: "gym",
      targetId: gymId,
      meta: { on: String(body.on), memberGift: String(body.memberDiscountId !== null), friendGift: String(body.friendDiscountId !== null) },
    });
  });
  return await settingsView(deps.sql, gymId, org.name, today);
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
