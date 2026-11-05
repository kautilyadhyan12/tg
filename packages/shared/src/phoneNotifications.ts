// PHONE NOTIFICATIONS (ROADMAP Stage 5 item 18b-i; spec Part 6 §6). The phone gives the server its
// notification address; the server tells the phone about a gym's new messages through Firebase.
// One notification a gym, replaced by the next, and none at night (Kd, 2026-11-02).
import { z } from "zod";
import { unreadBadge } from "./gymInboxWords.js";

/** The phone's notification address, as Firebase gives it to the phone. */
export const pushTokenRequestSchema = z
  .object({
    token: z.string().trim().min(20).max(4096).regex(/^[\x21-\x7e]+$/, "a notification address has no spaces"),
    platform: z.literal("android"),
  })
  .strict();
export type PushTokenRequest = z.infer<typeof pushTokenRequestSchema>;

export const pushTokenResponseSchema = z.object({ saved: z.literal(true) }).strict();
export type PushTokenResponse = z.infer<typeof pushTokenResponseSchema>;

/** A gym's messages go from 04:00 up to 23:00 on the person's own clock (Kd, 2026-11-03); one due at
 *  night waits for 04:00. A place in a class or an event goes at any hour. */
export const PUSH_FIRST_HOUR = 4;
export const PUSH_LAST_HOUR = 23;

/** Whether a notification may go now, by the hour on the person's clock (0 to 23). Anything that is
 *  not an hour of the day is no: garbage in sends nothing. */
export function pushHourOpen(hour: unknown): boolean {
  return typeof hour === "number" && Number.isInteger(hour) && hour >= PUSH_FIRST_HOUR && hour < PUSH_LAST_HOUR;
}

/** A message is told to the phone only within this many hours of being sent: a phone added later is
 *  not told about old messages. */
export const PUSH_WITHIN_HOURS = 24;

/** The Android channel a gym's messages arrive on; its name is what the phone's settings show. */
export const GYM_MESSAGES_CHANNEL = { id: "gym-messages", name: "Messages" } as const;

/** What the phone shows for a gym's new messages: the gym's name, and its count once more than one is
 *  new (the same count as the Inbox button), over the newest message. */
export function gymMessageNotification(gymName: string, newest: string, unread: number): { title: string; body: string } {
  const count = unreadBadge(unread);
  return {
    title: count !== null && unread > 1 ? `${gymName} · ${count} new messages` : gymName,
    body: newest,
  };
}

/** What every notification of ours carries to the phone, as Firebase hands it to the app's own
 *  notification task. The words are NOT under `title` and `message`: under those the notifications
 *  package draws a message by itself when the app is not open, whoever is signed in. The app draws it
 *  only while `to`, the person it was sent to, is the one signed in on the phone. `body` is the tap's
 *  data as JSON (below), the key the package reads it from. */
export const phonePushSchema = z
  .object({
    heading: z.string().min(1).max(400),
    text: z.string().min(1).max(2000),
    to: z.string().uuid(),
    body: z.string().max(1000),
    channelId: z.string().min(1).max(100),
    tag: z.string().min(1).max(200),
  })
  .strip();
export type PhonePush = z.infer<typeof phonePushSchema>;

/** A push's `body`, read from JSON: the tap's data, an object, checked again by the schemas below. */
export const phonePushTapDataSchema = z.record(z.string(), z.unknown());

/** What a notification carries for the app: which gym's Inbox a tap opens. */
export const gymMessagePushDataSchema = z.object({ kind: z.literal("gym_inbox"), gymId: z.string().uuid() }).strip();
export type GymMessagePushData = z.infer<typeof gymMessagePushDataSchema>;

// ── A PLACE IN A CLASS OR AN EVENT (ROADMAP Stage 5 item 18b-ii-a) ──

/** The Android channel for places in classes and events. */
export const GYM_PLACES_CHANNEL = { id: "gym-places", name: "Classes and events" } as const;

/** `yours`: moved off the waitlist into the class or event. `free`: a place is free in the last stretch
 *  before the start, when it is no longer handed over by itself, and the first to claim it has it. */
export const PLACE_NOTICES = ["yours", "free"] as const;
export type PlaceNotice = (typeof PLACE_NOTICES)[number];

/** A free place is told to the same person at most once in this long for one class or event, so a
 *  busy class does not keep sounding their phone (Kd, 2026-11-03). */
export const PLACE_FREE_AGAIN_MINUTES = 60;

/** What the phone shows. `when` is `reminderWhen`'s: "today at 6:00 PM", "on Tuesday 11 November at
 *  6:00 PM". */
export function placeNotification(input: { notice: PlaceNotice; gymName: string; name: string; when: string }): { title: string; body: string } {
  const { notice, gymName, name, when } = input;
  return notice === "yours"
    ? { title: gymName, body: `You have a place in ${name} ${when}. You were moved off the waitlist.` }
    : { title: gymName, body: `A place is free in ${name} ${when}. The first to claim it gets it.` };
}

/** What a place's notification carries for the app: the gym, and the class or event a tap opens. `day`:
 *  its day on the gym's clock, from which the phone works out the week to open when it is tapped. */
export const gymPlacePushDataSchema = z
  .object({
    kind: z.literal("gym_place"),
    gymId: z.string().uuid(),
    what: z.enum(["class", "event"]),
    id: z.string().uuid(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strip();
export type GymPlacePushData = z.infer<typeof gymPlacePushDataSchema>;

// ── A COMMENT OR REPLY ON YOUR POST (ROADMAP Stage 5 item 18b-ii-b) ──

/** The Android channel for comments and replies on the person's posts and comments. */
export const GYM_COMMENTS_CHANNEL = { id: "gym-comments", name: "Comments" } as const;

/** One comments notification a gym, replaced by the next (Kd, 2026-11-03: "top of one another"), and
 *  it sounds the same person's phone at most once in this long; what comes in between joins it. */
export const COMMENTS_AGAIN_MINUTES = 30;

/** What a comment was to the person told: on their post, or an answer to their comment or reply. */
export type CommentNotice = "on_post" | "reply";

/** The longest piece of a comment's words a notification shows: one comment, and each line of several. */
export const COMMENT_NOTIFICATION_WORDS = 200;
export const COMMENT_NOTIFICATION_LINE_WORDS = 100;
/** Several new comments: this many newest are listed, one a line, when the notification is opened (Kd,
 *  2026-11-03); the rest are counted in a last line. */
export const COMMENT_NOTIFICATION_LINES = 5;

/** Cut by whole characters, never between an emoji's two halves. */
function clip(words: string, most: number): string {
  const flat = Array.from(words.replace(/\s+/g, " ").trim());
  return flat.length <= most ? flat.join("") : `${flat.slice(0, most - 1).join("").trimEnd()}…`;
}

export interface CommentNotified {
  name: string;
  notice: CommentNotice;
  words: string;
}

/** What the phone shows, from the new comments newest first: one says who and what; several give the
 *  count in the title and list the newest, newest on top, one a line, which the phone shows in full when
 *  the notification is opened. None is no notification. */
export function commentNotification(input: { gymName: string; comments: readonly CommentNotified[] }): { title: string; body: string } | null {
  const { gymName, comments } = input;
  const [newest] = comments;
  if (newest === undefined) return null;
  if (comments.length === 1) {
    const what = newest.notice === "reply" ? "replied to your comment" : "commented on your post";
    return { title: gymName, body: `${newest.name} ${what}: ${clip(newest.words, COMMENT_NOTIFICATION_WORDS)}` };
  }
  const lines = comments.slice(0, COMMENT_NOTIFICATION_LINES).map((c) => `${c.name}: ${clip(c.words, COMMENT_NOTIFICATION_LINE_WORDS)}`);
  const rest = comments.length - lines.length;
  if (rest > 0) lines.push(`and ${String(rest)} more`);
  return { title: `${gymName} · ${String(comments.length)} new comments`, body: lines.join("\n") };
}

/** What a comment's notification carries for the app: the gym, and the post whose comments a tap opens. */
export const gymCommentPushDataSchema = z.object({ kind: z.literal("gym_comment"), gymId: z.string().uuid(), postId: z.string().uuid() }).strip();
export type GymCommentPushData = z.infer<typeof gymCommentPushDataSchema>;

// ── Google's replies (the adapter parses them here) ──

/** Google's sign-in for a service account: the access token for Firebase. */
export const googleServiceTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

/** A service account's key file, as Firebase's console downloads it. */
export const firebaseServiceAccountSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().min(1).regex(/^[a-z0-9-]+$/),
  client_email: z.string().email(),
  private_key: z.string().includes("PRIVATE KEY"),
  token_uri: z.string().url().default("https://oauth2.googleapis.com/token"),
});
export type FirebaseServiceAccount = z.infer<typeof firebaseServiceAccountSchema>;

/** Firebase's answer to one message: its name when sent, else an error whose details may say the
 *  address is gone. */
export const fcmSendReplySchema = z.object({ name: z.string().min(1) });
export const fcmErrorReplySchema = z.object({
  error: z.object({
    code: z.number().int().optional(),
    status: z.string().optional(),
    message: z.string().optional(),
    details: z.array(z.object({ errorCode: z.string().optional() }).passthrough()).optional(),
  }),
});
