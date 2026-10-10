// A GYM'S SETTINGS FOR ITS AUTOMATIC MESSAGES, for staff holding `org.manage` (spec Part 3
// §16.2; ROADMAP 20b-i). Gates in CLAUDE.md §4's order: privilege (and a live plan, for the
// save), then the rate limit, then the work.
import {
  GYM_MESSAGE_CHECK_IN_DAYS,
  GYM_MESSAGE_OWN_LINE_WORDS,
  GYM_MESSAGE_SETTING_KINDS,
  gymMessageSettingsFrom,
  gymMessageSettingsResponseSchema,
  ownLineBadWords,
  ownLineProblem,
  tidyOwnLine,
  type GymMessageSettingRow,
  type GymMessageSettingsRequest,
  type GymMessageSettingsResponse,
} from "@app/shared";
import { insertAudit, lockOrgRow } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { badWordsIn } from "../posts/badWords.js";
import { forgetDay } from "./repo.js";
import type { Limit, MessagesDeps } from "./service.js";
import * as settingsRepo from "./settingsRepo.js";

const notFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");

async function readSettings(deps: MessagesDeps, gymId: string): Promise<GymMessageSettingsResponse> {
  const now = deps.now();
  const today = await settingsRepo.gymToday(deps.sql, gymId, now);
  if (today === null) throw notFound();
  const [rows, checkIn] = await Promise.all([
    settingsRepo.settingRows(deps.sql, gymId),
    settingsRepo.checkedInLately(deps.sql, gymId, today, GYM_MESSAGE_CHECK_IN_DAYS),
  ]);
  const settings = gymMessageSettingsFrom(rows);
  return gymMessageSettingsResponseSchema.parse({
    messages: GYM_MESSAGE_SETTING_KINDS.map((kind) => ({ kind, on: settings.on[kind], ownLine: settings.ownLines[kind] ?? null })),
    missYouDays: settings.numbers.missYouDays,
    milestones: settings.numbers.milestones,
    checkIn,
  });
}

/** The gym's switches, numbers and own lines, with whether it uses check-in. */
export async function getMessageSettings(deps: MessagesDeps, staffId: string, gymId: string, limit: Limit): Promise<GymMessageSettingsResponse | null> {
  await requirePrivilege(deps, gymId, staffId, "org.manage");
  if (!(await limit())) return null;
  return await readSettings(deps, gymId);
}

/** Saves all of them. They are read at each run of the sender, so they hold from the next
 *  one; nothing already sent is touched. The audit note names the kinds that changed and
 *  never a line's words. */
export async function setMessageSettings(
  deps: MessagesDeps,
  staffId: string,
  gymId: string,
  body: GymMessageSettingsRequest,
  limit: Limit,
): Promise<GymMessageSettingsResponse | null> {
  await requireWritablePrivilege(deps, gymId, staffId, "org.manage");
  if (!(await limit())) return null;
  const rows: GymMessageSettingRow[] = body.messages.map((message) => {
    const line = tidyOwnLine(message.ownLine ?? "");
    const problem = ownLineProblem(line);
    if (problem !== null) throw new OrgsError(400, `message_line_${problem}`, GYM_MESSAGE_OWN_LINE_WORDS[problem]);
    const words = badWordsIn(line);
    if (words.length > 0) throw new OrgsError(400, "message_line_bad_words", ownLineBadWords(words));
    return {
      kind: message.kind,
      on: message.on,
      ownLine: line === "" ? null : line,
      days: message.kind === "miss_you" ? body.missYouDays : null,
      milestones: message.kind === "milestone" ? [...body.milestones].sort((a, b) => a - b) : null,
    };
  });
  const now = deps.now();
  await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const before = new Map((await settingsRepo.settingRows(tx, gymId)).map((row) => [row.kind, row]));
    const start = gymMessageSettingsFrom([]);
    const changed = rows.filter((row) => {
      const was = before.get(row.kind);
      const wasRow: GymMessageSettingRow = was ?? {
        kind: row.kind,
        on: start.on[row.kind],
        ownLine: null,
        days: row.kind === "miss_you" ? start.numbers.missYouDays : null,
        milestones: row.kind === "milestone" ? start.numbers.milestones : null,
      };
      return (
        wasRow.on !== row.on ||
        wasRow.ownLine !== row.ownLine ||
        wasRow.days !== row.days ||
        (wasRow.milestones ?? []).join(",") !== (row.milestones ?? []).join(",")
      );
    });
    if (changed.length === 0) return;
    await settingsRepo.writeSettingRows(tx, gymId, changed, now);
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
