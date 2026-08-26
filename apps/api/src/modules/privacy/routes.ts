// Part 4 §5.2 — the data-export route (v1 §18's "data-export endpoint").
//
// WHY THIS LIVES IN THE PRIVACY MODULE despite serving a /v1/users/me/* path:
// the export list and the Day-14 delete list must stay in step, and keeping
// them in one module is what makes that checkable in one place (R7.1 is about
// owning your tables, not owning a URL prefix). The path is the user's
// because that is where a person looks for their own data.
//
// Route order per R3.3: authenticate → rate limit → handler. Tenancy is by
// construction: the export is built for `req.authUser.id` and there is no id
// parameter on this surface, so a caller can only ever ask for their own data
// (R3.2). A soft-deleted user cannot reach it at all — login is blocked
// during the 14-day window, which is a recorded SPEC GAP, not an oversight.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { RedisLike } from "../../redis.js";
import { buildUserExport } from "./export.js";

/** Kd-approved 2026-07-23, NOT a spec number (the onboarding-bounds
 *  precedent). An export reads every row the user owns across 17 tables, so
 *  it is the heaviest authenticated read in the product and a data-egress
 *  surface; the neighbouring reset-class limit is 5/hr.
 *
 *  ONE DIMENSION, PER USER — and the first version of this got it exactly
 *  backwards (T3 F1, probed: user B's FIRST EVER export returned 429 because
 *  user A had spent 3 from the same address). It used `createDualRateLimit`
 *  and cited "the coach-cap reasoning" as the grounds, when that precedent
 *  says the OPPOSITE in as many words — coach/idempotency.ts: "Deliberately
 *  NOT the auth module's createDualRateLimit: that limiter also counts a
 *  per-IP dimension, which on a gym's shared connection would throttle
 *  everyone behind one NAT address." The dual limiter counts `max`
 *  independently on EACH dimension, so an IP bucket of 3 caps a whole gym —
 *  and the gym pilot is literally gyms on shared connections (P6). The
 *  precedent was inverted rather than quoted (V2); this now copies its
 *  actual shape, `coachRateCap`. */
const EXPORT_MAX_PER_WINDOW = 3;
const EXPORT_WINDOW_S = 60 * 60;

/** Per-user fixed window, mirroring coachRateCap. Fails OPEN when Redis is
 *  down, loudly — refusing a lawful data-access request because a cache
 *  blipped is the worse failure (the coach doctrine). */
function exportRateCap(deps: { redis: RedisLike }) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    const count = await deps.redis.incrWithTtl(`export:rate:${userId}`, EXPORT_WINDOW_S);
    if (count === null) {
      req.log.warn({ event: "export.cap_open_redis_down", userId }, "export cap failing open");
      return;
    }
    if (count > EXPORT_MAX_PER_WINDOW) {
      await reply.status(429).send({
        error: "rate_limited",
        message: "You've requested several exports recently. Please try again later.",
        requestId: req.id,
      });
    }
  };
}

export function registerPrivacyRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; redis: RedisLike },
): void {
  const authedUserId = (req: FastifyRequest): string => {
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    return userId;
  };

  // Runs AFTER app.authenticate so req.authUser is populated (the coach
  // route's established order).
  const exportLimit = exportRateCap({ redis: deps.redis });

  app.get(
    "/v1/users/me/export",
    { preHandler: [app.authenticate, exportLimit] },
    async (req, reply) => {
      const payload = await buildUserExport({ sql: deps.sql }, authedUserId(req));
      // NB (T3 round 2, F4): app.ts sets `exposedHeaders: ["Idempotent-Replay"]`
      // only, so browser JS reading this response cross-origin CANNOT see
      // Content-Disposition. It still works for the natural download path (a
      // link or navigation, where the browser honours the header itself) —
      // but the web download card must add "Content-Disposition" to
      // exposedHeaders if it wants the filename from a fetch(). Publishing a
      // header is a policy choice, not a drive-by (the coach card's precedent).
      // A dated filename so a user who exports twice can tell them apart;
      // `attachment` makes a browser save it rather than render it, which is
      // what "download my data" should do.
      const day = payload.exportedAt.slice(0, 10);
      return reply
        // R3-F2: the largest personal-data response in the product must not
        // sit in any cache. exercises/routes.ts already sets a private
        // no-cache on a far less sensitive authed response.
        .header("Cache-Control", "no-store")
        .header("Content-Disposition", `attachment; filename="aihomegym-export-${day}.json"`)
        .status(200)
        .send(payload);
    },
  );
}
