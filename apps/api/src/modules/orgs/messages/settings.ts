// A GYM'S SETTINGS FOR ITS AUTOMATIC MESSAGES, for staff holding `org.manage` (spec Part 3
// §16.2; ROADMAP 20b-i, 20b-ii). Gates in CLAUDE.md §4's order: privilege (and a live plan, for the
// save), then the rate limit, then the work.
import {
  GYM_MESSAGE_CHECK_IN_DAYS,
  GYM_MESSAGE_DAYS_OF,
  GYM_MESSAGE_OWN_LINE_WORDS,
  GYM_MESSAGE_SETTING_KINDS,
  gymMessageSettingsFrom,
  gymMessageSettingsResponseSchema,
  ownLineBadWords,
  ownLineProblem,
  SETTINGS_CHANGED_WORDS,
  tidyOwnLine,
  type GymMessageKind,
  type GymMessageNumbers,
  type GymMessageSettingRow,
  type GymMessageSettingsRequest,
  type GymMessageSettingsResponse,
} from "@app/shared";
import { insertAudit, lockOrgRow } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { badWordsIn } from "../posts/badWords.js";
import { gymMoney, priceListUse } from "./membershipsRepo.js";
import { hasBookings } from "./remindersRepo.js";
import { forgetDay, settingsStamp } from "./repo.js";
import type { Limit, MessagesDeps } from "./service.js";
import * as settingsRepo from "./settingsRepo.js";

/** Said when Ask for a review is switched on with no link to send. */
export const REVIEW_LINK_MISSING = "Add your review link before you switch on Ask for a review.";

const notFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");

/** The number of days a kind keeps in its row, from the numbers named; null for a kind
 *  with none. */
function daysOf(kind: GymMessageKind, numbers: Pick<GymMessageNumbers, "trialCheckInDay" | "trialEndingDays" | "membershipEndingDays" | "missYouDays">): number | null {
  if (kind === "trial_check_in" || kind === "trial_ending" || kind === "membership_ending" || kind === "miss_you") return numbers[GYM_MESSAGE_DAYS_OF[kind]];
  return null;
}

async function readSettings(deps: MessagesDeps, gymId: string): Promise<GymMessageSettingsResponse> {
  const now = deps.now();
  const today = await settingsRepo.gymToday(deps.sql, gymId, now);
  if (today === null) throw notFound();
  const [rows, checkIn, list, money, bookings, version] = await Promise.all([
    settingsRepo.settingRows(deps.sql, gymId),
    settingsRepo.checkedInLately(deps.sql, gymId, today, GYM_MESSAGE_CHECK_IN_DAYS),
    priceListUse(deps.sql, gymId),
    gymMoney(deps.sql, gymId, today),
    hasBookings(deps.sql, gymId, today),
    settingsStamp(deps.sql, gymId),
  ]);
  const settings = gymMessageSettingsFrom(rows);
  return gymMessageSettingsResponseSchema.parse({
    messages: GYM_MESSAGE_SETTING_KINDS.map((kind) => ({ kind, on: settings.on[kind], ownLine: settings.ownLines[kind] ?? null })),
    missYouDays: settings.numbers.missYouDays,
    milestones: settings.numbers.milestones,
    checkIn,
    trialCheckInDay: settings.numbers.trialCheckInDay,
    trialEndingDays: settings.numbers.trialEndingDays,
    membershipEndingDays: settings.numbers.membershipEndingDays,
    trialOnList: list.trialOnList,
    priceList: list.priceList,
    payments: money.takesPayments,
    billsOverdueDays: money.billsOverdueAfterDays,
    classReminderHours: settings.numbers.classReminderHours,
    bookings,
    reviewVisits: settings.numbers.reviewVisits,
    reviewLink: settings.reviewLink,
    version,
  });
}

/** The gym's switches, numbers and own lines, with whether it uses check-in. */
export async function getMessageSettings(deps: MessagesDeps, staffId: string, gymId: string, limit: Limit): Promise<GymMessageSettingsResponse | null> {
  await requirePrivilege(deps, gymId, staffId, "org.manage");
  if (!(await limit())) return null;
  return await readSettings(deps, gymId);
}

/** Saves the kinds sent. They are read at each run of the sender, so they hold from the
 *  next one; nothing already sent is touched. A kind or a number the page did not send
 *  keeps what it has. The audit note names the kinds that changed and never a line's words. */
export async function setMessageSettings(
  deps: MessagesDeps,
  staffId: string,
  gymId: string,
  body: GymMessageSettingsRequest,
  limit: Limit,
): Promise<GymMessageSettingsResponse | null> {
  await requireWritablePrivilege(deps, gymId, staffId, "org.manage");
  if (!(await limit())) return null;
  const checked: { kind: GymMessageKind; on: boolean; ownLine: string | null }[] = body.messages.map((message) => {
    const line = tidyOwnLine(message.ownLine ?? "");
    const problem = ownLineProblem(line);
    if (problem !== null) throw new OrgsError(400, `message_line_${problem}`, GYM_MESSAGE_OWN_LINE_WORDS[problem]);
    const words = badWordsIn(line);
    if (words.length > 0) throw new OrgsError(400, "message_line_bad_words", ownLineBadWords(words));
    return { kind: message.kind, on: message.on, ownLine: line === "" ? null : line };
  });
  await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    // Saved since the page read them (another tab, or another manager): refused, so this
    // save never puts back what that one changed.
    if ((await settingsStamp(tx, gymId)) !== body.version) throw new OrgsError(409, "message_settings_changed", SETTINGS_CHANGED_WORDS);
    const beforeRows = await settingsRepo.settingRows(tx, gymId);
    const before = new Map(beforeRows.map((row) => [row.kind, row]));
    const kept = gymMessageSettingsFrom(beforeRows).numbers;
    const numbers = {
      missYouDays: body.missYouDays,
      trialCheckInDay: body.trialCheckInDay ?? kept.trialCheckInDay,
      trialEndingDays: body.trialEndingDays ?? kept.trialEndingDays,
      membershipEndingDays: body.membershipEndingDays ?? kept.membershipEndingDays,
    };
    const classReminderHours = body.classReminderHours ?? kept.classReminderHours;
    // Ask for a review: its link and number, sent or kept. A page that sends either without
    // the message itself keeps its switch and its line as they are.
    const wasReview = before.get("review");
    const reviewVisits = body.reviewVisits ?? kept.reviewVisits;
    const reviewLink = body.reviewLink === undefined ? (wasReview?.link ?? null) : body.reviewLink;
    if (!checked.some((message) => message.kind === "review") && (body.reviewVisits !== undefined || body.reviewLink !== undefined)) {
      checked.push({ kind: "review", on: wasReview?.on ?? false, ownLine: wasReview?.ownLine ?? null });
    }
    // The switch alone never sends: a member's button needs the link.
    if (checked.some((message) => message.kind === "review" && message.on) && reviewLink === null) {
      throw new OrgsError(400, "review_link_missing", REVIEW_LINK_MISSING);
    }
    const rows: GymMessageSettingRow[] = checked.map((message) => ({
      ...message,
      days: daysOf(message.kind, numbers),
      milestones: message.kind === "milestone" ? [...body.milestones].sort((a, b) => a - b) : null,
      hours: message.kind === "class_reminder" ? classReminderHours : null,
      visits: message.kind === "review" ? reviewVisits : null,
      link: message.kind === "review" ? reviewLink : null,
    }));
    const start = gymMessageSettingsFrom([]);
    const changed = rows.filter((row) => {
      const was = before.get(row.kind);
      const wasRow: GymMessageSettingRow = was ?? {
        kind: row.kind,
        on: start.on[row.kind],
        ownLine: null,
        days: daysOf(row.kind, start.numbers),
        milestones: row.kind === "milestone" ? start.numbers.milestones : null,
        hours: row.kind === "class_reminder" ? start.numbers.classReminderHours : null,
        visits: row.kind === "review" ? start.numbers.reviewVisits : null,
        link: null,
      };
      return (
        wasRow.on !== row.on ||
        wasRow.ownLine !== row.ownLine ||
        wasRow.days !== row.days ||
        wasRow.hours !== row.hours ||
        wasRow.visits !== row.visits ||
        wasRow.link !== row.link ||
        (wasRow.milestones ?? []).join(",") !== (row.milestones ?? []).join(",")
      );
    });
    if (changed.length === 0) return;
    await settingsRepo.writeSettingRows(tx, gymId, changed);
    // The next run of the sender reads everybody again, by the new settings.
    await forgetDay(tx, gymId);
    await insertAudit(tx, {
      actorUserId: staffId,
      gymId,
      action: "org.message_settings_changed",
      targetType: "gym",
      targetId: gymId,
      meta: Object.fromEntries(changed.map((row): [string, string] => [row.kind, row.on ? "on" : "off"])),
    });
  });
  return await readSettings(deps, gymId);
}
