// A GYM'S OWN PAGE AND ITS ENQUIRY FORM — spec Part 3 §16.3; ROADMAP 20c-iv-a;
// RULINGS 2026-09-28.
//
// A page of ours, at `/gyms/{slug}`, that a gym links to from Instagram, WhatsApp or
// its own website (and may show inside its website with the code it copies). It shows
// the gym's name, town, opening hours, its own "About us" and the facilities it ticked,
// and a form. A person who sends the form becomes one of the gym's leads, or, when a
// lead already has their email or phone, a message on that lead. Off until the gym
// switches it on. Up to ten photos of the gym (20c-iv-b).
import { z } from "zod";
import { leadSourceSchema, type LeadSource } from "./leads.js";
import {
  MEMBER_LIST_MAX_EMAIL_CHARS,
  MEMBER_LIST_MAX_NAME_CHARS,
  MEMBER_LIST_MAX_TYPED_PHONE_CHARS,
} from "./memberList.js";
import { gymHoursSchema, orgTypeSchema } from "./orgs.js";

/** The facilities a gym may tick, in the order the page lists them. The amenity
 *  lists of gym directories (ClassPass, Google's business profile) name the same. */
export const GYM_FACILITIES = [
  "free_weights",
  "weight_machines",
  "cardio",
  "functional_area",
  "group_classes",
  "personal_training",
  "studio",
  "pool",
  "sauna",
  "changing_rooms",
  "showers",
  "lockers",
  "towels",
  "drinking_water",
  "air_conditioning",
  "wifi",
  "parking",
  "women_only_area",
  "wheelchair_access",
  "childcare",
  "cafe",
] as const;
export const gymFacilitySchema = z.enum(GYM_FACILITIES);
export type GymFacility = z.infer<typeof gymFacilitySchema>;

/** A facility as a gym typed it: spaces tidied, and the list's own facility when the
 *  words are one of the list's ("showers" is Showers), so nothing is on the page twice. */
export function typedFacility(text: string): { kind: "listed"; facility: GymFacility } | { kind: "own"; name: string } | null {
  const name = text.replace(/\s+/g, " ").trim();
  if (name === "") return null;
  const listed = GYM_FACILITIES.find((facility) => GYM_FACILITY_WORDS[facility].toLowerCase() === name.toLowerCase());
  return listed === undefined ? { kind: "own", name } : { kind: "listed", facility: listed };
}

export const GYM_FACILITY_WORDS: Record<GymFacility, string> = {
  free_weights: "Free weights",
  weight_machines: "Weight machines",
  cardio: "Cardio machines",
  functional_area: "Functional training area",
  group_classes: "Group classes",
  personal_training: "Personal training",
  studio: "Studio for yoga or pilates",
  pool: "Swimming pool",
  sauna: "Sauna or steam room",
  changing_rooms: "Changing rooms",
  showers: "Showers",
  lockers: "Lockers",
  towels: "Towels",
  drinking_water: "Drinking water",
  air_conditioning: "Air conditioning",
  wifi: "Wi-Fi",
  parking: "Parking",
  women_only_area: "Women-only area",
  wheelchair_access: "Wheelchair access",
  childcare: "Childcare",
  cafe: "Café or juice bar",
};

export const GYM_PAGE_MAX_ABOUT_CHARS = 1000;
/** Facilities a gym adds of its own, beside the list's, and how long each may be. */
export const GYM_PAGE_MAX_OWN_FACILITIES = 10;
export const GYM_PAGE_MAX_OWN_FACILITY_CHARS = 40;
const ownFacilitySchema = z.string().trim().min(1).max(GYM_PAGE_MAX_OWN_FACILITY_CHARS);
export const GYM_ENQUIRY_MAX_MESSAGE_CHARS = 1000;
/** The messages one lead keeps from the form, newest first; an older one goes. */
export const GYM_ENQUIRIES_KEPT_PER_LEAD = 20;
/** A robot check's answer is at most this long (Cloudflare Turnstile's own limit). */
export const ROBOT_CHECK_TOKEN_MAX_CHARS = 2048;

// ── PHOTOS (20c-iv-b; RULINGS 2026-09-28: "just for people to see facilities") ──

/** The most photos one page shows, and how big each may be once the browser has
 *  shrunk it. */
export const GYM_PAGE_MAX_PHOTOS = 10;
export const GYM_PAGE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
/** Longest side the browser shrinks a photo to before it is sent. */
export const GYM_PAGE_PHOTO_SEND_SIDE = 2000;
/** What the server takes from anything that did not go through the browser's shrink. */
export const GYM_PAGE_PHOTO_MAX_SIDE = 8000;
export const GYM_PAGE_PHOTO_MAX_PIXELS = 40_000_000;
export const GYM_PAGE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type GymPagePhotoType = (typeof GYM_PAGE_PHOTO_TYPES)[number];

/** One photo on a page, in the page's order. Its picture is at
 *  `/v1/orgs/{gymId}/page/photos/{id}` for staff and `/v1/public/gyms/{slug}/photos/{id}`
 *  for anybody while the page is on. */
export const gymPagePhotoSchema = z
  .object({
    id: z.string().uuid(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export type GymPagePhoto = z.infer<typeof gymPagePhotoSchema>;

/** The photo's bytes as base64 (the member file's transport: JSON, no multipart). */
export const addGymPagePhotoRequestSchema = z
  .object({
    contentBase64: z
      .string()
      .min(4)
      .max(Math.ceil(GYM_PAGE_PHOTO_MAX_BYTES / 3) * 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
export type AddGymPagePhotoRequest = z.infer<typeof addGymPagePhotoRequestSchema>;
export const gymPagePhotoResponseSchema = z.object({ photo: gymPagePhotoSchema }).strict();

/** The page's photos in a new order: every photo it has, each once. */
export const orderGymPagePhotosRequestSchema = z
  .object({
    photoIds: z
      .array(z.string().uuid())
      .max(GYM_PAGE_MAX_PHOTOS)
      .refine((ids) => new Set(ids).size === ids.length, { message: "a photo twice" }),
  })
  .strict();
export type OrderGymPagePhotosRequest = z.infer<typeof orderGymPagePhotosRequestSchema>;
export const gymPagePhotosResponseSchema = z.object({ photos: z.array(gymPagePhotoSchema).max(GYM_PAGE_MAX_PHOTOS) }).strict();

/** What staff read when a photo cannot be added or moved. */
export const GYM_PAGE_PHOTO_WORDS = {
  too_big: "This photo is bigger than 2 MB. Choose a smaller one.",
  not_a_photo: "Choose a photo saved as JPEG, PNG or WebP.",
  damaged: "We couldn't read this photo. Choose another, or save it again and add it.",
  too_many_pixels: "This photo is too large. Choose a smaller one.",
  full: `Your page has ${String(GYM_PAGE_MAX_PHOTOS)} photos, the most it can show. Remove one to add another.`,
  changed: "Your photos were changed somewhere else. Close this panel and open it again.",
  not_found: "This photo has already been removed.",
} as const;

/** The gym's page as its staff see it in the console. */
export const gymPageSchema = z
  .object({
    shown: z.boolean(),
    about: z.string().max(GYM_PAGE_MAX_ABOUT_CHARS),
    facilities: z.array(gymFacilitySchema).max(GYM_FACILITIES.length),
    /** The gym's own facilities, in the order it added them. */
    ownFacilities: z.array(z.string()).max(GYM_PAGE_MAX_OWN_FACILITIES),
    /** The page's photos; the first is the large one. */
    photos: z.array(gymPagePhotoSchema).max(GYM_PAGE_MAX_PHOTOS),
    /** The page's address is `/gyms/{slug}`. */
    slug: z.string().min(1),
    /** This person may change the page (the owner's `org.manage`); others see it. */
    mayChange: z.boolean(),
  })
  .strict();
export type GymPage = z.infer<typeof gymPageSchema>;
export const gymPageResponseSchema = z.object({ page: gymPageSchema }).strict();
export type GymPageResponse = z.infer<typeof gymPageResponseSchema>;

export const setGymPageRequestSchema = z
  .object({
    shown: z.boolean(),
    about: z.string().max(GYM_PAGE_MAX_ABOUT_CHARS),
    facilities: z
      .array(gymFacilitySchema)
      .max(GYM_FACILITIES.length)
      .refine((list) => new Set(list).size === list.length, { message: "a facility twice" }),
    ownFacilities: z
      .array(ownFacilitySchema)
      .max(GYM_PAGE_MAX_OWN_FACILITIES)
      .refine((list) => new Set(list.map((name) => name.toLowerCase())).size === list.length, { message: "a facility twice" }),
  })
  .strict();
export type SetGymPageRequest = z.infer<typeof setGymPageRequestSchema>;

/** What anybody with the link sees. Nothing on it is about a person. */
export const publicGymPageSchema = z
  .object({
    name: z.string(),
    city: z.string().nullable(),
    orgType: orgTypeSchema,
    about: z.string(),
    facilities: z.array(gymFacilitySchema),
    ownFacilities: z.array(z.string()),
    photos: z.array(gymPagePhotoSchema).max(GYM_PAGE_MAX_PHOTOS),
    hours: gymHoursSchema,
    /** The robot check's public site key, for the widget. */
    robotCheckKey: z.string().min(1),
  })
  .strict();
export type PublicGymPage = z.infer<typeof publicGymPageSchema>;
export const publicGymPageResponseSchema = z.object({ page: publicGymPageSchema }).strict();
export type PublicGymPageResponse = z.infer<typeof publicGymPageResponseSchema>;

/** The form. `trap` is a field no person sees or fills: a robot that fills every
 *  field fills it, and its enquiry is dropped without a word. */
export const gymEnquiryRequestSchema = z
  .object({
    fullName: z.string().max(MEMBER_LIST_MAX_NAME_CHARS),
    email: z.string().max(MEMBER_LIST_MAX_EMAIL_CHARS).optional(),
    phone: z.string().max(MEMBER_LIST_MAX_TYPED_PHONE_CHARS).optional(),
    source: leadSourceSchema.optional(),
    message: z.string().max(GYM_ENQUIRY_MAX_MESSAGE_CHARS).optional(),
    mayEmail: z.boolean().optional(),
    trap: z.string().max(200).optional(),
    robotToken: z.string().min(1).max(ROBOT_CHECK_TOKEN_MAX_CHARS),
  })
  .strict();
export type GymEnquiryRequest = z.infer<typeof gymEnquiryRequestSchema>;

/** The same answer whether the person was new, already a lead, or a robot's fill of
 *  the hidden field: the form never says who a gym already has. */
export const gymEnquiryResponseSchema = z.object({ received: z.literal(true) }).strict();
export type GymEnquiryResponse = z.infer<typeof gymEnquiryResponseSchema>;

/** Where a person heard of the gym, in the words the form offers them. */
export const ENQUIRY_SOURCE_WORDS: Record<LeadSource, string> = {
  walk_in: "Walked past",
  website: "Your website",
  social: "Social media",
  friend: "A friend",
  other: "Somewhere else",
};

/** One message from the form, on the lead it was kept with. */
export const leadEnquirySchema = z
  .object({
    id: z.string().uuid(),
    /** As the person typed them this time; the lead's own may differ. */
    fullName: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    source: leadSourceSchema.nullable(),
    message: z.string(),
    mayEmail: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type LeadEnquiry = z.infer<typeof leadEnquirySchema>;
export const leadEnquiriesResponseSchema = z.object({ enquiries: z.array(leadEnquirySchema) }).strict();
export type LeadEnquiriesResponse = z.infer<typeof leadEnquiriesResponseSchema>;

/** Cloudflare Turnstile's Siteverify reply, read at the edge: only `success` decides. */
export const robotCheckReplySchema = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).optional(),
});
export type RobotCheckReply = z.infer<typeof robotCheckReplySchema>;

/** The words a person using the form reads. */
export const ENQUIRY_WORDS = {
  not_found: "This page isn't available.",
  needs_name: "Add your name.",
  needs_contact: "Add your email address or phone number, so they can reach you.",
  needs_email: "Add your email address to hear from them by email.",
  bad_email: "Check your email address.",
  bad_phone: "Check your phone number.",
  card_number: "That looks like a payment card number. Please take it out and send again.",
  robot: "We couldn't check that you're not a robot. Please try again.",
  /** The robot check's script did not load (a blocker, or a network that stops it). */
  robot_blocked: (gym: string): string =>
    `The robot check didn't load. Turn off any ad blocker for this page and reload it, or contact ${gym} directly.`,
  robot_unavailable: "We couldn't send your message just now. Please try again in a minute.",
  full: "This page can't take messages right now. Please contact them directly.",
  too_many: "Too many messages have been sent from here. Please try again later.",
  /** The page's own hourly allowance, spent only by sends that passed the robot check. */
  page_busy: "This page is getting a lot of messages. Please try again in an hour, or contact them directly.",
} as const;
