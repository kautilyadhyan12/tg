// A MESSAGE TO A CHOSEN GROUP (spec Part 3 §16.8; ROADMAP 20f-i).
//
// Staff tick people on the Members list, read who will get it and who won't, type one
// message, and it lands in each person's inbox in the app. `groupMessagePlan` is the ONE
// rule that decides who is sent it: only somebody selected, on this gym's list now, with
// one live app account that has not switched these messages off.
//
// Gates in CLAUDE.md §4's order: privilege (and a live plan, for the send), then the rate
// limit, then the handler.
import {
  GYM_GROUP_MESSAGES_A_DAY,
  GYM_GROUP_MESSAGE_BOX_NAMES_MAX,
  GYM_GROUP_MESSAGE_PROBLEM_WORDS,
  GYM_GROUP_MESSAGE_WORDS,
  GYM_MESSAGE_KEPT_DAYS,
  groupMessageProblem,
  tidyGroupMessage,
  type GymGroupMessageDone,
  type GymGroupMessageKeptReason,
  type GymGroupMessagePerson,
  type GymGroupMessagePreview,
  type GymGroupMessagePreviewRequest,
  type GymGroupMessageSendRequest,
} from "@app/shared";
import { insertAudit } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { lockGym } from "../memberList/repo.js";
import { selectedIds } from "../memberList/selection.js";
import type { MemberListDeps } from "../memberList/service.js";
import { badWordsIn } from "../posts/badWords.js";
import * as groupRepo from "./groupRepo.js";
import { gymNow } from "./repo.js";

export interface GroupPlan {
  /** Who is sent it, each with the one account it goes to. */
  send: (GymGroupMessagePerson & { userId: string })[];
  kept: { reason: GymGroupMessageKeptReason; people: GymGroupMessagePerson[]; count: number }[];
}

/** WHO A MESSAGE GOES TO. `rows` are the selected records that are still this gym's;
 *  `selected` is how many were selected. Only somebody in `rows` can be sent it, and only
 *  to the one account on their record: a former member, somebody with no app account,
 *  a record two accounts share (it is nobody's), and somebody who switched these messages
 *  off are each kept out, with the reason. */
export function groupMessagePlan(rows: readonly groupRepo.GroupStateRow[], selected: number): GroupPlan {
  const send: GroupPlan["send"] = [];
  const groups = new Map<GymGroupMessageKeptReason, GymGroupMessagePerson[]>();
  const keep = (reason: GymGroupMessageKeptReason, person: GymGroupMessagePerson): void => {
    groups.set(reason, [...(groups.get(reason) ?? []), person]);
  };
  const taken = new Set<string>();
  for (const row of rows) {
    const person = { entryId: row.entryId, name: row.name };
    const [userId, ...others] = row.userIds;
    if (row.former) keep("former", person);
    else if (userId === undefined) keep("not_in_app", person);
    else if (others.length > 0 || taken.has(userId)) keep("shared", person);
    else if (row.off) keep("switched_off", person);
    else {
      taken.add(userId);
      send.push({ ...person, userId });
    }
  }
  const order: readonly GymGroupMessageKeptReason[] = ["not_in_app", "switched_off", "shared", "former"];
  const kept = order.flatMap((reason) => {
    const people = groups.get(reason);
    return people === undefined ? [] : [{ reason, people, count: people.length }];
  });
  const gone = selected - rows.length;
  if (gone > 0) kept.push({ reason: "gone", people: [], count: gone });
  return { send, kept };
}

const leftOf = (sent: number): number => Math.max(0, GYM_GROUP_MESSAGES_A_DAY - sent);

function previewOf(plan: GroupPlan, selected: number, sentToday: number): GymGroupMessagePreview {
  // The box names the first people of each group and counts the rest.
  return {
    selected,
    sendCount: plan.send.length,
    send: plan.send.slice(0, GYM_GROUP_MESSAGE_BOX_NAMES_MAX).map(({ entryId, name }) => ({ entryId, name })),
    kept: plan.kept.map((group) => ({ ...group, people: group.people.slice(0, GYM_GROUP_MESSAGE_BOX_NAMES_MAX) })),
    leftToday: leftOf(sentToday),
  };
}

const gymNotFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");

/** The box before the message is written. Null when the rate limit has answered. */
export async function previewGroupMessage(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  request: GymGroupMessagePreviewRequest,
  limit: () => Promise<boolean>,
): Promise<GymGroupMessagePreview | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const ids = await selectedIds(deps, gymId, request.selection);
  const gym = await gymNow(deps.sql, gymId, deps.now());
  if (gym === null) throw gymNotFound();
  const [rows, sentToday] = await Promise.all([groupRepo.groupStateOf(deps.sql, gymId, ids), groupRepo.sentOnDay(deps.sql, gymId, gym.today)]);
  return previewOf(groupMessagePlan(rows, ids.length), ids.length, sentToday);
}

/** The people who would get it are not the number the box's button named: nothing was
 *  sent, and this is the box as it now stands. */
export class GroupPeopleChanged extends Error {
  constructor(readonly preview: GymGroupMessagePreview) {
    super("group_message_people_changed");
  }
}

/** Send the message to the people selected. A "Select all" is resolved first, against its
 *  own digest (`selection_changed`); who is sent it is then worked out again with the gym
 *  held, and it goes only if that is as many people as the button named. The same box
 *  pressed twice sends once. Null when the rate limit has answered. */
export async function sendGroupMessage(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  request: GymGroupMessageSendRequest,
  limit: () => Promise<boolean>,
): Promise<GymGroupMessageDone | null> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const body = tidyGroupMessage(request.body);
  const problem = groupMessageProblem(body);
  if (problem !== null) throw new OrgsError(400, `group_message_${problem}`, GYM_GROUP_MESSAGE_PROBLEM_WORDS[problem]);
  const words = badWordsIn(body);
  if (words.length > 0) throw new OrgsError(400, "group_message_bad_words", GYM_GROUP_MESSAGE_WORDS.bad_words(words));
  const ids = await selectedIds(deps, gymId, request.selection);
  return await deps.sql.begin(async (tx): Promise<GymGroupMessageDone> => {
    // The gym's row: a join, a removal and another send wait, so the day's count and the
    // people are read once and are what is written.
    await lockGym(tx, gymId);
    const now = deps.now();
    const gym = await gymNow(tx, gymId, now);
    if (gym === null) throw gymNotFound();
    const sentToday = await groupRepo.sentOnDay(tx, gymId, gym.today);
    const before = await groupRepo.byKey(tx, gymId, request.key);
    if (before !== null) return { sent: before.people, kept: [], leftToday: leftOf(sentToday) };
    if (sentToday >= GYM_GROUP_MESSAGES_A_DAY) throw new OrgsError(409, "group_messages_day_full", GYM_GROUP_MESSAGE_WORDS.day_full);
    const plan = groupMessagePlan(await groupRepo.groupStateOf(tx, gymId, ids), ids.length);
    if (plan.send.length !== request.sendCount) throw new GroupPeopleChanged(previewOf(plan, ids.length, sentToday));
    const written = await groupRepo.insertGroupMessage(
      tx,
      { gymId, sentBy: userId, body, gymDay: gym.today, sendKey: request.key, userIds: plan.send.map((person) => person.userId) },
      now,
      GYM_MESSAGE_KEPT_DAYS,
    );
    if (written.sent === 0) throw new OrgsError(409, "group_message_nobody", GYM_GROUP_MESSAGE_WORDS.nobody);
    // The words are in the message's own row, never in the audit log.
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.group_message_sent",
      targetType: "group_message",
      targetId: written.id,
      meta: { people: String(written.sent) },
    });
    return { sent: written.sent, kept: plan.kept.map(({ reason, count }) => ({ reason, count })), leftToday: leftOf(sentToday + 1) };
  });
}
