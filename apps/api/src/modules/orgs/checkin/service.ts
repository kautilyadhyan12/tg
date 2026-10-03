// CHECK-IN AT THE FRONT DESK, the server (spec Part 3 §12; ROADMAP 16a).
//
// The worst thing this could do to a real person: give a stranger a green tick on somebody
// else's pass, or let whoever stands at an unattended desk tablet read the gym's members.
// So the gym always comes from the device's key and never from the pass; a pass is signed,
// lives one window and the next, and works once; and a device's key opens the scan and
// nothing else. A desk is told a name only on a green tick.
import { createHash, randomBytes } from "node:crypto";
import type { Sql } from "postgres";
import {
  CHECKIN_DEVICES_MAX,
  CHECKIN_KEY_TAG_MISSES,
  CHECKIN_KEY_TAG_PAUSE_MINUTES,
  CHECKIN_KEY_TAGS_PER_MINUTE,
  CHECKIN_LINK_TTL_MINUTES,
  CHECKIN_LOG_LIMIT,
  CHECKIN_SEARCH_LIMIT,
  CHECKIN_WORDS,
  STAFF_CHECKIN_WORDS,
  checkinDeviceLinkResponseSchema,
  checkinDeviceResponseSchema,
  checkinDevicesResponseSchema,
  checkinLogResponseSchema,
  checkinPassResponseSchema,
  checkinPeopleResponseSchema,
  checkinScanResponseSchema,
  claimCheckinDeviceResponseSchema,
  staffCheckinResponseSchema,
  type CheckinDevice,
  type CheckinDeviceLinkResponse,
  type CheckinDeviceResponse,
  type CheckinDevicesResponse,
  type CheckinLogResponse,
  type CheckinNotice,
  type CheckinPassResponse,
  type CheckinPeopleResponse,
  type CheckinPersonFound,
  type CheckinPick,
  type CheckinScanResponse,
  type ClaimCheckinDeviceResponse,
  type GymClockFormat,
  type StaffCheckinResponse,
} from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { onAttendanceMarked } from "../../gamification/service.js";
import { getUserSyncContext } from "../../users/service.js";
import { insertAudit, lockOrgRow } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { membersAgainstList } from "../memberList/repo.js";
import { sameName } from "../memberList/samePerson.js";
import { currentRecordOf } from "../memberList/whose.js";
import { looksLikePass, makePass, passWindow, readPass, windowEndsAt } from "./pass.js";
import * as repo from "./repo.js";
import { decideScan, type ScanPerson, type ScanRead } from "./scanRule.js";

export interface CheckinDeps {
  sql: Sql;
  redis: RedisLike;
  now: () => Date;
  /** Signs passes; null in production without `CHECKIN_PASS_SECRET` (passes are off). */
  passKey: Buffer | null;
  webOrigin: string;
  log: { warn: (obj: object, msg: string) => void };
}

type Limit = () => Promise<boolean>;

/** A pass is spent for a little longer than it can be read (its window and the next). */
const USED_PASS_TTL_S = 90;
export const DEVICE_SCANS_PER_MINUTE = 120;

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
/** 32 random bytes, base64url: 43 characters. */
const randomToken = (): string => randomBytes(32).toString("base64url");

const deviceNotFound = (): OrgsError => new OrgsError(404, "device_not_found", CHECKIN_WORDS.device_not_found);

// A device's key tags: this minute's count, the misses of the last 10 minutes, and the
// pause they lead to (RULINGS 2026-10-02), each kept by device in Redis.
const tagCountKey = (deviceId: string): string => `rl:checkin_tags_device:${deviceId}`;
const tagMissKey = (deviceId: string): string => `checkin:tag_misses:${deviceId}`;
const tagPauseKey = (deviceId: string): string => `checkin:tag_pause:${deviceId}`;

/** Until when a device takes no key tags, or null; Redis down reads as not paused. */
async function pausedUntil(deps: Pick<CheckinDeps, "redis">, deviceId: string): Promise<string | null> {
  const until = await deps.redis.get(tagPauseKey(deviceId));
  return until !== null && !Number.isNaN(Date.parse(until)) ? until : null;
}

async function toDevice(deps: Pick<CheckinDeps, "redis">, row: repo.DeviceRow): Promise<CheckinDevice> {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    linkExpiresAt: row.linkExpiresAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    keyTagsPausedUntil: row.state === "on" ? await pausedUntil(deps, row.id) : null,
  };
}

const linkFor = (deps: Pick<CheckinDeps, "webOrigin">, token: string): string =>
  // After the `#`, so the token never reaches a server log or another site.
  `${deps.webOrigin}/check-in/setup#${token}`;

// ── THE MEMBER'S PASS ──

export async function getPass(deps: CheckinDeps, limit: Limit, userId: string): Promise<CheckinPassResponse | null> {
  if (!(await limit())) return null;
  if (deps.passKey === null) throw new OrgsError(503, "passes_off", CHECKIN_WORDS.passes_off);
  const window = passWindow(deps.now());
  return checkinPassResponseSchema.parse({
    pass: makePass(deps.passKey, userId, window),
    refreshAt: windowEndsAt(window).toISOString(),
  });
}

// ── DEVICES (Settings → Check-in devices) ──

export async function listDevices(
  deps: CheckinDeps,
  userId: string,
  gymId: string,
  limit: Limit,
): Promise<CheckinDevicesResponse | null> {
  await requirePrivilege(deps, gymId, userId, "org.manage");
  if (!(await limit())) return null;
  const rows = await repo.devicesFor(deps.sql, gymId);
  return checkinDevicesResponseSchema.parse({ devices: await Promise.all(rows.map((row) => toDevice(deps, row))) });
}

export async function addDevice(
  deps: CheckinDeps,
  userId: string,
  gymId: string,
  name: string,
  limit: Limit,
): Promise<CheckinDeviceLinkResponse | null> {
  await requireWritablePrivilege(deps, gymId, userId, "org.manage");
  if (!(await limit())) return null;
  const token = randomToken();
  const device = await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    if ((await repo.countDevices(tx, gymId)) >= CHECKIN_DEVICES_MAX) {
      throw new OrgsError(409, "too_many_devices", CHECKIN_WORDS.too_many_devices);
    }
    const row = await repo.insertDevice(tx, {
      gymId,
      name,
      linkHash: sha256(token),
      linkMinutes: CHECKIN_LINK_TTL_MINUTES,
      createdBy: userId,
    });
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.checkin_device_added",
      targetType: "checkin_device",
      targetId: row.id,
      meta: {},
    });
    return row;
  });
  return checkinDeviceLinkResponseSchema.parse({ device: await toDevice(deps, device), link: linkFor(deps, token) });
}

/** A new one-time link for a device (its browser forgot its key, or it is a new tablet):
 *  the old key stops working now. */
export async function renewDeviceLink(
  deps: CheckinDeps,
  userId: string,
  gymId: string,
  deviceId: string,
  limit: Limit,
): Promise<CheckinDeviceLinkResponse | null> {
  await requireWritablePrivilege(deps, gymId, userId, "org.manage");
  if (!(await limit())) return null;
  const token = randomToken();
  const device = await deps.sql.begin(async (tx) => {
    const row = await repo.renewLink(tx, { gymId, deviceId, linkHash: sha256(token), linkMinutes: CHECKIN_LINK_TTL_MINUTES });
    if (row === null) throw deviceNotFound();
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.checkin_device_link",
      targetType: "checkin_device",
      targetId: deviceId,
      meta: {},
    });
    return row;
  });
  return checkinDeviceLinkResponseSchema.parse({ device: await toDevice(deps, device), link: linkFor(deps, token) });
}

/** Switched off at once. Not behind the plan: an owner whose plan lapsed can still stop a
 *  lost tablet. */
export async function switchOffDevice(
  deps: CheckinDeps,
  userId: string,
  gymId: string,
  deviceId: string,
  limit: Limit,
): Promise<CheckinDeviceResponse | null> {
  await requirePrivilege(deps, gymId, userId, "org.manage");
  if (!(await limit())) return null;
  const device = await deps.sql.begin(async (tx) => {
    const row = await repo.switchOff(tx, gymId, deviceId);
    if (row === null) throw deviceNotFound();
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.checkin_device_off",
      targetType: "checkin_device",
      targetId: deviceId,
      meta: {},
    });
    return row;
  });
  return checkinDeviceResponseSchema.parse({ device: await toDevice(deps, device) });
}

// ── THE DESK ──

/** The tablet opens its link once and is given its key. */
export async function claimDevice(
  deps: CheckinDeps,
  token: string,
): Promise<{ key: string; answer: ClaimCheckinDeviceResponse }> {
  const key = randomToken();
  const claimed = await repo.claimLink(deps.sql, sha256(token), sha256(key));
  if (claimed === null) throw new OrgsError(404, "link_not_valid", CHECKIN_WORDS.link_not_valid);
  return { key, answer: claimCheckinDeviceResponseSchema.parse(claimed) };
}

/** The device a key belongs to, or null: a key of the wrong shape is never looked up. */
export async function deviceFor(deps: Pick<CheckinDeps, "sql">, key: string | undefined): Promise<repo.DeskDevice | null> {
  if (key === undefined || !/^[A-Za-z0-9_-]{43}$/.test(key)) return null;
  return await repo.deviceByKey(deps.sql, sha256(key));
}

/** One device's scans this minute; Redis down lets the scan through with a log, as every
 *  limiter here does. */
export function deviceRoom(deps: Pick<CheckinDeps, "redis" | "log">, device: repo.DeskDevice): Limit {
  return async () => {
    const count = await deps.redis.incrWithTtl(`rl:checkin_scan_device:${device.deviceId}`, 60);
    if (count === null) {
      deps.log.warn({ event: "ratelimit.open_redis_down", limiter: "checkin_scan_device" }, "rate limiter failing open (Redis unavailable)");
      return true;
    }
    return count <= DEVICE_SCANS_PER_MINUTE;
  };
}

/** Whether this device may read a key tag now: not while paused, and 20 a minute. Redis
 *  down lets it through with a log, as every limiter here does. */
async function keyTagRoom(deps: CheckinDeps, device: repo.DeskDevice): Promise<void> {
  if ((await pausedUntil(deps, device.deviceId)) !== null) {
    throw new OrgsError(429, "key_tags_paused", CHECKIN_WORDS.key_tags_paused);
  }
  const count = await deps.redis.incrWithTtl(tagCountKey(device.deviceId), 60);
  if (count === null) {
    deps.log.warn({ event: "ratelimit.open_redis_down", limiter: "checkin_key_tags" }, "rate limiter failing open (Redis unavailable)");
    return;
  }
  if (count > CHECKIN_KEY_TAGS_PER_MINUTE) throw new OrgsError(429, "key_tags_slow", CHECKIN_WORDS.key_tags_slow);
}

/** A key tag nobody has: the tenth in 10 minutes pauses the device's key tags for 10. */
async function keyTagMissed(deps: CheckinDeps, device: repo.DeskDevice): Promise<void> {
  const misses = await deps.redis.incrWithTtl(tagMissKey(device.deviceId), CHECKIN_KEY_TAG_PAUSE_MINUTES * 60);
  if (misses === null || misses < CHECKIN_KEY_TAG_MISSES) return;
  const until = new Date(deps.now().getTime() + CHECKIN_KEY_TAG_PAUSE_MINUTES * 60_000);
  await deps.redis.setex(tagPauseKey(device.deviceId), CHECKIN_KEY_TAG_PAUSE_MINUTES * 60, until.toISOString());
  await deps.redis.del(tagMissKey(device.deviceId));
  deps.log.warn({ event: "checkin.key_tags_paused", gymId: device.gymId, deviceId: device.deviceId }, "a desk's key tags paused after too many unknown numbers");
}

interface Named {
  person: ScanPerson;
  who: repo.Who | null;
  name: string;
  notice: CheckinNotice;
}

const NOBODY: Named = { person: { kind: "not_a_member" }, who: null, name: "", notice: { status: null, payment: null, onList: false } };
const AMBIGUOUS: Named = { ...NOBODY, person: { kind: "ambiguous" } };

/** Who an app account is at this gym: a live member (with the record the list says is
 *  theirs, if any), or else the person on one of its current records by their proved
 *  email; nobody otherwise. */
async function namedByAccount(sql: Sql, gymId: string, userId: string): Promise<Named> {
  const account = await repo.recordsByProvedEmail(sql, gymId, userId);
  if (account === null) return NOBODY;
  const member = (await membersAgainstList(sql, gymId, { email: null, phone: null, userIds: [userId] })).find(
    (row) => row.userId === userId,
  );
  if (member !== undefined) {
    const entryId = currentRecordOf(member);
    const words = entryId === null ? null : await repo.recordWords(sql, gymId, entryId);
    return {
      person: { kind: "member" },
      who: { userId, entryId: words?.id ?? null },
      name: words?.fullName.trim() || account.displayName,
      notice: { status: words?.status ?? null, payment: words?.payment ?? null, onList: member.onList },
    };
  }
  const records = account.records;
  if (records.length === 0) return NOBODY;
  // A household on one address: the record with the account's own name is theirs.
  const own = records.find((record) => sameName(record.fullName, account.displayName)) ?? (records.length === 1 ? records[0] : undefined);
  if (own === undefined) return AMBIGUOUS;
  return {
    person: { kind: "member" },
    who: { userId, entryId: own.id },
    name: own.fullName.trim() || account.displayName,
    notice: { status: own.status, payment: own.payment, onList: true },
  };
}

/** Who a key tag is: the one current record with that member number, and the app member
 *  whose record it certainly is, if any. */
async function namedByMemberNumber(sql: Sql, gymId: string, code: string): Promise<Named> {
  const records = await repo.recordsByMemberNumber(sql, gymId, code);
  const record = records[0];
  if (record === undefined) return NOBODY;
  if (records.length > 1) return AMBIGUOUS;
  return await namedRecord(sql, gymId, record);
}

/** Who staff picked from the list: one of the gym's current records, never a former one. */
async function namedByRecord(sql: Sql, gymId: string, entryId: string): Promise<Named> {
  const record = await repo.currentRecord(sql, gymId, entryId);
  return record === null ? NOBODY : await namedRecord(sql, gymId, record);
}

/** A current record, and the app member whose record it certainly is, if any. */
async function namedRecord(
  sql: Sql,
  gymId: string,
  record: repo.RecordWords & { email: string | null; phone: string | null },
): Promise<Named> {
  const owners = (await membersAgainstList(sql, gymId, { email: record.email, phone: record.phone, entryIds: [record.id] })).filter(
    (member) => currentRecordOf(member) === record.id,
  );
  const owner = owners.length === 1 ? owners[0] : undefined;
  return {
    person: { kind: "member" },
    who: { userId: owner?.userId ?? null, entryId: record.id },
    name: record.fullName.trim() || (owner?.fullName ?? ""),
    notice: { status: record.status, payment: record.payment, onList: true },
  };
}

/** What a read pass is, spending it if it is fresh. */
async function readThePass(deps: CheckinDeps, code: string): Promise<{ read: ScanRead; userId: string | null }> {
  if (deps.passKey === null) throw new OrgsError(503, "passes_off", CHECKIN_WORDS.passes_off);
  const pass = readPass(deps.passKey, code, passWindow(deps.now()));
  if (pass.kind !== "fresh") return { read: { kind: "pass", pass: pass.kind }, userId: null };
  const uses = await deps.redis.incrWithTtl(`checkin:pass_used:${pass.userId}:${String(pass.window)}`, USED_PASS_TTL_S);
  // Without Redis a pass could be shown twice, so it is refused; key tags still work.
  if (uses === null) throw new OrgsError(503, "checkin_unavailable", CHECKIN_WORDS.checkin_unavailable);
  if (uses > 1) return { read: { kind: "pass", pass: "used" }, userId: null };
  return { read: { kind: "pass", pass: "fresh" }, userId: pass.userId };
}

export async function scan(deps: CheckinDeps, device: repo.DeskDevice, code: string): Promise<CheckinScanResponse> {
  const gymId = device.gymId;
  let read: ScanRead;
  let named: Named | null = null;
  if (looksLikePass(code)) {
    const pass = await readThePass(deps, code);
    read = pass.read;
    if (pass.userId !== null) named = await namedByAccount(deps.sql, gymId, pass.userId);
  } else {
    await keyTagRoom(deps, device);
    read = { kind: "key_tag" };
    named = await namedByMemberNumber(deps.sql, gymId, code);
    if (named.person.kind === "not_a_member") await keyTagMissed(deps, device);
  }
  await repo.touchDevice(deps.sql, gymId, device.deviceId);

  const gymName = device.gymName;
  const visit = await writeVisit(deps, gymId, read, named, { deviceId: device.deviceId, markedBy: null });
  if (visit.result === "fresh_pass_needed" || visit.result === "not_a_member" || visit.result === "see_staff") {
    return checkinScanResponseSchema.parse({ result: visit.result, gymName });
  }
  const person = { name: visit.named.name };
  if (visit.result === "already") {
    return checkinScanResponseSchema.parse({
      result: "already",
      gymName,
      person,
      notice: visit.named.notice,
      firstAt: visit.firstAt.toISOString(),
      timezone: device.timezone,
      clockFormat: device.clockFormat,
    });
  }
  return checkinScanResponseSchema.parse({ result: "checked_in", gymName, person, notice: visit.named.notice });
}

type Visit =
  | { result: "fresh_pass_needed" }
  | { result: "not_a_member" }
  | { result: "see_staff" }
  | { result: "checked_in"; named: Named }
  | { result: "already"; named: Named; firstAt: Date; timezone: string; clockFormat: GymClockFormat };

/** The scan rule's answer for one read, and the visit it writes: the desk's and staff's
 *  one way in, so the two can never disagree about who is let in or what counts twice. */
async function writeVisit(
  deps: CheckinDeps,
  gymId: string,
  read: ScanRead,
  named: Named | null,
  made: { deviceId: string; markedBy: null } | { deviceId: null; markedBy: string },
): Promise<Visit> {
  const who = named?.who ?? null;
  const ctx = who === null ? null : await repo.scanContext(deps.sql, gymId, who);
  const decision = decideScan({
    read,
    person: named?.person ?? null,
    period: ctx?.period ?? { hoursStatus: "hours_unset", opensMinute: null, closesMinute: null },
    visitsToday: ctx?.visitsToday ?? [],
  });
  if (decision.result === "fresh_pass_needed" || decision.result === "not_a_member" || decision.result === "see_staff") {
    return decision;
  }
  // Unreachable: the rule says checked_in or already only for a member, who has a `who`.
  if (named === null || who === null || ctx === null) throw new Error("a member's visit had nobody to write");
  const already = (firstAt: Date): Visit => ({
    result: "already",
    named,
    firstAt,
    timezone: ctx.timezone,
    clockFormat: ctx.clockFormat,
  });
  if (decision.result === "already") return already(decision.firstAt);

  const written = await repo.insertVisit(deps.sql, {
    gymId,
    who,
    deviceId: made.deviceId,
    markedBy: made.markedBy,
    method: read.kind === "pass" ? "pass" : read.kind === "key_tag" ? "key_tag" : "staff",
    day: ctx.day,
    period: ctx.period,
    slotKey: decision.slotKey,
  });
  if (!written.inserted) return already(written.firstAt);
  if (who.userId !== null) {
    // Coming to the gym keeps a streak alive (RULINGS 2026-09-01). The visit is saved;
    // a streak that fails to recompute is put right on its next read.
    const userId = who.userId;
    await getUserSyncContext(deps.sql, userId)
      .then((sync) => onAttendanceMarked({ sql: deps.sql }, userId, sync.timezone))
      .catch((err: unknown) => {
        deps.log.warn(
          { event: "gamification.attendance_streak_failed", gymId, errName: err instanceof Error ? err.name : typeof err },
          "attendance streak recompute failed",
        );
      });
  }
  return { result: "checked_in", named };
}

// ── STAFF, IN THE CONSOLE (16b-ii; spec Part 3 §12.5) ──

/** A search as LIKE reads it, its own three characters escaped. */
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`);

const foundRecord = (record: repo.FoundRecord): CheckinPersonFound => ({
  pick: { entryId: record.id },
  name: record.fullName.trim(),
  memberNumber: record.memberNumber,
  email: record.email,
  notice: { status: record.status, payment: record.payment, onList: true },
});

/** Whom staff can check in: the gym's current records, and its members in the app who
 *  have none. A member whose record is current is found as that record, once. */
export async function findPeople(
  deps: CheckinDeps,
  userId: string,
  gymId: string,
  query: string,
  limit: Limit,
): Promise<CheckinPeopleResponse | null> {
  const { privileges } = await requirePrivilege(deps, gymId, userId, "attendance.mark");
  if (!(await limit())) return null;
  // A record's email is the list's: only staff who keep the list match on it or are sent it.
  const withEmail = privileges.includes("members.confirm");
  const like = `%${escapeLike(query)}%`;
  const [records, accounts] = await Promise.all([
    repo.recordsLike(deps.sql, gymId, like, CHECKIN_SEARCH_LIMIT, withEmail),
    repo.appMembersLike(deps.sql, gymId, like, CHECKIN_SEARCH_LIMIT),
  ]);
  const members =
    accounts.length === 0
      ? []
      : await membersAgainstList(deps.sql, gymId, { email: null, phone: null, userIds: accounts.map((account) => account.userId) });
  const found: CheckinPersonFound[] = records.map(foundRecord);
  const shown = new Set(records.map((record) => record.id));
  for (const account of accounts) {
    const member = members.find((row) => row.userId === account.userId);
    const own = member === undefined ? null : currentRecordOf(member);
    if (own !== null) {
      if (shown.has(own)) continue;
      const record = await repo.currentRecord(deps.sql, gymId, own);
      if (record !== null) {
        shown.add(own);
        found.push(foundRecord(withEmail ? record : { ...record, email: null }));
        continue;
      }
    }
    found.push({
      pick: { userId: account.userId },
      name: account.displayName,
      memberNumber: null,
      email: account.email,
      notice: { status: null, payment: null, onList: member?.onList ?? false },
    });
  }
  found.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return checkinPeopleResponseSchema.parse({ people: found.slice(0, CHECKIN_SEARCH_LIMIT) });
}

/** Staff check a person in: the desk's rule, never refused for the hour or a payment
 *  word, logged with who did it. */
export async function staffCheckIn(
  deps: CheckinDeps,
  userId: string,
  gymId: string,
  pick: CheckinPick,
  limit: Limit,
): Promise<StaffCheckinResponse | null> {
  await requireWritablePrivilege(deps, gymId, userId, "attendance.mark");
  if (!(await limit())) return null;
  const named =
    "entryId" in pick ? await namedByRecord(deps.sql, gymId, pick.entryId) : await namedByAccount(deps.sql, gymId, pick.userId);
  const visit = await writeVisit(deps, gymId, { kind: "staff" }, named, { deviceId: null, markedBy: userId });
  if (visit.result === "checked_in") {
    return staffCheckinResponseSchema.parse({ result: "checked_in", person: { name: visit.named.name }, notice: visit.named.notice });
  }
  if (visit.result === "already") {
    return staffCheckinResponseSchema.parse({
      result: "already",
      person: { name: visit.named.name },
      notice: visit.named.notice,
      firstAt: visit.firstAt.toISOString(),
      timezone: visit.timezone,
      clockFormat: visit.clockFormat,
    });
  }
  throw new OrgsError(404, "person_not_found", STAFF_CHECKIN_WORDS.person_not_found);
}

/** The live log: today's newest visits, or those since the screen's newest. */
export async function readLog(
  deps: CheckinDeps,
  userId: string,
  gymId: string,
  since: string | undefined,
  limit: Limit,
): Promise<CheckinLogResponse | null> {
  await requirePrivilege(deps, gymId, userId, "attendance.read");
  if (!(await limit())) return null;
  const log = await repo.logVisits(deps.sql, gymId, since === undefined ? null : new Date(since), CHECKIN_LOG_LIMIT);
  if (log === null) throw new OrgsError(404, "org_not_found", "We couldn't find that organisation.");
  return checkinLogResponseSchema.parse({
    log: {
      day: log.day,
      timezone: log.timezone,
      clockFormat: log.clockFormat,
      visits: log.visits.map((visit) => ({ ...visit, markedAt: visit.markedAt.toISOString() })),
    },
  });
}
