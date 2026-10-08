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
   *  without it behaves exactly as before, which the auth suite proves.
   *
   *  `null`: the address is not counted here at all, for a door where one person at a
   *  shared address could otherwise use up everybody's allowance (sign-in's code check
   *  counts the address apart, only for wrong guesses at live codes). */
  ipMax?: number | null;
  /** Counts the address apart for each value this returns (a gym's id), so one gym's staff
   *  never use up another gym's allowance at a shared address. Left out, or null: the
   *  address has one count for everybody. */
  ipScope?: (req: FastifyRequest) => string | null;
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
  const ipMax = opts.ipMax === undefined ? opts.max : opts.ipMax;

  const hit = async (
    req: FastifyRequest,
    dimension: "ip" | "id",
    value: string,
  ): Promise<boolean> => {
    const max = dimension === "ip" ? (ipMax ?? Number.POSITIVE_INFINITY) : opts.max;
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

  // A REFUSED PRESS IS NOT CHARGED TO ANYONE ELSE (round one of 5b-v-b-i, L6). The
  // person's own allowance is asked first: one they have used up refuses them without
  // touching the address's, so one person pressing on at a shared front desk does not
  // lock their colleagues out. A press the address refuses is given back to the person,
  // so a busy desk does not use up somebody's own allowance for when they are elsewhere.
  // Each bucket still counts every request it lets through.
  return async (req, reply) => {
    const id = opts.identifier(req);
    const idOk = id === null ? true : await hit(req, "id", id);
    const scope = opts.ipScope?.(req) ?? null;
    const ipOk = idOk && ipMax !== null ? await hit(req, "ip", scope === null ? req.ip : `${scope}:${req.ip}`) : true;
    if (idOk && !ipOk && id !== null) await opts.redis.decrIfPositive(`rl:${opts.name}:id:${id}`);
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
