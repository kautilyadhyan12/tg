// A GYM'S EVENTS (spec Part 3 §15.4; ROADMAP 19c-i). The gym's staff make an event, with
// a poster if they like; its live app members see the coming ones.
//
// An event's times are the gym's own wall clock (`startsOn` + `startMinute`), as a class's
// are; `startsAt` and `endsAt` are the instants the server worked out from them in the
// gym's time zone, which is what a clock compares against.
import { z } from "zod";
import { classDaySchema, classStartMinuteSchema } from "./classes.js";
import { gymPagePhotoSchema } from "./gymPage.js";
import { GYM_POST_PHOTO_MAX_BYTES, postLength } from "./posts.js";

export const GYM_EVENT_NAME_MAX = 80;
export const GYM_EVENT_DETAILS_MAX = 1000;
export const GYM_EVENT_PLACE_MAX = 120;
export const GYM_EVENT_PLACES_MAX = 10_000;
/** How far ahead an event may start, in days from the gym's today. */
export const GYM_EVENT_MAX_DAYS_AHEAD = 730;
/** The longest an event runs, first day to last. */
export const GYM_EVENT_MAX_DAYS = 31;
/** The most coming events a gym keeps at once, and so the most a member is sent. With the
 *  details' length it bounds what one read of the list costs (`tools/measure-events-cost.ts`). */
export const GYM_EVENTS_COMING_MAX = 100;
/** The ended events staff are sent, newest first. */
export const GYM_EVENTS_PAST_SHOWN = 50;
/** A poster is kept as a post's photo is: shrunk by the browser, 1 MB at most here. */
export const GYM_EVENT_POSTER_MAX_BYTES = GYM_POST_PHOTO_MAX_BYTES;

const NUL = String.fromCharCode(0);

/** Typed words, trimmed, counted by character as the screen counts them. */
const words = (max: number) =>
  z
    .string()
    .max(max * 2)
    .refine((text) => !text.includes(NUL), { message: "a character that cannot be kept" })
    .transform((text) => text.trim())
    .refine((text) => postLength(text) <= max, { message: "too many characters" });

const posterBase64 = z
  .string()
  .min(4)
  .max(Math.ceil(GYM_EVENT_POSTER_MAX_BYTES / 3) * 4)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);

/** A real calendar day of this century: `2026-02-31` has the shape and is no day, and
 *  Postgres has no year 0000. */
const eventDaySchema = classDaySchema.refine(
  (day) => {
    const at = new Date(`${day}T00:00:00Z`);
    return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === day && day >= "2000-01-01" && day <= "2099-12-31";
  },
  { message: "not a real date" },
);

const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

/** The letters that draw nothing: the Hangul fillers. Built from their numbers, so no
 *  invisible character sits in this file. */
const BLANK_LETTERS = new RegExp(`[${[0x115f, 0x1160, 0x3164, 0xffa0].map((code) => String.fromCodePoint(code)).join("")}]`, "g");

/** Whether a name has a letter or a number somebody can see: one made of spaces and
 *  marks that draw nothing is no name. */
export function eventNameIsSeen(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text.replace(BLANK_LETTERS, ""));
}

const eventFields = {
  name: words(GYM_EVENT_NAME_MAX).refine(eventNameIsSeen, { message: "a name is needed" }),
  details: words(GYM_EVENT_DETAILS_MAX),
  place: words(GYM_EVENT_PLACE_MAX),
  startsOn: eventDaySchema,
  startMinute: classStartMinuteSchema,
  endsOn: eventDaySchema,
  endMinute: classStartMinuteSchema,
  /** How many people fit; null is no limit. */
  places: z.number().int().min(1).max(GYM_EVENT_PLACES_MAX).nullable(),
};

type EventTimes = { startsOn: string; startMinute: number; endsOn: string; endMinute: number };

/** The end is after the start on the gym's clock, and no more than a month after it. */
const timesInOrder = (event: EventTimes): boolean => {
  const days = dayNumber(event.endsOn) - dayNumber(event.startsOn);
  if (days < 0 || days > GYM_EVENT_MAX_DAYS) return false;
  return days > 0 || event.endMinute > event.startMinute;
};

export const addGymEventRequestSchema = z
  .object({
    /** The browser's key for this one event: the same key again is the same event. */
    eventKey: z.string().uuid(),
    ...eventFields,
    /** The poster as base64, already shrunk by the browser; left out for none. */
    poster: posterBase64.optional(),
  })
  .strict()
  .refine(timesInOrder, { message: "the end must be after the start", path: ["endsOn"] });
export type AddGymEventRequest = z.infer<typeof addGymEventRequestSchema>;

export const changeGymEventRequestSchema = z
  .object({
    ...eventFields,
    /** Left out: the poster stays as it is. Null: it is taken off. Base64: a new one. */
    poster: posterBase64.nullable().optional(),
  })
  .strict()
  .refine(timesInOrder, { message: "the end must be after the start", path: ["endsOn"] });
export type ChangeGymEventRequest = z.infer<typeof changeGymEventRequestSchema>;

export const cancelGymEventRequestSchema = z.object({ cancelled: z.boolean() }).strict();

export const gymEventParamsSchema = z.object({ gymId: z.string().uuid(), eventId: z.string().uuid() }).strict();
export const gymEventPosterParamsSchema = gymEventParamsSchema.extend({ posterId: z.string().uuid() }).strict();

/** An event as members and staff are sent it. Its poster's picture is at
 *  `/v1/orgs/{gymId}/events/{id}/poster/{poster.id}`. */
export const gymEventSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    details: z.string(),
    place: z.string(),
    startsOn: classDaySchema,
    startMinute: classStartMinuteSchema,
    endsOn: classDaySchema,
    endMinute: classStartMinuteSchema,
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    places: z.number().int().positive().nullable(),
    cancelled: z.boolean(),
    poster: gymPagePhotoSchema.nullable(),
  })
  .strict();
export type GymEvent = z.infer<typeof gymEventSchema>;

/** The gym's coming events for a live app member of it, soonest first: every event that
 *  has not ended, a cancelled one too, so nobody wonders where it went. */
export const gymEventsResponseSchema = z
  .object({
    gymId: z.string().uuid(),
    gymName: z.string(),
    /** The zone the events' days and times are in. */
    timezone: z.string(),
    /** Today on the gym's clock. */
    today: classDaySchema,
    /** "paused": the gym is not on a plan, and its events are not shown. */
    status: z.enum(["shown", "paused"]),
    events: z.array(gymEventSchema).max(GYM_EVENTS_COMING_MAX),
  })
  .strict();
export type GymEventsResponse = z.infer<typeof gymEventsResponseSchema>;

/** The gym's events for its staff holding `posts.manage`. */
export const staffGymEventsResponseSchema = z
  .object({
    gymId: z.string().uuid(),
    gymName: z.string(),
    timezone: z.string(),
    /** Today on the gym's clock: the first day a new event may start on. */
    today: classDaySchema,
    coming: z.array(gymEventSchema).max(GYM_EVENTS_COMING_MAX),
    /** Ended events, newest first. */
    past: z.array(gymEventSchema).max(GYM_EVENTS_PAST_SHOWN),
    pastTotal: z.number().int().nonnegative(),
  })
  .strict();
export type StaffGymEventsResponse = z.infer<typeof staffGymEventsResponseSchema>;

export const gymEventResponseSchema = z.object({ event: gymEventSchema }).strict();
export type GymEventResponse = z.infer<typeof gymEventResponseSchema>;

/** What a person reads when an event cannot be made, changed or found. */
export const GYM_EVENT_WORDS = {
  not_found: "This event isn't here any more.",
  poster_not_found: "This poster has been removed.",
  ended: "This event has ended, so it can't be changed.",
  already_ended: "This date and time have already passed. Choose a later end.",
  too_far: "An event can start up to two years from today. Choose an earlier day.",
  ends_before_start: "The end must be after the start.",
  full: `You have ${String(GYM_EVENTS_COMING_MAX)} coming events, which is the most allowed. Wait for one to end, then add this.`,
  poster_too_big: "This poster is bigger than 1 MB. Choose a smaller picture.",
  poster: (why: string): string => `Poster: ${why}`,
} as const;
