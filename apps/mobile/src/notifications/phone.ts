// The phone's own notifications (ROADMAP Stage 5 items 18b-i, 18b-ii-a and 18b-ii-b): the one file that knows the package.
// The app draws each of ours itself, only for the person signed in (`drawn.ts`); each has one
// identifier a gym's Inbox, class or comments, so the next replaces it. In the app, one is shown
// unless that gym's Inbox (or, for comments, its Updates) is already open.
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import {
  GYM_COMMENTS_CHANNEL,
  GYM_MESSAGES_CHANNEL,
  GYM_PLACES_CHANNEL,
  TRAINING_REMINDERS_CHANNEL,
  gymCommentPushDataSchema,
  gymMessagePushDataSchema,
  gymPlacePushDataSchema,
  trainingReminderPushDataSchema,
  type GymPlacePushData,
} from "@app/shared";

export type NotificationsAllowed = "yes" | "ask" | "no";

/** The gym whose Inbox is open, if any: its new message is already on the screen. */
let inboxOpen: string | null = null;
export function setInboxOpen(gymId: string | null): void {
  inboxOpen = gymId;
}

/** The gym whose Updates is open, if any: its new comments are already a page away. */
let updatesOpen: string | null = null;
export function setUpdatesOpen(gymId: string | null): void {
  updatesOpen = gymId;
}

/** Which gym's Inbox a notification is for, or null for anything that is not ours. */
export function gymOfNotification(data: unknown): string | null {
  const parsed = gymMessagePushDataSchema.safeParse(data);
  return parsed.success ? parsed.data.gymId : null;
}

/** What a tapped notification asks the app to open: a gym's Inbox, a class or an event of a gym, or the
 *  comments of a post on a gym's Updates. */
export type Tapped =
  | { kind: "inbox"; gymId: string }
  | ({ kind: "place" } & Omit<GymPlacePushData, "kind">)
  | { kind: "comment"; gymId: string; postId: string }
  | { kind: "training"; open: "workout" | "food" };

/** A tap that opens a place's page on the Gym tab. */
export type GymTapped = Exclude<Tapped, { kind: "training" }>;

/** What a notification of ours asks to open, or null for anything else. */
export function tappedOf(data: unknown): Tapped | null {
  const inbox = gymMessagePushDataSchema.safeParse(data);
  if (inbox.success) return { kind: "inbox", gymId: inbox.data.gymId };
  const comment = gymCommentPushDataSchema.safeParse(data);
  if (comment.success) return { kind: "comment", gymId: comment.data.gymId, postId: comment.data.postId };
  const training = trainingReminderPushDataSchema.safeParse(data);
  if (training.success) return { kind: "training", open: training.data.open };
  const place = gymPlacePushDataSchema.safeParse(data);
  if (!place.success) return null;
  const { gymId, what, id, day } = place.data;
  return { kind: "place", gymId, what, id, day };
}

const dayNumber = (day: string): number | null => {
  const ms = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
};

/** Which of the Classes page's weeks holds `day` now (0 starts today on the gym's clock), worked out
 *  when the notification is tapped, however long it waited in the tray. 0 when it cannot be read. */
export function weekOfDay(day: string, zone: string, nowMs: number): number {
  let today: string;
  try {
    today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(nowMs);
  } catch {
    return 0;
  }
  const on = dayNumber(day);
  const from = dayNumber(today);
  if (on === null || from === null) return 0;
  return Math.min(7, Math.max(0, Math.floor((on - from) / 7)));
}

/** One notification for each gym's Inbox, each class or event, and each gym's comments: the next
 *  replaces it, as the server's tag does when Android draws it. */
export function identifierOf(tapped: Tapped): string {
  if (tapped.kind === "inbox") return `inbox:${tapped.gymId}`;
  if (tapped.kind === "comment") return `comments:${tapped.gymId}`;
  if (tapped.kind === "training") return "training-reminder";
  return `place:${tapped.id}`;
}

export const channelOf = (tapped: Tapped): string =>
  tapped.kind === "inbox"
    ? GYM_MESSAGES_CHANNEL.id
    : tapped.kind === "comment"
      ? GYM_COMMENTS_CHANNEL.id
      : tapped.kind === "training"
        ? TRAINING_REMINDERS_CHANNEL.id
        : GYM_PLACES_CHANNEL.id;

/** When the tabs open: the channel the phone's settings name, and what shows in the app. Safe to repeat. */
export function startNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: (notification) => {
      const gymId = gymOfNotification(notification.request.content.data);
      const tapped = tappedOf(notification.request.content.data);
      const show = (gymId === null || gymId !== inboxOpen) && !(tapped?.kind === "comment" && tapped.gymId === updatesOpen);
      return Promise.resolve({ shouldShowBanner: show, shouldShowList: show, shouldPlaySound: false, shouldSetBadge: false });
    },
  });
  for (const channel of [GYM_MESSAGES_CHANNEL, GYM_PLACES_CHANNEL, GYM_COMMENTS_CHANNEL, TRAINING_REMINDERS_CHANNEL]) {
    void Notifications.setNotificationChannelAsync(channel.id, {
      name: channel.name,
      importance: Notifications.AndroidImportance.DEFAULT,
    }).catch(() => undefined);
  }
}

/** The app's channels the person turned off in the phone's own settings (each kind has its own). */
export async function channelsOff(ids: readonly string[]): Promise<string[]> {
  const off: string[] = [];
  for (const id of ids) {
    try {
      const channel = await Notifications.getNotificationChannelAsync(id);
      if (channel !== null && channel.importance === Notifications.AndroidImportance.NONE) off.push(id);
    } catch {
      // Not readable: nothing is said about it.
    }
  }
  return off;
}

export async function notificationsAllowed(): Promise<NotificationsAllowed> {
  try {
    const now = await Notifications.getPermissionsAsync();
    if (now.granted) return "yes";
    return now.canAskAgain ? "ask" : "no";
  } catch {
    return "no";
  }
}

/** Android's own question. */
export async function askNotifications(): Promise<boolean> {
  try {
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** The address Firebase gave this phone, or null when it has none (a copy built without Firebase). */
export async function phoneAddress(): Promise<string | null> {
  try {
    const token = await Notifications.getDevicePushTokenAsync();
    return token.type === "android" && typeof token.data === "string" ? token.data : null;
  } catch {
    return null;
  }
}

/** Firebase gave the phone a new address. */
export function onNewAddress(listener: (address: string) => void): () => void {
  const subscription = Notifications.addPushTokenListener((token) => {
    if (token.type === "android" && typeof token.data === "string") listener(token.data);
  });
  return () => {
    subscription.remove();
  };
}

// A tap is heard from the moment the app starts: one that opened the app arrives before the tabs
// are drawn, and is held until they are.
let heldTap: Tapped | null = null;
const tapWatchers = new Set<(tapped: Tapped) => void>();
Notifications.addNotificationResponseReceivedListener((response) => {
  const tapped = tappedOf(response.notification.request.content.data);
  if (tapped === null) return;
  if (tapWatchers.size === 0) heldTap = tapped;
  for (const watcher of tapWatchers) watcher(tapped);
});

/** A tap on one of our notifications, including the one that opened the app. */
export function onTapped(listener: (tapped: Tapped) => void): () => void {
  tapWatchers.add(listener);
  // The tap that opened the app, which Expo keeps for whoever asks.
  const last = Notifications.getLastNotificationResponse();
  const opened = last === null ? null : tappedOf(last.notification.request.content.data);
  if (opened !== null) Notifications.clearLastNotificationResponse();
  const held = opened ?? heldTap;
  heldTap = null;
  if (held !== null) listener(held);
  return () => {
    tapWatchers.delete(listener);
  };
}

/** Takes a gym's notification off the phone: its Inbox has been opened. */
export async function clearGym(gymId: string): Promise<void> {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    for (const one of shown) {
      if (gymOfNotification(one.request.content.data) === gymId) await Notifications.dismissNotificationAsync(one.request.identifier);
    }
  } catch {
    // Nothing to clear.
  }
}

/** Takes a gym's comments notification off the phone: its Updates has been opened. */
export async function clearComments(gymId: string): Promise<void> {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    for (const one of shown) {
      const tapped = tappedOf(one.request.content.data);
      if (tapped?.kind === "comment" && tapped.gymId === gymId) await Notifications.dismissNotificationAsync(one.request.identifier);
    }
  } catch {
    // Nothing to clear.
  }
}

/** Signed out: nothing of the person stays on the phone, none is shown while the app is open, and
 *  Firebase forgets the address, so a message on its way reaches nobody even when the server was not
 *  told. Asked again at each opening and each return while signed out: with no signal it fails. */
export async function forgetNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: () => Promise.resolve({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
  });
  await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
  await Notifications.unregisterForNotificationsAsync().catch(() => undefined);
}

const NOT_NOW_KEY = "notifications-not-now";
/** "Not now" is asked again after two weeks. */
export const ASK_AGAIN_MS = 14 * 24 * 60 * 60 * 1000;

export async function saidNotNowAt(): Promise<number | null> {
  try {
    const kept = await SecureStore.getItemAsync(NOT_NOW_KEY);
    const at = kept === null ? Number.NaN : Number(kept);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

export async function keepNotNow(at: number): Promise<void> {
  await SecureStore.setItemAsync(NOT_NOW_KEY, String(at)).catch(() => undefined);
}
