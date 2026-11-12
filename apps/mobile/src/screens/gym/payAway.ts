import * as SecureStore from "expo-secure-store";
import { APP_PAYMENT_LIMITS, phonePayAwaySchema } from "@app/shared";

// Pay on My membership (ROADMAP Stage 5 item 20f): while Square's page is in its tab over the app, Android may close the
// app to free memory (seen on Kd's phone, 2026-11-12: closed 5 s after the tab opened). The place being paid is kept on the
// phone, for whoever is signed in, so the app opens that place's My membership when it starts again: there the page is
// ended and how it went is said. Kept no longer than a page can be open. A line being bought (20g) keeps its purchase too,
// and the app opens that place's Buy instead, where that page is ended.

const KEY = "pay-away";
export const PAY_AWAY_MS = APP_PAYMENT_LIMITS.openMinutes * 60_000;

export async function keepPayAway(userId: string, gymId: string, pageId: string, now: number = Date.now(), purchaseId: string | null = null): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify({ userId, gymId, at: now, purchaseId, pageId })).catch(() => undefined);
}

/** Lets go of what is kept. With `pageId`, only where it is that page's (20h): an older page ending, told by Payment received
 *  while the member is on another page in the tab, never lets go of the one they are on. One kept before 20h names no
 *  page, and goes with any. */
export async function forgetPayAway(pageId: string | null = null): Promise<void> {
  try {
    if (pageId !== null) {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw === null) return;
      const kept = phonePayAwaySchema.safeParse(JSON.parse(raw));
      const named = kept.success ? kept.data.pageId : null;
      if (named !== null && named !== pageId) return;
    }
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Nothing kept, or nothing to read: nothing to let go.
  }
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
