// THE PHONE DRAWS ITS OWN NOTIFICATIONS (ROADMAP Stage 5 item 18's security pass). Firebase hands every
// message of ours to this task, with the app open, in the background or closed, and it is drawn only
// while the person it was sent to is the one signed in here: after a Sign out with no signal, or with
// somebody else signed in since, it is dropped. The notifications package never draws one by itself:
// the server's words are not under the keys it reads (`phonePushSchema`).
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { phoneKeptSessionSchema, phonePushSchema, phonePushTapDataSchema } from "@app/shared";
import { phoneKeyStore } from "../session/keyStore";
import { channelOf, identifierOf, tappedOf } from "./phone";

export const PUSH_TASK = "kwazo-push";

export interface ToDraw {
  identifier: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  channelId: string;
}

const readJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** What to draw for a message Firebase handed over, or null: not ours, unreadable, or for somebody other
 *  than `signedIn`, the person signed in on the phone now. */
export function pushToDraw(payload: unknown, signedIn: string | null): ToDraw | null {
  if (signedIn === null || typeof payload !== "object" || payload === null || !("data" in payload)) return null;
  const push = phonePushSchema.safeParse(payload.data);
  if (!push.success || push.data.to !== signedIn) return null;
  const data = phonePushTapDataSchema.safeParse(readJson(push.data.body));
  const tapped = data.success ? tappedOf(data.data) : null;
  if (!data.success || tapped === null) return null;
  return { identifier: identifierOf(tapped), title: push.data.heading, body: push.data.text, data: data.data, channelId: channelOf(tapped) };
}

/** The person signed in on this phone now, read from the key store, or null. */
async function signedInNow(): Promise<string | null> {
  try {
    const written = await phoneKeyStore.read();
    if (written === null || written === "") return null;
    const kept = phoneKeptSessionSchema.safeParse(JSON.parse(written));
    return kept.success ? kept.data.user.id : null;
  } catch {
    return null;
  }
}

/** Draws a message Firebase handed over, if it is for whoever is signed in now. With the app open it
 *  goes through the app's handler, so a gym's Inbox or Updates already open shows none. */
export async function drawPush(payload: unknown): Promise<void> {
  const draw = pushToDraw(payload, await signedInNow());
  if (draw === null) return;
  await Notifications.scheduleNotificationAsync({
    identifier: draw.identifier,
    content: { title: draw.title, body: draw.body, data: draw.data },
    trigger: { channelId: draw.channelId },
  }).catch(() => undefined);
}

/** Called once, at the top of the app's bundle: Android runs it there with the app closed too. */
export function startPushTask(): void {
  TaskManager.defineTask(PUSH_TASK, async ({ data }) => {
    await drawPush(data);
  });
  void Notifications.registerTaskAsync(PUSH_TASK).catch(() => undefined);
}
