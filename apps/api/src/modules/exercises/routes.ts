// P2.2 — exercises routes (thin, R7.1). Route order per R3.3: authn →
// Zod parse (query, z.coerce per Part IV #5) → handler. No entitlement/quota
// on catalog reads in v1 (free plan gates exercise USE by tier via
// entitlements at P2.4; the catalog itself is browsable). Global rate limit
// applies. ETag flow per v1 §5.2: the stored sha256 is the ETag.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import { bundleQuerySchema, catalogListQuerySchema } from "./schemas.js";
import * as service from "./service.js";

/** Zod-parse the querystring; 400 with issue paths/codes only (R3.10).
 *  Generic over the schema (not its output) so .default() fields keep their
 *  non-optional OUTPUT type. */
function parseQuery<S extends z.ZodTypeAny>(
  schema: S,
  req: FastifyRequest,
  reply: FastifyReply,
): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(req.query);
  if (!parsed.success) {
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
      requestId: req.id,
    });
    return null;
  }
  return parsed.data;
}

const etagOf = (sha256: string): string => `"${sha256}"`;

export function registerExerciseRoutes(app: FastifyInstance, deps: { sql: Sql }): void {
  const exDeps: service.ExercisesDeps = { sql: deps.sql };

  app.get("/v1/exercises", { preHandler: [app.authenticate] }, async (req, reply) => {
    const query = parseQuery(catalogListQuerySchema, req, reply);
    if (query === null) return;
    const page = await service.getCatalogPage(exDeps, query);
    return reply.status(200).send(page);
  });

  app.get("/v1/exercise-definitions", { preHandler: [app.authenticate] }, async (req, reply) => {
    const query = parseQuery(bundleQuerySchema, req, reply);
    if (query === null) return;
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");

    const result = await service.getBundle(exDeps, userId, query.since);
    if (result.kind === "none") {
      return reply.status(404).send({
        error: "not_found",
        message: "no definition bundle published",
        requestId: req.id,
      });
    }
    if (result.kind === "not_modified") {
      return reply.status(304).header("etag", etagOf(result.sha256)).send();
    }
    // If-None-Match: the client already holds this exact content.
    const inm = req.headers["if-none-match"];
    const etag = etagOf(result.bundle.sha256);
    if (inm !== undefined && inm.split(",").map((v) => v.trim()).includes(etag)) {
      return reply.status(304).header("etag", etag).send();
    }
    return reply
      .status(200)
      .header("etag", etag)
      .header("cache-control", "private, no-cache") // revalidate with ETag; authed response
      .send(result.bundle);
  });
}
