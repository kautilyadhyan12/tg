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

  const hit = async (dimension: "ip" | "id", value: string): Promise<boolean> => {
    const count = await opts.redis.incrWithTtl(`rl:${opts.name}:${dimension}:${value}`, windowSeconds);
    if (count === null) return true; // Redis down → fail open (header comment)
    return count <= opts.max;
  };

  return async (req, reply) => {
    const ipOk = await hit("ip", req.ip);
    const id = opts.identifier(req);
    const idOk = id === null ? true : await hit("id", id);
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
