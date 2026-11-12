import * as SecureStore from "expo-secure-store";
import { APP_PAYMENT_LIMITS, phonePayAwaySchema } from "@app/shared";

// Pay on My membership (ROADMAP Stage 5 item 20f): while Square's page is in its tab over the app, Android may close the
// app to free memory (seen on Kd's phone, 2026-11-12: closed 5 s after the tab opened). The place being paid is kept on the
// phone, for whoever is signed in, so the app opens that place's My membership when it starts again: there the page is
// ended and how it went is said. Kept no longer than a page can be open. A line being bought (20g) keeps its purchase too,
// and the app opens that place's Buy instead, where that page is ended.

const KEY = "pay-away";
export const PAY_AWAY_MS = APP_PAYMENT_LIMITS.openMinutes * 60_000;

export async function keepPayAway(userId: string, gymId: string, now: number = Date.now(), purchaseId: string | null = null): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify({ userId, gymId, at: now, purchaseId })).catch(() => undefined);
}

export async function forgetPayAway(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
}

/** The place this person was paying at when the app was closed, and the purchase where they were buying, or null: none
 *  kept, somebody else's, or too old. */
export async function payAwayPlace(userId: string, now: number = Date.now()): Promise<{ gymId: string; purchaseId: string | null } | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw === null) return null;
    const kept = phonePayAwaySchema.safeParse(JSON.parse(raw));
    if (!kept.success || kept.data.userId !== userId || now - kept.data.at > PAY_AWAY_MS || kept.data.at > now) {
      await forgetPayAway();
      return null;
    }
    return { gymId: kept.data.gymId, purchaseId: kept.data.purchaseId };
  } catch {
    return null;
  }
}
