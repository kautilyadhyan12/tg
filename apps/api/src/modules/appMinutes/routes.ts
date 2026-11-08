// The phone sends the minutes the app was open on screen each day (ROADMAP Stage 2 item 14a-ii; the
// phone's part is Stage 5 item 21f). Order (CLAUDE.md §4): signed in, then the rate limit, then the
// handler. A person writes only their own days: the body names no person.
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { appMinutesRequestSchema, type AppMinutesResponse } from "@app/shared";
import type { RedisLike } from "../../redis.js";
import { createDualRateLimit } from "../auth/rateLimit.js";
import { parseOr400 } from "../orgs/posts/routes.js";
import { knownZones, saveMinutes } from "./repo.js";

export interface AppMinutesDeps {
  sql: Sql;
  redis: RedisLike;
  now?: () => Date;
}

const authedUserId = (req: FastifyRequest): string => {
  const id = req.authUser?.id;
  if (id === undefined) throw new Error("app.authenticate did not run");
  return id;
};

export function registerAppMinutesRoutes(app: FastifyInstance, deps: AppMinutesDeps): void {
  // A phone sends when it goes to the background or comes back online; never this often. By the
  // person only: a gym's members share one address.
  const limit = createDualRateLimit({
    name: "app_minutes",
    max: 30,
    ipMax: null,
    windowMs: 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  app.post("/v1/me/app-minutes", { preHandler: [app.authenticate, limit], bodyLimit: 16 * 1024 }, async (req, reply) => {
    const body = parseOr400(appMinutesRequestSchema, req.body, req, reply);
    if (body === null) return;
    const zones = await knownZones(deps.sql);
    const days = body.days.filter((d) => zones.has(d.zone));
    const kept = await saveMinutes(deps.sql, authedUserId(req), days, (deps.now ?? (() => new Date()))());
    const answer: AppMinutesResponse = { kept, ignored: body.days.length - kept };
    return reply.status(200).send(answer);
  });
}
