// The phone's own notifications (ROADMAP Stage 5 items 18b-i and 18b-ii-a): the one file that knows the package.
// Android shows a gym's notification by itself when the app is closed; the server tags each with
// the gym, so the gym's next one replaces it. In the app, one is shown unless that gym's Inbox is
// already open.
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { GYM_MESSAGES_CHANNEL, GYM_PLACES_CHANNEL, gymMessagePushDataSchema, gymPlacePushDataSchema, type GymPlacePushData } from "@app/shared";

export type NotificationsAllowed = "yes" | "ask" | "no";

/** The gym whose Inbox is open, if any: its new message is already on the screen. */
let inboxOpen: string | null = null;
export function setInboxOpen(gymId: string | null): void {
  inboxOpen = gymId;
}

/** Which gym's Inbox a notification is for, or null for anything that is not ours. */
export function gymOfNotification(data: unknown): string | null {
  const parsed = gymMessagePushDataSchema.safeParse(data);
  return parsed.success ? parsed.data.gymId : null;
}

/** What a tapped notification asks the app to open: a gym's Inbox, or a class or an event of a gym. */
export type Tapped = { kind: "inbox"; gymId: string } | ({ kind: "place" } & Omit<GymPlacePushData, "kind">);

/** What a notification of ours asks to open, or null for anything else. */
export function tappedOf(data: unknown): Tapped | null {
  const inbox = gymMessagePushDataSchema.safeParse(data);
  if (inbox.success) return { kind: "inbox", gymId: inbox.data.gymId };
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

/** One notification for each gym's Inbox, and each class or event: the next replaces it, as the
 *  server's tag does when Android draws it. */
export const identifierOf = (tapped: Tapped): string => (tapped.kind === "inbox" ? `inbox:${tapped.gymId}` : `place:${tapped.id}`);

// Our messages carry data only, so a tap on one Android draws reaches the app. With the app open the
// notifications package neither shows such a message nor asks the handler, so the app shows it itself:
// same words, same channel, same tap, through the handler, so a gym's Inbox already open shows none.
let received: { remove: () => void } | null = null;
async function showInApp(notification: Notifications.Notification): Promise<void> {
  const { content, trigger } = notification.request;
  // Only Firebase's: the one the app shows below is heard here too.
  if (trigger === null || typeof trigger !== "object" || !("type" in trigger) || trigger.type !== "push") return;
  const tapped = tappedOf(content.data);
  if (tapped === null || content.title === null || content.body === null) return;
  const channelId = tapped.kind === "inbox" ? GYM_MESSAGES_CHANNEL.id : GYM_PLACES_CHANNEL.id;
  await Notifications.scheduleNotificationAsync({
    identifier: identifierOf(tapped),
    content: { title: content.title, body: content.body, data: content.data ?? {} },
    trigger: { channelId },
  }).catch(() => undefined);
}

/** When the tabs open: the channel the phone's settings name, and what shows in the app. Safe to repeat. */
export function startNotifications(): void {
  received?.remove();
  received = Notifications.addNotificationReceivedListener((notification) => {
    void showInApp(notification);
  });
  Notifications.setNotificationHandler({
    handleNotification: (notification) => {
      const gymId = gymOfNotification(notification.request.content.data);
      const show = gymId === null || gymId !== inboxOpen;
      return Promise.resolve({ shouldShowBanner: show, shouldShowList: show, shouldPlaySound: false, shouldSetBadge: false });
    },
  });
  for (const channel of [GYM_MESSAGES_CHANNEL, GYM_PLACES_CHANNEL]) {
    void Notifications.setNotificationChannelAsync(channel.id, {
      name: channel.name,
      importance: Notifications.AndroidImportance.DEFAULT,
    }).catch(() => undefined);
  }
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

/** Signed out: nothing of the person stays on the phone, none is shown while the app is open, and
 *  Firebase forgets the address, so a message on its way reaches nobody even when the server was not
 *  told. Asked again at each opening and each return while signed out: with no signal it fails. */
export async function forgetNotifications(): Promise<void> {
  received?.remove();
  received = null;
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
