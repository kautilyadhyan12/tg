// THE CLASS REMINDERS DUE AT ONE GYM NOW (spec Part 3 §16.2; ROADMAP 20b-iii).
//
// `classReminderDue` in `@app/shared` decides, a booking at a time; this gathers what it
// reads and makes the words. `send.ts` writes what this returns with the gym's row held,
// from a second read made under it.
import {
  GYM_MESSAGE_DAY_ENDS_HOUR,
  GYM_MESSAGE_DAY_STARTS_HOUR,
  GYM_MESSAGE_REMINDER_LOOK_AHEAD_HOURS,
  automaticMessage,
  classReminderDue,
  gymMessageSettingsFrom,
  reminderWhen,
} from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import * as remindersRepo from "./remindersRepo.js";
import * as repo from "./repo.js";
import { settingRows } from "./settingsRepo.js";

/** The reminders to write now. A gym that is closed, on no plan, asleep or has the
 *  reminder switched off is not read past its own row and its settings. */
export async function remindersForGym(sql: Sql | TransactionSql, gymId: string, now: Date): Promise<repo.NewMessage[]> {
  const gym = await repo.gymNow(sql, gymId, now);
  if (gym === null || !gym.open || !gym.live || gym.hour < GYM_MESSAGE_DAY_STARTS_HOUR || gym.hour >= GYM_MESSAGE_DAY_ENDS_HOUR) return [];
  const settings = gymMessageSettingsFrom(await settingRows(sql, gymId));
  if (!settings.on.class_reminder) return [];
  const bookings = await remindersRepo.bookingsStartingSoon(sql, gymId, now, GYM_MESSAGE_REMINDER_LOOK_AHEAD_HOURS);
  if (bookings.length === 0) return [];
  const sent = await remindersRepo.remindersSent(sql, gymId, [...new Set(bookings.map((b) => b.userId))]);
  const due: repo.NewMessage[] = [];
  for (const b of bookings) {
    const answer = classReminderDue({
      gym: { open: gym.open, live: gym.live, on: settings.on.class_reminder, hours: settings.numbers.classReminderHours, today: gym.today, minute: gym.minute },
      person: { member: b.member, former: b.former, off: b.off },
      booking: { what: b.what, id: b.id, status: b.status, classStatus: b.classStatus, day: b.day, startMinute: b.startMinute, bookedDay: b.bookedDay, bookedMinute: b.bookedMinute },
      sent: sent.get(b.userId) ?? [],
    });
    if (!answer.send) continue;
    const when = reminderWhen(gym.today, b.day, b.startMinute, gym.clockFormat);
    if (when === null) continue;
    const body = automaticMessage(
      { kind: "class_reminder", occasion: answer.occasion, reminder: { what: b.what, title: b.title, when, online: b.online } },
      gym.name,
      b.displayName,
      settings.ownLines.class_reminder ?? null,
    );
    if (body === null) continue;
    due.push({ gymId, userId: b.userId, kind: "class_reminder", occasion: answer.occasion, body, gymDay: gym.today });
  }
  return due;
}
