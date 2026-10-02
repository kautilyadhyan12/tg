// Check-in at the front desk (spec Part 3 §12; ROADMAP 16a). The member's pass, the
// gym's desk devices, and the scan that reads a pass or a key tag.
import { z } from "zod";
import { gymClockFormatSchema } from "./orgs.js";

/** A pass is "AHGP" and 58 letters and digits (base32 of 36 bytes): the uppercase
 *  letters and digits a QR code packs most tightly and every USB scanner types the
 *  same on any keyboard layout. */
export const CHECKIN_PASS_PREFIX = "AHGP";
export const CHECKIN_PASS_LENGTH = 62;
/** A pass belongs to one 30-second window; the scan takes it in that window and the next. */
export const CHECKIN_PASS_WINDOW_SECONDS = 30;

export const checkinPassResponseSchema = z
  .object({
    pass: z.string().length(CHECKIN_PASS_LENGTH),
    /** When the app should ask for the next one: the end of this pass's window. */
    refreshAt: z.string().datetime(),
  })
  .strict();
export type CheckinPassResponse = z.infer<typeof checkinPassResponseSchema>;

/** What the desk read: a pass, or a gym's own key tag (its member number). A USB
 *  scanner types it and presses Enter, so it is trimmed and nothing more. */
export const CHECKIN_READ_MAX = 64;
export const checkinScanRequestSchema = z
  .object({ code: z.string().trim().min(1).max(CHECKIN_READ_MAX) })
  .strict();
export type CheckinScanRequest = z.infer<typeof checkinScanRequestSchema>;

/** The gym's own words on the person's record, shown beside a green tick and never
 *  blocking it; `onList` false is an app member the gym's list no longer holds. */
export const checkinNoticeSchema = z
  .object({
    status: z.string().nullable(),
    payment: z.string().nullable(),
    onList: z.boolean(),
  })
  .strict();
export type CheckinNotice = z.infer<typeof checkinNoticeSchema>;

const checkinPersonSchema = z.object({ name: z.string() }).strict();

export const checkinScanResponseSchema = z.discriminatedUnion("result", [
  z
    .object({
      result: z.literal("checked_in"),
      gymName: z.string(),
      person: checkinPersonSchema,
      notice: checkinNoticeSchema,
    })
    .strict(),
  z
    .object({
      result: z.literal("already"),
      gymName: z.string(),
      person: checkinPersonSchema,
      notice: checkinNoticeSchema,
      firstAt: z.string().datetime(),
      timezone: z.string(),
      clockFormat: gymClockFormatSchema,
    })
    .strict(),
  z.object({ result: z.literal("fresh_pass_needed"), gymName: z.string() }).strict(),
  z.object({ result: z.literal("not_a_member"), gymName: z.string() }).strict(),
  /** A member number two of the gym's records share: staff choose who it is. */
  z.object({ result: z.literal("see_staff"), gymName: z.string() }).strict(),
]);
export type CheckinScanResponse = z.infer<typeof checkinScanResponseSchema>;

// ── DESK DEVICES (Settings → Check-in devices, `org.manage`) ──

export const CHECKIN_DEVICE_NAME_MAX = 60;
/** How many devices one gym may have, switched off ones included. */
export const CHECKIN_DEVICES_MAX = 20;
/** How long a device's one-time link works. */
export const CHECKIN_LINK_TTL_MINUTES = 60;
/** A key tag is a short number anyone can type, so a device reads at most 20 a minute,
 *  and after 10 numbers nobody has within 10 minutes it takes none for 10 minutes
 *  (RULINGS 2026-10-02). A pass cannot be guessed and is not held to either. */
export const CHECKIN_KEY_TAGS_PER_MINUTE = 20;
export const CHECKIN_KEY_TAG_MISSES = 10;
export const CHECKIN_KEY_TAG_PAUSE_MINUTES = 10;

export const checkinDeviceIdParamsSchema = z
  .object({ gymId: z.string().uuid(), deviceId: z.string().uuid() })
  .strict();

export const addCheckinDeviceRequestSchema = z
  .object({ name: z.string().trim().min(1).max(CHECKIN_DEVICE_NAME_MAX) })
  .strict();
export type AddCheckinDeviceRequest = z.infer<typeof addCheckinDeviceRequestSchema>;

/** `waiting`: its link has not been opened yet · `on`: it can check people in ·
 *  `off`: switched off, or its link ran out before anybody opened it. */
export const checkinDeviceStateSchema = z.enum(["waiting", "on", "off"]);

export const checkinDeviceSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    state: checkinDeviceStateSchema,
    linkExpiresAt: z.string().datetime().nullable(),
    lastSeenAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    /** Until when the device takes no key tags, after too many numbers nobody has. */
    keyTagsPausedUntil: z.string().datetime().nullable(),
  })
  .strict();
export type CheckinDevice = z.infer<typeof checkinDeviceSchema>;

export const checkinDevicesResponseSchema = z
  .object({ devices: z.array(checkinDeviceSchema).max(CHECKIN_DEVICES_MAX) })
  .strict();
export type CheckinDevicesResponse = z.infer<typeof checkinDevicesResponseSchema>;

/** The device and its one-time link, shown once to the member of staff who made it. */
export const checkinDeviceLinkResponseSchema = z
  .object({ device: checkinDeviceSchema, link: z.string().url() })
  .strict();
export type CheckinDeviceLinkResponse = z.infer<typeof checkinDeviceLinkResponseSchema>;

export const checkinDeviceResponseSchema = z.object({ device: checkinDeviceSchema }).strict();
export type CheckinDeviceResponse = z.infer<typeof checkinDeviceResponseSchema>;

/** The tablet opening its link: the token from the link's `#` part. */
export const claimCheckinDeviceRequestSchema = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export type ClaimCheckinDeviceRequest = z.infer<typeof claimCheckinDeviceRequestSchema>;

export const claimCheckinDeviceResponseSchema = z
  .object({ gymName: z.string(), deviceName: z.string() })
  .strict();
export type ClaimCheckinDeviceResponse = z.infer<typeof claimCheckinDeviceResponseSchema>;

/** What the desk and the console are told when check-in says no. */
export const CHECKIN_WORDS = {
  device_not_recognised: "This device isn't set up to check people in. Ask the gym's owner for a new link in Settings → Check-in devices.",
  link_not_valid: "This link has already been used or has run out. Ask for a new one in Settings → Check-in devices.",
  passes_off: "Passes aren't working right now. Staff can check you in.",
  checkin_unavailable: "Check-in isn't working right now. Please try again in a moment.",
  too_many_devices: `A gym can have up to ${String(CHECKIN_DEVICES_MAX)} check-in devices.`,
  device_not_found: "That check-in device isn't here any more.",
  key_tags_slow: "Too many cards at once. Please wait a moment and scan again.",
  key_tags_paused: "Cards aren't being taken at this desk for a few minutes. Show your pass in the app, or ask staff to check you in.",
} as const;
