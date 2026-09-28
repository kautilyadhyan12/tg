// A GYM'S OWN PAGE AND ITS ENQUIRY FORM — spec Part 3 §16.3; ROADMAP 20c-iv-a;
// RULINGS 2026-09-28.
//
// A page of ours, at `/gyms/{slug}`, that a gym links to from Instagram, WhatsApp or
// its own website (and may show inside its website with the code it copies). It shows
// the gym's name, town, opening hours, its own "About us" and the facilities it ticked,
// and a form. A person who sends the form becomes one of the gym's leads, or, when a
// lead already has their email or phone, a message on that lead. Off until the gym
// switches it on. Photos are 20c-iv-b's.
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
export const GYM_PAGE_MAX_OTHER_FACILITIES_CHARS = 200;
export const GYM_ENQUIRY_MAX_MESSAGE_CHARS = 1000;
/** The messages one lead keeps from the form, newest first; an older one goes. */
export const GYM_ENQUIRIES_KEPT_PER_LEAD = 20;
/** A robot check's answer is at most this long (Cloudflare Turnstile's own limit). */
export const ROBOT_CHECK_TOKEN_MAX_CHARS = 2048;

/** The gym's page as its staff see it in the console. */
export const gymPageSchema = z
  .object({
    shown: z.boolean(),
    about: z.string().max(GYM_PAGE_MAX_ABOUT_CHARS),
    facilities: z.array(gymFacilitySchema).max(GYM_FACILITIES.length),
    otherFacilities: z.string().max(GYM_PAGE_MAX_OTHER_FACILITIES_CHARS),
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
    otherFacilities: z.string().max(GYM_PAGE_MAX_OTHER_FACILITIES_CHARS),
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
    otherFacilities: z.string(),
    hours: gymHoursSchema,
    /** The robot check's public site key, for the widget. */
    robotCheckKey: z.string().min(1),
  })
  .strict();
export type PublicGymPage = z.infer<typeof publicGymPageSchema>;
export const publicGymPageResponseSchema = z.object({ page: publicGymPageSchema }).strict();
export type PublicGymPageResponse = z.infer<typeof publicGymPageResponseSchema>;

/** The form. `fax` is a field no person sees or fills: a robot that fills every
 *  field fills it, and its enquiry is dropped without a word. */
export const gymEnquiryRequestSchema = z
  .object({
    fullName: z.string().max(MEMBER_LIST_MAX_NAME_CHARS),
    email: z.string().max(MEMBER_LIST_MAX_EMAIL_CHARS).optional(),
    phone: z.string().max(MEMBER_LIST_MAX_TYPED_PHONE_CHARS).optional(),
    source: leadSourceSchema.optional(),
    message: z.string().max(GYM_ENQUIRY_MAX_MESSAGE_CHARS).optional(),
    mayEmail: z.boolean().optional(),
    fax: z.string().max(200).optional(),
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
  robot_unavailable: "We couldn't send your message just now. Please try again in a minute.",
  full: "This page can't take messages right now. Please contact them directly.",
  too_many: "Too many messages have been sent from here. Please try again later.",
} as const;
