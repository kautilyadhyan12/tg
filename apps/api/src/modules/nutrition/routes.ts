// P2.6a — nutrition routes (thin, R7.1). R3.3 order on the metered scan:
// authn → validateScan (400 never meters; retake consumed here) → meter
// (skipped when riding a retake) → handler. Photos are request-only and
// never logged/stored. Reformatted to house style at T3.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import type { AppConfig } from "../../config.js";
import type { RedisLike } from "../../redis.js";
import { requireQuota } from "../quotas/service.js";
import { createOpenFoodFactsProvider, type FoodSearchProvider } from "./openfoodfacts.adapter.js";
import {
  analyzeMealPhotoRequestSchema,
  bodyMeasurementInputSchema,
  createMealRequestSchema,
  dishwareInputSchema,
  foodSearchQuerySchema,
  nutritionListQuerySchema,
  patchBodyMeasurementSchema,
  patchDishwareSchema,
  patchMealRequestSchema,
} from "./schemas.js";
import * as service from "./service.js";
import { createVisionProvider, type VisionProvider } from "./vision.adapter.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by validateScan; present on the analyze-photo handler. */
    nutritionScanInput?: { imageBase64: string; mimeType: "image/jpeg" | "image/png" | "image/webp" };
    nutritionUsedRetake?: boolean;
  }
}

export interface NutritionRouteOverrides {
  visionProvider?: VisionProvider;
  foodSearchProvider?: FoodSearchProvider;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const authedUserId = (req: FastifyRequest): string => {
  const id = req.authUser?.id;
  if (id === undefined) throw new Error("authenticate preHandler did not run");
  return id;
};

type SafeParseResult<T> = { success: true; data: T } | { success: false; error: z.ZodError };

/** Zod-parse; 400 with issue paths/codes only — never echo values (R3.10:
 *  doubly vital here, a value could be the image itself). */
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

const notFound = (req: FastifyRequest, reply: FastifyReply) =>
  reply.status(404).send({ error: "not_found", message: "Resource not found", requestId: req.id });

// Opaque cursor: base64url({at, id}), Zod-checked on the way back in.
import { z as zod } from "zod";
const cursorSchema = zod.object({ at: zod.string().datetime(), id: zod.string().uuid() }).strict();
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

/** Magic bytes vs the DECLARED mime (R3.9): jpeg FFD8FF · png 8-byte sig ·
 *  webp RIFF....WEBP. */
function validMagic(bytes: Buffer, mime: string): boolean {
  if (mime === "image/jpeg") return bytes.at(0) === 0xff && bytes.at(1) === 0xd8 && bytes.at(2) === 0xff;
  if (mime === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

export function registerNutritionRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; redis: RedisLike; config: AppConfig },
  overrides: NutritionRouteOverrides = {},
): void {
  const nutritionDeps: service.NutritionDeps = {
    sql: deps.sql,
    redis: deps.redis,
    vision:
      overrides.visionProvider ??
      (deps.config.GROQ_API_KEY === undefined
        ? null
        : createVisionProvider(deps.config.GROQ_API_KEY, deps.config.MEAL_VISION_MODEL)),
    foods: overrides.foodSearchProvider ?? createOpenFoodFactsProvider(),
    log: app.log,
  };
  const readDeps = { sql: deps.sql };
  app.decorateRequest("nutritionScanInput", undefined);
  app.decorateRequest("nutritionUsedRetake", undefined);

  /** Validation BEFORE the meter (P2.5b finding-1 precedent): base64 shape,
   *  1 KB–10 MB decoded, magic bytes; a valid retakeToken is consumed here
   *  so the meter can skip the quota increment (§3.5). */
  const validateScan = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const input = parse(analyzeMealPhotoRequestSchema, req.body, req, reply);
    if (input === null) return;
    if (input.imageBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.imageBase64)) {
      void reply.status(400).send({ error: "invalid_image", message: "Image must be valid base64.", requestId: req.id });
      return;
    }
    const bytes = Buffer.from(input.imageBase64, "base64");
    if (bytes.length < 1000 || bytes.length > 10 * 1024 * 1024 || !validMagic(bytes, input.mimeType)) {
      void reply.status(400).send({
        error: "invalid_image",
        message: "Image must be a JPEG, PNG, or WebP up to 10 MB.",
        requestId: req.id,
      });
      return;
    }
    req.nutritionScanInput = { imageBase64: input.imageBase64, mimeType: input.mimeType };
    req.nutritionUsedRetake = false;
    if (input.retakeToken !== undefined) {
      await service.consumeRetake(nutritionDeps, authedUserId(req), input.retakeToken);
      req.nutritionUsedRetake = true;
    }
  };

  const quota = requireQuota("meal_scan", { sql: deps.sql, redis: deps.redis });
  const meter = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (req.nutritionUsedRetake !== true) await quota(req, reply);
  };

  app.post(
    "/v1/nutrition/analyze-photo",
    { bodyLimit: 14 * 1024 * 1024 + 1024, preHandler: [app.authenticate, validateScan, meter] },
    async (req, reply) => {
      const input = req.nutritionScanInput;
      if (input === undefined) throw new Error("scan validation did not run");
      try {
        const draft = await service.analyzePhoto(
          nutritionDeps,
          authedUserId(req),
          input.imageBase64,
          input.mimeType,
          req.nutritionUsedRetake === true,
        );
        return await reply.status(200).send(draft);
      } catch (err) {
        if (err instanceof service.RetakeRequiredError) {
          return await reply.status(422).send({
            error: err.code,
            message: err.message,
            ...(err.retakeToken === null ? {} : { retakeToken: err.retakeToken }),
            requestId: req.id,
          });
        }
        throw err;
      }
    },
  );

  app.get("/v1/nutrition/foods", { preHandler: [app.authenticate] }, async (req, reply) => {
    const q = parse(foodSearchQuerySchema, req.query, req, reply);
    if (q === null) return;
    return reply.send({ items: await service.searchFoods(nutritionDeps, q.q, q.limit) });
  });

  // Photo confirm (scanToken) or manual entry (mealName) — GAP-2 ruling.
  app.post("/v1/nutrition/meals", { preHandler: [app.authenticate] }, async (req, reply) => {
    const v = parse(createMealRequestSchema, req.body, req, reply);
    if (v === null) return;
    const meal =
      "scanToken" in v
        ? await service.confirmMeal(nutritionDeps, authedUserId(req), v)
        : await service.createManualMeal(nutritionDeps, authedUserId(req), v);
    return reply.status(201).send({ meal });
  });

  app.get("/v1/nutrition/meals", { preHandler: [app.authenticate] }, async (req, reply) => {
    const q = parse(nutritionListQuerySchema, req.query, req, reply);
    if (q === null) return;
    const cursor = cursorDecode(q.cursor);
    if (q.cursor !== undefined && cursor === null) {
      return reply.status(400).send({ error: "validation_error", message: "cursor: invalid", requestId: req.id });
    }
    const page = await service.listMeals(nutritionDeps, authedUserId(req), q.limit, cursor);
    return reply.send({
      items: page.items,
      nextCursor: page.next === null ? null : cursorEncode({ at: page.next.takenAt, id: page.next.id }),
    });
  });

  app.get<{ Params: { id: string } }>(
    "/v1/nutrition/meals/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return notFound(req, reply);
      const meal = await service.getMeal(nutritionDeps, authedUserId(req), req.params.id);
      return meal === null ? notFound(req, reply) : reply.send({ meal });
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/v1/nutrition/meals/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return notFound(req, reply);
      const v = parse(patchMealRequestSchema, req.body, req, reply);
      if (v === null) return;
      const meal = await service.patchMeal(nutritionDeps, authedUserId(req), req.params.id, v);
      return meal === null ? notFound(req, reply) : reply.send({ meal });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/nutrition/meals/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return notFound(req, reply);
      const deleted = await service.deleteMeal(readDeps, authedUserId(req), req.params.id);
      return deleted ? reply.status(204).send() : notFound(req, reply);
    },
  );

  app.get("/v1/nutrition/dishware", { preHandler: [app.authenticate] }, async (req, reply) => {
    const q = parse(nutritionListQuerySchema, req.query, req, reply);
    if (q === null) return;
    const cursor = cursorDecode(q.cursor);
    if (q.cursor !== undefined && cursor === null) {
      return reply.status(400).send({ error: "validation_error", message: "cursor: invalid", requestId: req.id });
    }
    const rows = await service.listDishware(readDeps, authedUserId(req), q.limit, cursor);
    const page = rows.slice(0, q.limit);
    const last = rows.length > q.limit ? page.at(-1) : undefined;
    return reply.send({
      items: page,
      nextCursor: last === undefined ? null : cursorEncode({ at: last.createdAt, id: last.id }),
    });
  });

  app.post("/v1/nutrition/dishware", { preHandler: [app.authenticate] }, async (req, reply) => {
    const v = parse(dishwareInputSchema, req.body, req, reply);
    if (v === null) return;
    return reply.status(201).send({ dishware: await service.createDishware(readDeps, authedUserId(req), v) });
  });

  app.patch<{ Params: { id: string } }>(
    "/v1/nutrition/dishware/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return notFound(req, reply);
      const v = parse(patchDishwareSchema, req.body, req, reply);
      if (v === null) return;
      const row = await service.updateDishware(readDeps, authedUserId(req), req.params.id, v);
      return row === null ? notFound(req, reply) : reply.send({ dishware: row });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/nutrition/dishware/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return notFound(req, reply);
      const deleted = await service.deleteDishware(readDeps, authedUserId(req), req.params.id);
      return deleted ? reply.status(204).send() : notFound(req, reply);
    },
  );

  app.get("/v1/nutrition/body-measurements", { preHandler: [app.authenticate] }, async (req, reply) => {
    const q = parse(nutritionListQuerySchema, req.query, req, reply);
    if (q === null) return;
    const cursor = cursorDecode(q.cursor);
    if (q.cursor !== undefined && cursor === null) {
      return reply.status(400).send({ error: "validation_error", message: "cursor: invalid", requestId: req.id });
    }
    const rows = await service.listMeasurements(readDeps, authedUserId(req), q.limit, cursor);
    const page = rows.slice(0, q.limit);
    const last = rows.length > q.limit ? page.at(-1) : undefined;
    return reply.send({
      items: page,
      nextCursor: last === undefined ? null : cursorEncode({ at: last.measuredAt, id: last.id }),
    });
  });

  app.post("/v1/nutrition/body-measurements", { preHandler: [app.authenticate] }, async (req, reply) => {
    const v = parse(bodyMeasurementInputSchema, req.body, req, reply);
    if (v === null) return;
    return reply.status(201).send({ measurement: await service.createMeasurement(readDeps, authedUserId(req), v) });
  });

  app.patch<{ Params: { id: string } }>(
    "/v1/nutrition/body-measurements/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return notFound(req, reply);
      const v = parse(patchBodyMeasurementSchema, req.body, req, reply);
      if (v === null) return;
      const row = await service.updateMeasurement(readDeps, authedUserId(req), req.params.id, v);
      return row === null ? notFound(req, reply) : reply.send({ measurement: row });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/nutrition/body-measurements/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return notFound(req, reply);
      const deleted = await service.deleteMeasurement(readDeps, authedUserId(req), req.params.id);
      return deleted ? reply.status(204).send() : notFound(req, reply);
    },
  );
}
