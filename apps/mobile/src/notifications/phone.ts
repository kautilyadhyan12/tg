// The phone's own notifications (ROADMAP Stage 5 item 18b-i): the one file that knows the package.
// Android shows a gym's notification by itself when the app is closed; the server tags each with
// the gym, so the gym's next one replaces it. In the app, one is shown unless that gym's Inbox is
// already open.
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { GYM_MESSAGES_CHANNEL, gymMessagePushDataSchema } from "@app/shared";

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

/** When the tabs open: the channel the phone's settings name, and what shows in the app. Safe to repeat. */
export function startNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: (notification) => {
      const gymId = gymOfNotification(notification.request.content.data);
      const show = gymId === null || gymId !== inboxOpen;
      return Promise.resolve({ shouldShowBanner: show, shouldShowList: show, shouldPlaySound: false, shouldSetBadge: false });
    },
  });
  void Notifications.setNotificationChannelAsync(GYM_MESSAGES_CHANNEL.id, {
    name: GYM_MESSAGES_CHANNEL.name,
    importance: Notifications.AndroidImportance.DEFAULT,
  }).catch(() => undefined);
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
let heldTap: string | null = null;
const tapWatchers = new Set<(gymId: string) => void>();
Notifications.addNotificationResponseReceivedListener((response) => {
  const gymId = gymOfNotification(response.notification.request.content.data);
  if (gymId === null) return;
  if (tapWatchers.size === 0) heldTap = gymId;
  for (const watcher of tapWatchers) watcher(gymId);
});

/** A tap on a gym's notification, including the one that opened the app. */
export function onGymTapped(listener: (gymId: string) => void): () => void {
  tapWatchers.add(listener);
  // The tap that opened the app, which Expo keeps for whoever asks.
  const last = Notifications.getLastNotificationResponse();
  const opened = last === null ? null : gymOfNotification(last.notification.request.content.data);
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
