import { forSaleLineSchema, forSaleWorked, repeatingChargeWords, type ForSaleIncluded, type ForSaleLine, type ForSalePromo, type ForSaleType, type HeldTax } from "@app/shared";

// Lines a gym sells in the app, as the server words them: made by the server's own `forSaleWorked` (Buy in the app, 20g),
// so a test reads what the server would send, never a hand-made copy of its words.

export const PACK_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
export const DAY_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
export const SUMMER_ID = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
export const GOLD_ID = "f6a7b8c9-d0e1-4f2a-8b3c-5d6e7f809102";
export const AGREEMENT_ID = "d4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80";
export const TODAY = "2026-11-12";

const GYM = { name: "Iron House", postalAddress: "410 Congress Ave, Austin, TX 78701", contactPhone: "(512) 555-0140", contactEmail: "hello@ironhouse.example" };

const type = (over: Partial<ForSaleType> & Pick<ForSaleType, "id" | "name" | "kind" | "priceMinor">): ForSaleType => ({
  description: null,
  currency: "USD",
  termCount: null,
  termUnit: null,
  packClasses: null,
  packDays: null,
  joiningFeeMinor: 0,
  contractPeriods: null,
  contractThen: null,
  noticeDays: null,
  leaveFeeMinor: null,
  coolingOffDays: null,
  ...over,
});

export const PACK_TYPE = type({ id: PACK_ID, name: "10-class pack", kind: "pack", priceMinor: 9000, packClasses: 10, packDays: 60, description: "Any class on the timetable.", coolingOffDays: 3 });
export const DAY_TYPE = type({ id: DAY_ID, name: "Day pass", kind: "pack", priceMinor: 1500, packClasses: 1, packDays: 1 });
/** A repeating membership (20i-i): paid with the card saved in the app. */
export const GOLD_TYPE = type({ id: GOLD_ID, name: "Gold Monthly", kind: "recurring", priceMinor: 4999, termCount: 1, termUnit: "month" });
export const SUMMER_TYPE = type({ id: SUMMER_ID, name: "Summer month", kind: "one_time", priceMinor: 12000, termCount: 1, termUnit: "month", joiningFeeMinor: 2500 });

/** A promo code of the gym's, 20% off, as the server finds it fits a line (18k-v): typed in the app as SPRING20. */
export const SPRING20: ForSalePromo = { id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", name: "Spring offer", kind: "percent", percentBp: 2000, amountMinor: null, membershipPayments: "first", code: "SPRING20" };

/** Every class, no personal training: a pack reads "Any class". */
export const ANY_CLASS: ForSaleIncluded = { access: "all_classes", bookingsLimit: null, bookingsPeriod: null, classNames: null, includesPt: false, ptLimit: null, ptPeriod: null };

/** A line as the phone reads it, with the key of its details and, where `agreement`, the gym's agreement to sign. */

export function lineOf(
  t: ForSaleType,
  options: {
    agreement?: boolean;
    factsKey?: string;
    personName?: string;
    friendGift?: boolean;
    included?: ForSaleIncluded;
    taxes?: HeldTax[];
    /** A repeating line's card: its tick in the server's own words (`repeatingChargeWords`). */
    card?: { brand: string; last4: string };
    /** A promo code typed, where it fits this line (20j). */
    promo?: ForSalePromo;
    /** Why the code typed takes nothing off this line, where it takes something off another. */
    promoWords?: string;
    /** The day of the month the gym bills everyone on (18y): a membership started today pays part of a month first. */
    billDay?: number;
  } = {},
): ForSaleLine {
  const worked = forSaleWorked({
    type: t,
    included: { lines: options.included ?? ANY_CLASS, orgType: "gym" },
    taxes: options.taxes ?? [],
    taxIncluded: false,
    billDay: options.billDay ?? null,
    today: TODAY,
    gym: GYM,
    personName: options.personName ?? "Asha Walk",
    friendGift:
      options.friendGift === true ? { id: "e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8091", name: "Refer a friend", kind: "amount", percentBp: null, amountMinor: 1000, membershipPayments: null } : null,
    promo: options.promo ?? null,
  });
  if (worked === null) throw new Error(`${t.name} is not sold in the app`);
  return forSaleLineSchema.parse({
    ...worked.item,
    factsKey: options.factsKey ?? "a".repeat(64),
    charge: worked.item.repeats && options.card !== undefined ? repeatingChargeWords(GYM.name, options.card, worked.item) : null,
    promoWords: options.promoWords ?? null,
    agreement:
      options.agreement === false
        ? null
        : { id: AGREEMENT_ID, name: null, version: 1, text: "1. Classes in this pack must be used by the date shown.\n2. Packs are personal and can't be shared." },
  });
}
