// THE WORKOUT AND MEAL REMINDERS, SET BY THE PERSON (ROADMAP Stage 5 item 19e-i). Order: authenticate →
// rate limit → handler. No person's id in the path: a caller reads and saves only their own.
import {
  REMINDER_DEFAULT_MINUTE,
  REMINDER_KINDS,
  bitsToDays,
  daysToBits,
  minuteToTime,
  reminderKindParamsSchema,
  reminderSaveSchema,
  timeToMinute,
  type Reminder,
  type RemindersResponse,
} from "@app/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { RedisLike } from "../../redis.js";
import { createDualRateLimit } from "../auth/rateLimit.js";
import { localClock } from "./clock.js";
import { getPlanHealth } from "../users/service.js";
import * as repo from "./repo.js";

/** All four, in order, each as saved or as it starts. */
export async function remindersOf(sql: Sql, userId: string): Promise<RemindersResponse> {
  const rows = await repo.readReminders(sql, userId);
  const reminders: Reminder[] = REMINDER_KINDS.map((kind) => {
    const row = rows.find((r) => r.kind === kind);
    if (row === undefined) return { kind, on: false, time: minuteToTime(REMINDER_DEFAULT_MINUTE[kind]), days: bitsToDays(127), paused: false };
    return { kind, on: row.isOn, time: minuteToTime(row.minute), days: bitsToDays(row.days), paused: row.isOn && row.paused };
  });
  // Safe mode holds the workout reminder (the sender skips it); the switch and its days stay as saved.
  const safeMode = (await getPlanHealth(sql, userId))?.safeMode === true;
  return { reminders, safeMode };
}

const refused = (req: FastifyRequest, reply: FastifyReply, issues: readonly { path: PropertyKey[]; code: string }[]) =>
  reply.status(400).send({
    error: "validation_error",
    message: issues.map((i) => `${i.path.map(String).join(".")}: ${i.code}`).join("; "),
    requestId: req.id,
  });

export function registerReminderRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike; now?: () => Date }): void {
  const now = deps.now ?? (() => new Date());
  // Settings reads them on each opening and each return to the app; a save is a press.
  const readLimit = createDualRateLimit({
    name: "reminders_read",
    max: 600,
    ipMax: null,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const saveLimit = createDualRateLimit({
    name: "reminders_save",
    max: 120,
    ipMax: null,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.get("/v1/users/me/reminders", { preHandler: [app.authenticate, readLimit] }, async (req, reply) => {
    const user = req.authUser;
    if (user === undefined) throw new Error("authenticate preHandler did not run");
    return reply.status(200).send(await remindersOf(deps.sql, user.id));
  });

  app.put("/v1/users/me/reminders/:kind", { preHandler: [app.authenticate, saveLimit] }, async (req, reply) => {
    const user = req.authUser;
    if (user === undefined) throw new Error("authenticate preHandler did not run");
    const params = reminderKindParamsSchema.safeParse(req.params);
    if (!params.success) return refused(req, reply, params.error.issues);
    const body = reminderSaveSchema.safeParse(req.body);
    if (!body.success) return refused(req, reply, body.error.issues);
    const person = await repo.readPerson(deps.sql, user.id);
    if (person === null) return reply.status(404).send({ error: "not_found", message: "Account not found.", requestId: req.id });
    const { kind } = params.data;
    const clock = localClock(person.zone, now());
    await repo.saveReminder(deps.sql, {
      userId: user.id,
      kind,
      on: body.data.on,
      minute: timeToMinute(body.data.time),
      days: daysToBits(kind, body.data.days),
      today: clock.day,
      nowMinute: clock.minute,
    });
    return reply.status(200).send(await remindersOf(deps.sql, user.id));
  });
}
