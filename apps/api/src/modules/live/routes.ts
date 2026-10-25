// The open line a console tab keeps while it is on screen (ROADMAP Stage 4 item 18; Kd,
// 2026-10-24):
//
//   GET /v1/orgs/:gymId/live    any member of the gym's staff
//
// authenticate → staff of this gym (the same 404 every gym route answers anybody else) → the
// limit on opening lines → the handler. The answer is a stream of server-sent events: `ready`
// once, then what to read again, as `data: {json}` lines, and a comment every 25 seconds so that
// nothing between the browser and the server takes a quiet line for a dead one.
//
// A line ends when the sign-in it was opened with runs out, and at most 15 minutes after it
// opened: the browser opens a new one through these same checks, so somebody removed from a
// gym's staff, or signed out, stops hearing its news by then.
import { PassThrough } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { LIVE_WORDS, type LiveMessage } from "@app/shared";
import type { AppConfig } from "../../config.js";
import type { RedisLike } from "../../redis.js";
import { accessClaimsOf } from "../auth/plugin.js";
import { createDualRateLimit } from "../auth/rateLimit.js";
import { orgParamsSchema } from "../orgs/schemas.js";
import { requireStaff } from "../orgs/service.js";
import type { LiveHub, LiveLine } from "./hub.js";

export const HEARTBEAT_MS = 25_000;
export const MAX_LINE_MS = 15 * 60_000;

export interface LiveRouteDeps {
  sql: Sql;
  redis: RedisLike;
  config: AppConfig;
  hub: LiveHub;
  /** Tests shorten both; production uses the constants above. */
  heartbeatMs?: number;
  maxLineMs?: number;
}

function frame(message: LiveMessage): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

export function registerLiveRoutes(app: FastifyInstance, deps: LiveRouteDeps): void {
  const heartbeatMs = deps.heartbeatMs ?? HEARTBEAT_MS;
  const maxLineMs = deps.maxLineMs ?? MAX_LINE_MS;

  const staffHere = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const params = orgParamsSchema.safeParse(req.params);
    if (!params.success) {
      await reply.status(400).send({ error: "validation_error", message: "gymId: invalid_string", requestId: req.id });
      return;
    }
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    await requireStaff({ sql: deps.sql }, params.data.gymId, userId);
  };

  // A tab opens a line each time it comes back on screen and every 15 minutes while it stays:
  // 600 an hour is ten a minute for one person. A gym's staff share its wi-fi, and each gym's
  // count at an address is its own.
  const limit = createDualRateLimit({
    name: "org_live",
    max: 600,
    ipMax: 6_000,
    ipScope: (req) => orgParamsSchema.safeParse(req.params).data?.gymId ?? null,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
    message: LIVE_WORDS.rate_limited,
  });

  app.get("/v1/orgs/:gymId/live", { preHandler: [app.authenticate, staffHere, limit] }, async (req, reply) => {
    const { gymId } = orgParamsSchema.parse(req.params);
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");

    const runsOut = accessClaimsOf(req, deps.config)?.expiresAtSeconds ?? null;
    const left = runsOut === null ? maxLineMs : runsOut * 1000 - Date.now();
    const endsIn = Math.max(1_000, Math.min(maxLineMs, left));

    const stream = new PassThrough();
    let ended = false;
    const timers: { heartbeat?: ReturnType<typeof setInterval>; end?: ReturnType<typeof setTimeout> } = {};
    const line: LiveLine = {
      gymId,
      userId,
      send(message) {
        if (!ended) stream.write(frame(message));
      },
      end() {
        finish();
      },
    };
    function finish(): void {
      if (ended) return;
      ended = true;
      clearInterval(timers.heartbeat);
      clearTimeout(timers.end);
      deps.hub.close(line);
      stream.end();
    }

    const opened = deps.hub.open(line);
    if (opened !== "open") {
      return reply
        .status(opened === "too_many_lines" ? 429 : 503)
        .header("retry-after", "30")
        .send({ error: opened, message: LIVE_WORDS[opened], requestId: req.id });
    }
    timers.heartbeat = setInterval(() => {
      if (!ended) stream.write(": still here\n\n");
    }, heartbeatMs);
    timers.end = setTimeout(finish, endsIn);
    // The browser closed the tab, went off screen or lost its connection.
    reply.raw.on("close", finish);
    stream.write(frame({ what: "ready" }));
    return reply
      .status(200)
      .header("content-type", "text/event-stream; charset=utf-8")
      .header("cache-control", "no-store, no-transform")
      // Tells a proxy in front not to hold the events back.
      .header("x-accel-buffering", "no")
      .send(stream);
  });
}
