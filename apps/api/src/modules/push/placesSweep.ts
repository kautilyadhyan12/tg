// A PLACE IN A CLASS OR AN EVENT, TOLD TO THE PHONE (ROADMAP Stage 5 item 18b-ii-a). Every minute the
// worker reads the class bookings and event places owed a notice: "you have a place" for somebody
// moved off the waitlist, "a place is free" for everybody waiting once a free place is no longer
// handed over by itself. Each is claimed on its row before anything is sent, so a second run sends
// nothing twice, and comes off it only once a phone has it (or nothing was true to send), so a run that
// stops halfway loses nothing. Each is read again as the person's own Classes or Events page reads it just
// before it goes: a place since taken, a class started or cancelled, a person who left the waitlist
// or the gym, is told to nobody. These go at any hour (Kd, 2026-11-03): they are about the person's
// own place and only matter now. A free place is told to the same person at most once an hour a class.
import {
  GYM_PLACES_CHANNEL,
  PLACE_FREE_AGAIN_MINUTES,
  PUSH_WITHIN_HOURS,
  gymClockFormatSchema,
  gymMessageDayNumber,
  placeNotification,
  reminderWhen,
} from "@app/shared";
import type { Sql } from "postgres";
import { getBooking } from "../orgs/classes/bookingsService.js";
import { memberPlace } from "../orgs/events/places.js";
import { OrgsError } from "../orgs/service.js";
import type { PushSender } from "./fcm.adapter.js";
import * as places from "./placesRepo.js";
import * as repo from "./repo.js";

export interface PlaceSweepResult {
  sent: number;
  skipped: number;
  waiting: number;
  failed: number;
}

const BATCH = 500;
const PAGE = 500;
const MAX_PAGES = 40;
const AT_ONCE = 10;

/** A day on a clock named by an IANA zone, as `YYYY-MM-DD`, or null when the zone cannot be read. */
export function dayIn(zone: string, now: Date): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const day = `${part("year")}-${part("month")}-${part("day")}`;
    return gymMessageDayNumber(day) === null ? null : day;
  } catch {
    return null;
  }
}

/** What one owed notice says, if it is still true now: the class's or event's name and start on the
 *  gym's clock, and for a class the week of the Classes page that holds it. */
interface StillTrue {
  name: string;
  day: string;
  minute: number;
}

async function stillTrue(sql: Sql, place: places.DuePlace, now: Date): Promise<StillTrue | null> {
  if (place.what === "class") {
    let view;
    try {
      view = await getBooking({ sql, now: () => now }, place.userId, place.gymId, place.subjectId, () => Promise.resolve(true));
    } catch (err) {
      if (err instanceof OrgsError) return null;
      throw err;
    }
    if (view === null || view.cancelled || Date.parse(view.startsAt) <= now.getTime()) return null;
    const ok = place.due === "yours" ? view.mine?.status === "booked" : view.can.claim;
    return ok ? { name: view.className, day: view.localDate, minute: view.localStartMinute } : null;
  }
  const read = await memberPlace(sql, place.gymId, place.userId, place.subjectId, now);
  if (read === null || read.event.cancelled || read.event.startsAt.getTime() <= now.getTime()) return null;
  const ok = place.due === "yours" ? read.going.mine?.status === "coming" : read.going.can.claim;
  return ok ? { name: read.event.name, day: read.event.startsOn, minute: read.event.startMinute } : null;
}

export async function sendPlaceNotifications(deps: {
  sql: Sql;
  sender: PushSender;
  now: () => Date;
  /** For tests on a shared database. */
  gymIds?: readonly string[];
  sizes?: { batch: number; page: number };
  /** Told of a failure the run carried on past: the worker logs it. */
  onError?: (err: unknown) => void;
}): Promise<PlaceSweepResult> {
  const { sql, sender } = deps;
  const batch = deps.sizes?.batch ?? BATCH;
  const page = deps.sizes?.page ?? PAGE;
  const now = deps.now();
  const since = new Date(now.getTime() - PUSH_WITHIN_HOURS * 3_600_000);
  const toldSince = new Date(now.getTime() - PLACE_FREE_AGAIN_MINUTES * 60_000);
  const claimedBefore = new Date(now.getTime() - repo.PUSH_CLAIM_MINUTES * 60_000);
  const result: PlaceSweepResult = { sent: 0, skipped: 0, waiting: 0, failed: 0 };

  const onError = deps.onError ?? (() => undefined);
  // `reached`: some phone has it, so it is never put back to be sent again. `again`: Firebase did not
  // answer for any phone, so the next run tries again.
  const tell = async (place: places.DuePlace, state: { reached: boolean; again: boolean }): Promise<void> => {
    const tokens = place.stale ? [] : await repo.liveTokens(sql, place.userId, now);
    const today = dayIn(place.gymZone, now);
    const clock = gymClockFormatSchema.safeParse(place.clockFormat);
    const facts = tokens.length === 0 || today === null || !clock.success ? null : await stillTrue(sql, place, now);
    const when = facts === null || today === null || !clock.success ? null : reminderWhen(today, facts.day, facts.minute, clock.data);
    if (facts === null || when === null) {
      result.skipped += 1;
      return;
    }
    const { title, body } = placeNotification({ notice: place.due, gymName: place.gymName, name: facts.name, when });
    let failed = false;
    for (const token of tokens) {
      const sent = await sender.send({
        token,
        userId: place.userId,
        title,
        body,
        tag: `place:${place.subjectId}`,
        channelId: GYM_PLACES_CHANNEL.id,
        data: { kind: "gym_place", gymId: place.gymId, what: place.what, id: place.subjectId, day: facts.day },
      });
      if (sent === "sent") {
        result.sent += 1;
        state.reached = true;
      } else if (sent === "gone") {
        await repo.forgetToken(sql, place.userId, token);
      } else {
        result.failed += 1;
        failed = true;
      }
    }
    state.again = failed && !state.reached;
  };

  const handle = async (place: places.DuePlace): Promise<void> => {
    const claimedAt = deps.now();
    if (!(await places.claimDue(sql, place, { claimedAt, claimedBefore, toldSince }))) return;
    const state = { reached: false, again: false };
    try {
      await tell(place, state);
    } catch (err) {
      // A failure after the claim (a dropped connection): told to the worker, put back for the next run
      // unless a phone already has it, and the rest of this run goes on.
      onError(err);
      result.failed += 1;
      state.again = !state.reached;
    }
    if (state.again) await places.unclaimDue(sql, place, claimedAt).catch(onError);
    else await places.settleDue(sql, place, claimedAt, state.reached ? now : null).catch(onError);
  };

  let after: places.DueMark | null = null;
  let taken = 0;
  for (let pages = 0; pages < MAX_PAGES && taken < batch; pages += 1) {
    const rows = await places.duePlaces(sql, { since, toldSince, claimedBefore, limit: page, after, gymIds: deps.gymIds });
    const due: places.DuePlace[] = [];
    for (const place of rows) {
      // Told about this class within the hour: another free place in it waits on its row for the hour
      // to pass, and is read again then.
      if (place.due === "free" && place.toldLately) result.waiting += 1;
      else if (taken < batch) {
        due.push(place);
        taken += 1;
      }
    }
    for (let i = 0; i < due.length; i += AT_ONCE) await Promise.all(due.slice(i, i + AT_ONCE).map(handle));
    const last = rows.at(-1);
    if (last === undefined || rows.length < page) break;
    after = { at: last.dueAt, rowId: last.rowId };
  }
  return result;
}
