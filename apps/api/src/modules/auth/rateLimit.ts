// P2.1 GAP-4 (DECISIONS 2026-07-11, corrected): @fastify/rate-limit marks each
// request with an internal rateLimitRan symbol, so after the GLOBAL limiter
// runs, any per-route limiter from the same plugin silently no-ops — and two
// stacked limiters (per-IP AND per-identifier, R3.7) can never both run.
// PROVEN by the PROVE run (3 red rate-limit tests). This is the replacement:
// a dependency-free dual-bucket fixed-window limiter. In-memory =
// SINGLE-INSTANCE-ONLY; the Redis swap is owed at P2.4 (unchanged).
import type { FastifyReply, FastifyRequest } from "fastify";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface DualRateLimitOptions {
  /** Max requests per window, counted independently per IP and per identifier. */
  max: number;
  windowMs: number;
  /** Extracts the identifier (normalized email) from the request; return null
   *  to count only the IP dimension. */
  identifier: (req: FastifyRequest) => string | null;
}

const SWEEP_THRESHOLD = 10_000; // spoofed-IP floods must not grow the map forever

export function createDualRateLimit(
  opts: DualRateLimitOptions,
): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const buckets = new Map<string, Bucket>();

  const hit = (key: string, now: number): boolean => {
    const b = buckets.get(key);
    if (b === undefined || b.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return true;
    }
    b.count += 1;
    return b.count <= opts.max;
  };

  return async (req, reply) => {
    const now = Date.now();
    if (buckets.size > SWEEP_THRESHOLD) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    const ipOk = hit(`ip:${req.ip}`, now);
    const id = opts.identifier(req);
    const idOk = id === null ? true : hit(`id:${id}`, now);
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
