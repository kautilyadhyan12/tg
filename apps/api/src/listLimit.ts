import type { FastifyInstance } from "fastify";

/**
 * The most list items one request may carry, counted over every list in its body and its query
 * string, nested lists included. A route that really sends more declares its own number in its
 * `config.listItemsMost`.
 *
 * Why: zod keeps one issue for every list item that fails, and a list with no `.max()` is read
 * to its end. Measured 2026-11-09: a 1 MB body of 500,000 wrong items took 166 MB of memory on
 * zod 3.25.76 and 263 MB on zod 4.6.7, and a 14 MB one took 2.5 GB, more than the server has.
 * 25,000 is above every list the app sends except a run's points (geo routes).
 */
export const LIST_ITEMS_MOST = 25_000;

declare module "fastify" {
  interface FastifyContextConfig {
    /** This route's own `LIST_ITEMS_MOST`. */
    listItemsMost?: number;
  }
}

/** The list items in `value`, counted without recursion, stopping as soon as `most` is passed. */
export function countListItems(value: unknown, most: number): number {
  let count = 0;
  const waiting: unknown[] = [value];
  while (waiting.length > 0) {
    const next = waiting.pop();
    if (typeof next !== "object" || next === null) continue;
    if (Array.isArray(next)) {
      count += next.length;
      if (count > most) return count;
      for (const item of next) if (typeof item === "object" && item !== null) waiting.push(item);
    } else {
      for (const item of Object.values(next)) if (typeof item === "object" && item !== null) waiting.push(item);
    }
  }
  return count;
}

/** Refuses a request holding more list items than its route takes, before any route reads it. */
export function registerListLimit(app: FastifyInstance): void {
  app.addHook("preValidation", async (req, reply) => {
    const most = req.routeOptions.config.listItemsMost ?? LIST_ITEMS_MOST;
    if (countListItems(req.body, most) <= most && countListItems(req.query, most) <= most) return;
    return reply.status(413).send({
      error: "too_many_items",
      message: "This request holds too many items. Send fewer at a time.",
      requestId: req.id,
    });
  });
}
