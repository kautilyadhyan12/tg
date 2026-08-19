// P2.1 GAP-4 (custom dual-bucket limiter — @fastify/rate-limit's stacked
// limiters silently no-op; see DECISIONS 2026-07-11 GAP-4 CORRECTION).
// P2.4: the store moved behind the RedisLike seam (v1 §7.2 `rl:*` keys),
// paying the "Redis swap owed at P2.4" debt — multi-instance-correct when
// REDIS_URL is set; the in-memory adapter keeps the old single-instance
// behavior in dev/test. Fixed window starts at the first hit (INCR sets the
// TTL once), same semantics as the P2.1 Map impl.
// Redis DOWN → fail OPEN with a log: auth availability wins for a blip; the
// global @fastify/rate-limit floor still applies (R3.7 numbers unchanged).
import type { FastifyReply, FastifyRequest } from "fastify";
import type { RedisLike } from "../../redis.js";

export interface DualRateLimitOptions {
  /** Namespaces this limiter's keys: rl:{name}:ip:… / rl:{name}:id:… */
  name: string;
  /** Max requests per window, counted independently per IP and per identifier. */
  max: number;
  /** Optional separate ceiling for the IP dimension; defaults to `max`, which
   *  is what every auth route uses and what this limiter did before the option
   *  existed.
   *
   *  It exists because one caller has legitimately asymmetric dimensions: the
   *  gym join door, where a single ACCOUNT applying twice is already odd but
   *  thirty accounts applying from one gym's wi-fi on induction day is the
   *  normal case. Adding the option is strictly additive — an options object
   *  without it behaves exactly as before, which the auth suite proves. */
  ipMax?: number;
  windowMs: number;
  /** Extracts the identifier (normalized email) from the request; return null
   *  to count only the IP dimension. */
  identifier: (req: FastifyRequest) => string | null;
  redis: RedisLike;
}

export function createDualRateLimit(
  opts: DualRateLimitOptions,
): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const windowSeconds = Math.max(1, Math.ceil(opts.windowMs / 1000));
  const ipMax = opts.ipMax ?? opts.max;

  const hit = async (
    req: FastifyRequest,
    dimension: "ip" | "id",
    value: string,
  ): Promise<boolean> => {
    const max = dimension === "ip" ? ipMax : opts.max;
    const count = await opts.redis.incrWithTtl(`rl:${opts.name}:${dimension}:${value}`, windowSeconds);
    if (count === null) {
      // Redis down → fail open, but NEVER silently (T3 P2.4): a silent
      // fail-open disables auth throttling with zero signal. The global
      // @fastify/rate-limit floor still applies.
      req.log.warn(
        { event: "ratelimit.open_redis_down", limiter: opts.name, dimension },
        "rate limiter failing open (Redis unavailable)",
      );
      return true;
    }
    return count <= max;
  };

  return async (req, reply) => {
    const ipOk = await hit(req, "ip", req.ip);
    const id = opts.identifier(req);
    const idOk = id === null ? true : await hit(req, "id", id);
    if (!ipOk || !idOk) {
      // Same client-facing shape as the global limiter's 429 (R8.1).
      await reply.status(429).send({
        error: "rate_limited",
        message: "Too many attempts. Please try again later.",
        requestId: req.id,
      });
    }
  };
}
