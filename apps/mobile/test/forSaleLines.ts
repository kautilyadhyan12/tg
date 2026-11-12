import { forSaleLineSchema, forSaleWorked, type ForSaleLine, type ForSaleType } from "@app/shared";

// Lines a gym sells in the app, as the server words them: made by the server's own `forSaleWorked` (Buy in the app, 20g),
// so a test reads what the server would send, never a hand-made copy of its words.

export const PACK_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
export const DAY_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
export const SUMMER_ID = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
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
export const SUMMER_TYPE = type({ id: SUMMER_ID, name: "Summer month", kind: "one_time", priceMinor: 12000, termCount: 1, termUnit: "month", joiningFeeMinor: 2500 });

/** A line as the phone reads it, with the key of its details and, where `agreement`, the gym's agreement to sign. */
export function lineOf(t: ForSaleType, options: { agreement?: boolean; factsKey?: string; personName?: string; friendGift?: boolean } = {}): ForSaleLine {
  const worked = forSaleWorked({
    type: t,
    taxes: [],
    taxIncluded: false,
    billDay: null,
    today: TODAY,
    gym: GYM,
    personName: options.personName ?? "Asha Walk",
    friendGift:
      options.friendGift === true ? { id: "e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8091", name: "Refer a friend", kind: "amount", percentBp: null, amountMinor: 1000, membershipPayments: null } : null,
  });
  if (worked === null) throw new Error(`${t.name} is not sold in the app`);
  return forSaleLineSchema.parse({
    ...worked.item,
    factsKey: options.factsKey ?? "a".repeat(64),
    agreement:
      options.agreement === false
        ? null
        : { id: AGREEMENT_ID, name: null, version: 1, text: "1. Classes in this pack must be used by the date shown.\n2. Packs are personal and can't be shared." },
  });
}
