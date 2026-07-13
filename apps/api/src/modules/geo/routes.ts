// P2.6b — geo routes (thin, R7.1). Web = browse/plan (v1 §12): route
// generation, saved_routes CRUD, runs read. Run RECORDING is mobile (P5).
// R3.3 order on the metered generate: authn → validate (400 never meters) →
// requireQuota("route_gen") → handler. Polylines are the most sensitive data
// the app holds — own-user-only (tenancy WHERE in repo), never logged.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import type { RedisLike } from "../../redis.js";
import { requireQuota } from "../quotas/service.js";
import type { GeocodeResolver } from "./geocode.js";
import { createOrsRouteProvider, type RouteProvider } from "./ors.adapter.js";
import { generateRoutesRequestSchema, geoListQuerySchema, savedRouteCreateSchema } from "./schemas.js";
import * as service from "./service.js";
import type { GeoDeps } from "./service.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by validateGenerate; present on the generate handler after the meter. */
    geoRouteInput?: import("@app/shared").GenerateRoutesRequest;
  }
}

export interface GeoRouteOverrides {
  routeProvider?: RouteProvider;
  /** Reserved for P5 (geocoding-on-save is mobile, v1 §12) — no P2.6b route
   *  wires a live resolver; the two-layer cache seam ships resolver-less by
   *  design (G1 ruling). Kept here so the P5 wiring is a one-line change. */
  geocodeResolver?: GeocodeResolver;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const authedUserId = (req: FastifyRequest): string => {
  const id = req.authUser?.id;
  if (id === undefined) throw new Error("authenticate preHandler did not run");
  return id;
};

type SafeParseResult<T> = { success: true; data: T } | { success: false; error: z.ZodError };

/** Zod-parse; 400 with issue paths/codes only — never echo values (R3.10). */
function parse<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
): z.output<S> | null {
  const parsed: SafeParseResult<z.output<S>> = schema.safeParse(value);
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

const notFound = (req: FastifyRequest, reply: FastifyReply): FastifyReply =>
  reply.status(404).send({ error: "not_found", message: "Resource not found", requestId: req.id });

// Opaque cursor: base64url({at, id}), Zod-checked on the way back in.
const cursorSchema = z.object({ at: z.string().datetime(), id: z.string().uuid() }).strict();
const cursorEncode = (v: { at: Date; id: string }): string =>
  Buffer.from(JSON.stringify({ at: v.at.toISOString(), id: v.id })).toString("base64url");
const cursorDecode = (v: string | undefined): { at: Date; id: string } | null => {
  if (v === undefined) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(v, "base64url").toString("utf8")));
    return parsed.success ? { at: new Date(parsed.data.at), id: parsed.data.id } : null;
  } catch {
    return null;
  }
};

export function registerGeoRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; redis: RedisLike; config: AppConfig },
  overrides: GeoRouteOverrides = {},
): void {
  const geoDeps: GeoDeps = {
    sql: deps.sql,
    routeProvider:
      overrides.routeProvider ??
      (deps.config.ORS_API_KEY === undefined ? null : createOrsRouteProvider(deps.config.ORS_API_KEY)),
    log: app.log,
  };
  const readDeps = { sql: deps.sql };
  app.decorateRequest("geoRouteInput", undefined);

  // Validation BEFORE the meter (P2.5b finding-1 precedent): a 400 must not burn
  // a route_gen quota slot. Sending a reply here short-circuits the preHandler
  // chain, so the quota preHandler below never runs on a bad body.
  const validateGenerate = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const input = parse(generateRoutesRequestSchema, req.body, req, reply);
    if (input === null) return;
    req.geoRouteInput = input;
  };
  const quota = requireQuota("route_gen", { sql: deps.sql, redis: deps.redis });

  app.post(
    "/v1/geo/routes/generate",
    { preHandler: [app.authenticate, validateGenerate, quota] },
    async (req, reply) => {
      const input = req.geoRouteInput;
      if (input === undefined) throw new Error("route validation did not run");
      const result = await service.generateRoutes(geoDeps, authedUserId(req), input);
      return reply.status(200).send(result);
    },
  );

  // ── saved_routes CRUD ──────────────────────────────────────────────────────

  app.post("/v1/geo/saved-routes", { preHandler: [app.authenticate] }, async (req, reply) => {
    const v = parse(savedRouteCreateSchema, req.body, req, reply);
    if (v === null) return;
    return reply.status(201).send({ savedRoute: await service.createSavedRoute(readDeps, authedUserId(req), v) });
  });

  app.get("/v1/geo/saved-routes", { preHandler: [app.authenticate] }, async (req, reply) => {
    const q = parse(geoListQuerySchema, req.query, req, reply);
    if (q === null) return;
    const cursor = cursorDecode(q.cursor);
    if (q.cursor !== undefined && cursor === null) {
      return reply.status(400).send({ error: "validation_error", message: "cursor: invalid", requestId: req.id });
    }
    const page = await service.listSavedRoutes(readDeps, authedUserId(req), q.limit, cursor);
    return reply.send({
      items: page.items,
      nextCursor: page.next === null ? null : cursorEncode({ at: page.next.createdAt, id: page.next.id }),
    });
  });

  app.get<{ Params: { id: string } }>(
    "/v1/geo/saved-routes/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return notFound(req, reply);
      const route = await service.getSavedRoute(readDeps, authedUserId(req), req.params.id);
      return route === null ? notFound(req, reply) : reply.send({ savedRoute: route });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/geo/saved-routes/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return notFound(req, reply);
      const deleted = await service.deleteSavedRoute(readDeps, authedUserId(req), req.params.id);
      return deleted ? reply.status(204).send() : notFound(req, reply);
    },
  );

  // ── runs (read-only; record/sync = P5) ─────────────────────────────────────

  app.get("/v1/geo/runs", { preHandler: [app.authenticate] }, async (req, reply) => {
    const q = parse(geoListQuerySchema, req.query, req, reply);
    if (q === null) return;
    const cursor = cursorDecode(q.cursor);
    if (q.cursor !== undefined && cursor === null) {
      return reply.status(400).send({ error: "validation_error", message: "cursor: invalid", requestId: req.id });
    }
    const page = await service.listRuns(readDeps, authedUserId(req), q.limit, cursor);
    return reply.send({
      items: page.items,
      nextCursor: page.next === null ? null : cursorEncode({ at: page.next.startedAt, id: page.next.id }),
    });
  });

  app.get<{ Params: { id: string } }>("/v1/geo/runs/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!UUID.test(req.params.id)) return notFound(req, reply);
    const run = await service.getRun(readDeps, authedUserId(req), req.params.id);
    return run === null ? notFound(req, reply) : reply.send({ run });
  });
}
