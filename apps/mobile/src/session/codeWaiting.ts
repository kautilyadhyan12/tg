import { PHONE_CODE_WAITING_SECONDS, phoneCodeWaitingSchema, type PhoneCodeWaiting } from "@app/shared";
import type { KeyStore } from "./session";

/** The note is still worth reopening on: written before now, and inside the code's life. */
export function stillWaiting(note: PhoneCodeWaiting, now: number): boolean {
  return note.sentAt <= now && now - note.sentAt < PHONE_CODE_WAITING_SECONDS * 1000;
}

/** The code step to reopen on, or null; a note past its time, or one that cannot be read, is removed. */
export async function readWaiting(store: KeyStore, now: number): Promise<PhoneCodeWaiting | null> {
  try {
    const written = await store.read();
    if (written === null || written === "") return null;
    const parsed = phoneCodeWaitingSchema.safeParse(JSON.parse(written));
    if (parsed.success && stillWaiting(parsed.data, now)) return parsed.data;
    await store.clear();
    return null;
  } catch {
    return null;
  }
}

export async function keepWaiting(store: KeyStore, note: PhoneCodeWaiting): Promise<void> {
  try {
    await store.write(JSON.stringify(note));
  } catch {
    // Not kept: the screen still works; only a reopen after Android closed the app starts again.
  }
}

export async function forgetWaiting(store: KeyStore): Promise<void> {
  try {
    await store.clear();
  } catch {
    // Read again on the next opening, and removed there once its time is past.
  }
}
