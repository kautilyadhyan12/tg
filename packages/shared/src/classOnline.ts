// ONLINE CLASSES, AND STAFF TAKING ONE PERSON OFF A CLASS — Part 3 §13.3, §13.4; ROADMAP
// Stage 2 item 17g.
//
// The rule that says who is sent an online class's link and when, and the rule for a
// place staff take away. Pure: the instants and what was read are passed in.
import { z } from "zod";
import type { ClassBookingStatus } from "./classBookings.js";

/** The link shows this long before the class starts, until it ends. */
export const CLASS_ONLINE_LINK_BEFORE_MINUTES = 30;
export const CLASS_ONLINE_LINK_MAX = 500;

const MINUTE_MS = 60_000;

function webAddress(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** The gym's own video link: an `https://` address of a named site, with no sign-in
 *  written into it, no spaces and no character that cannot be seen. "Https://", as a
 *  phone's keyboard writes it, is taken and kept as "https://". */
export const classOnlineLinkSchema = z
  .string()
  .trim()
  .min(1)
  .max(CLASS_ONLINE_LINK_MAX)
  .transform((value) => value.replace(/^https:\/\//i, "https://"))
  .refine(
    (value) => {
      if (!value.startsWith("https://") || /[\s\u200b-\u200d\ufeff]/.test(value)) return false;
      const url = webAddress(value);
      return (
        url !== null &&
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        /[a-z0-9]\.[a-z0-9]/i.test(url.hostname)
      );
    },
    { message: "not an https link" },
  );

/** Who a change to a time slot's or a class's online answer reaches: the classes it
 *  changes, and the bookings that hold a place on them (in one class, people). */
export const classOnlineAffectedSchema = z.object({ classes: z.number().int().min(0), booked: z.number().int().min(0) }).strict();
export type ClassOnlineAffected = z.infer<typeof classOnlineAffectedSchema>;

/** A time slot's or one class's online answer, both keys every time: `online` false
 *  carries no link, and `online` true with no link is "the link is added later". */
export const setClassOnlineRequestSchema = z
  .object({ online: z.boolean(), onlineLink: classOnlineLinkSchema.nullable() })
  .strict()
  .refine((r) => r.online || r.onlineLink === null, { message: "a link goes only with `online: true`", path: ["onlineLink"] });
export type SetClassOnlineRequest = z.infer<typeof setClassOnlineRequestSchema>;

export const CLASS_ONLINE_STATES = ["not_booked", "waiting", "early", "open", "no_link", "closed"] as const;
export type ClassOnlineState = (typeof CLASS_ONLINE_STATES)[number];

/** An online class as one person meets it. `link` is there in `open` and in no other state. */
export const classOnlineViewSchema = z
  .object({
    state: z.enum(CLASS_ONLINE_STATES),
    /** When the link shows to somebody booked. */
    opensAt: z.string().datetime(),
    link: z.string().nullable(),
  })
  .strict()
  .refine((v) => (v.state === "open") === (v.link !== null), { message: "a link goes only with `open`" });
export type ClassOnlineView = z.infer<typeof classOnlineViewSchema>;

/** Who is sent an online class's link: somebody who holds a place in it (booked, or
 *  marked came or no-show), from 30 minutes before it starts until it ends, in a class
 *  that runs. Nobody waiting, nobody who cancelled or was taken off, nobody with no
 *  booking. Null: the class is not online. */
export function classOnlineView(i: {
  online: boolean;
  link: string | null;
  /** The person's newest booking of the class; null where they have none. */
  status: ClassBookingStatus | null;
  cancelled: boolean;
  nowMs: number;
  startsAtMs: number;
  minutes: number;
}): { state: ClassOnlineState; opensAtMs: number; link: string | null } | null {
  if (!i.online) return null;
  const opensAtMs = i.startsAtMs - CLASS_ONLINE_LINK_BEFORE_MINUTES * MINUTE_MS;
  const at = (state: Exclude<ClassOnlineState, "open">) => ({ state, opensAtMs, link: null });
  if (i.cancelled || i.nowMs >= i.startsAtMs + i.minutes * MINUTE_MS) return at("closed");
  if (i.status === "waitlisted") return at("waiting");
  if (i.status !== "booked" && i.status !== "attended" && i.status !== "no_show") return at("not_booked");
  if (i.nowMs < opensAtMs) return at("early");
  if (i.link === null) return at("no_link");
  return { state: "open", opensAtMs, link: i.link };
}

/** What a member reads on an online class, by state. */
export const CLASS_ONLINE_WORDS: Record<ClassOnlineState, string> = {
  not_booked: "Online class. Book it to get the link.",
  waiting: "Online class. You get the link once you have a place.",
  early: `Online class. The link shows here ${String(CLASS_ONLINE_LINK_BEFORE_MINUTES)} minutes before it starts.`,
  open: "Online class. Your link is ready.",
  no_link: "Online class. Your gym hasn't added the link yet. Ask the front desk.",
  closed: "Online class.",
};

export type StaffRemoveDecision =
  | { kind: "remove"; refundPack: boolean; freesPlace: boolean }
  /** Nothing to do: the place is already given up. */
  | { kind: "already" }
  | { kind: "refuse"; reason: "class_started" | "class_cancelled" };

/** Staff take one person off a class before it starts: a place held, or a place in the
 *  waitlist. It is never a late cancel, so a pack always has its class back. A place a
 *  check-in marked came before the start is still the booked place it was. */
export function decideStaffRemove(i: { status: ClassBookingStatus; cancelled: boolean; started: boolean; packCharged: boolean }): StaffRemoveDecision {
  if (i.status === "cancelled" || i.status === "late_cancelled") return { kind: "already" };
  if (i.cancelled) return { kind: "refuse", reason: "class_cancelled" };
  if (i.started) return { kind: "refuse", reason: "class_started" };
  if (i.status === "waitlisted") return { kind: "remove", refundPack: false, freesPlace: false };
  return { kind: "remove", refundPack: i.packCharged, freesPlace: true };
}

export const CLASS_REMOVE_WORDS = {
  class_started: "This class has already started. Mark them Came or No-show instead.",
  class_cancelled: "This class has been cancelled, so nobody is booked on it.",
  booking_not_found: "That booking was not found in this class.",
} as const;
