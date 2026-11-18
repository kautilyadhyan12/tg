// The phone's one download of the Exercise Library (spec Part 2 §13.4, job 60b): GET /v1/library,
// for a signed-in person. The reply is the newest copy of the person's channel with its fingerprint;
// a phone that already holds that copy (If-None-Match) is answered 304 with no body. The list is
// one for the whole app, so there is nobody else's to refuse: a signed-out caller gets 401.
//
// A copy never changes, so its text is kept in memory by its number once it has been read and
// checked: a download costs two small reads and no parsing.
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { channelFor } from "./channel.js";
import * as repo from "./repo.js";

/** The copies kept in memory: the newest of each channel and the one before, a little over. */
const KEPT_COPIES = 4;

const etagOf = (fingerprint: string): string => `"${fingerprint}"`;

/** Whether an If-None-Match header names this ETag. Compared weakly, as RFC 9110 §13.1.2 says: a
 *  `W/` before a tag is ignored (a proxy that compresses may weaken it), and `*` matches any copy. */
export function holdsCopy(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) return false;
  return ifNoneMatch
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}

export function registerLibraryRoutes(app: FastifyInstance, deps: { sql: Sql }): void {
  const kept = new Map<number, string>();

  /** The checked text of one copy, from memory or from the database. */
  async function copyText(version: number): Promise<string> {
    const held = kept.get(version);
    if (held !== undefined) return held;
    const body = await repo.checkedCopyText(deps.sql, version);
    kept.set(version, body);
    while (kept.size > KEPT_COPIES) kept.delete(Math.min(...kept.keys()));
    return body;
  }

  app.get("/v1/library", { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");

    const newest = await repo.newestCopyFor(deps.sql, channelFor(await repo.betaFlagRules(deps.sql), userId));
    if (newest === null) {
      return reply.status(404).send({ error: "not_found", message: "the Exercise Library has not been published", requestId: req.id });
    }

    const etag = etagOf(newest.sha256);
    void reply.header("etag", etag).header("cache-control", "private, no-cache");
    if (holdsCopy(req.headers["if-none-match"], etag)) return reply.status(304).send();
    const body = await copyText(newest.version);
    return reply
      .status(200)
      .type("application/json; charset=utf-8")
      .send(`{"fingerprint":${JSON.stringify(newest.sha256)},"version":${String(newest.version)},"list":${body}}`);
  });
}
