// P2.6a — nutrition routes (thin, R7.1). R3.3 order on the metered scan:
// authn → validateScan (a switched-off or paused scanner 503s and a 400 never
// meters; retake consumed here) → meter
// (skipped when riding a retake) → handler. Photos are request-only and
// never logged/stored. Reformatted to house style at T3.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import { MEAL_PHOTO_MAX_BYTES, barcodeParamSchema, cleanPhoto, labelFoodParamSchema, labelFoodSaveSchema } from "@app/shared";
import type { AppConfig } from "../../config.js";
import type { RedisLike } from "../../redis.js";
import { createDualRateLimit } from "../auth/rateLimit.js";
import { quotaLeft, requireQuota } from "../quotas/service.js";
import { createOpenFoodFactsProvider, type FoodSearchProvider } from "./openfoodfacts.adapter.js";
import {
  analyzeMealPhotoRequestSchema,
  bodyMeasurementInputSchema,
  createDishwareRequestSchema,
  createMealRequestSchema,
  dietPlanDayParamsSchema,
  foodSearchQuerySchema,
  foodWeekQuerySchema,
  makeDietPlanRequestSchema,
  mealEditPreviewRequestSchema,
  nutritionListQuerySchema,
  patchBodyMeasurementSchema,
  patchDishwareSchema,
  patchMealRequestSchema,
  previewMealRequestSchema,
  putDietPlanDayRequestSchema,
  putNutritionTargetsRequestSchema,
  swapDietPlanMealRequestSchema,
} from "./schemas.js";
import * as dietPlan from "./dietPlanService.js";
import * as service from "./service.js";
import { createLabelReader, createMealMatchChecker, createMealVisionProvider, type LabelReader, type MatchChecker, type VisionProvider } from "./vision.adapter.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by validateScan; present on the analyze-photo handler. */
    nutritionScanInput?: { imageBase64: string; mimeType: "image/jpeg" | "image/png" | "image/webp" };
    nutritionUsedRetake?: boolean;
    /** Set by the meter: the quota key the scan was counted under. */
    nutritionScanQuotaKey?: string;
  }
}

export interface NutritionRouteOverrides {
  visionProvider?: VisionProvider;
  /** null switches the match check off: the foods are priced by the tables alone. */
  matchChecker?: MatchChecker | null;
  foodSearchProvider?: FoodSearchProvider;
  labelReader?: LabelReader;
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
  deps: { sql: Sql; redis: RedisLike; config: AppConfig; reportError: (err: unknown, requestId: string) => void },
  overrides: NutritionRouteOverrides = {},
): void {
  const nutritionDeps: service.NutritionDeps = {
    sql: deps.sql,
    redis: deps.redis,
    vision: overrides.visionProvider ?? createMealVisionProvider(deps.config),
    matchChecker: overrides.matchChecker === undefined ? createMealMatchChecker(deps.config) : overrides.matchChecker,
    labels: overrides.labelReader ?? createLabelReader(deps.config),
    visionModel: deps.config.MEAL_VISION_MODEL,
    foods: overrides.foodSearchProvider ?? createOpenFoodFactsProvider(),
    log: app.log,
    reportError: deps.reportError,
  };
  const readDeps = { sql: deps.sql };
  app.decorateRequest("nutritionScanInput", undefined);
  app.decorateRequest("nutritionUsedRetake", undefined);
  app.decorateRequest("nutritionScanQuotaKey", undefined);

  /** Validation BEFORE the meter (P2.5b finding-1 precedent): base64 shape,
   *  1 KB–10 MB decoded, magic bytes; a valid retakeToken is consumed here
   *  so the meter can skip the quota increment (§3.5). */
  const validateScan = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // A scanner switched off (its key unset) costs no scan and no retake, and
    // neither does one paused for this person after their scans kept failing.
    if (nutritionDeps.vision === null || (await service.scannerPaused(nutritionDeps, authedUserId(req)))) {
      void reply.status(503).send({ error: "nutrition_unavailable", message: "Meal scanning is temporarily unavailable.", requestId: req.id });
      return;
    }
    const input = parse(analyzeMealPhotoRequestSchema, req.body, req, reply);
    if (input === null) return;
    if (input.imageBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.imageBase64)) {
      void reply.status(400).send({ error: "invalid_image", message: "Image must be valid base64.", requestId: req.id });
      return;
    }
    const bytes = Buffer.from(input.imageBase64, "base64");
    // Rebuilt from the parts that draw the picture before the scanner sees it: whatever a client
    // sent, no place or time it was taken goes on to OpenAI (ROADMAP Stage 5 33b-i).
    const cleaned = bytes.length < 1000 || !validMagic(bytes, input.mimeType) ? null : cleanPhoto(bytes, MEAL_PHOTO_MAX_BYTES);
    if (cleaned === null || !cleaned.ok) {
      // A photo too large is told its limit; one that cannot be read, or is too many pixels, says so.
      const tooBig = cleaned === null || cleaned.problem === "too_big" || cleaned.problem === "not_a_photo";
      void reply.status(400).send({
        error: "invalid_image",
        message: tooBig ? "Image must be a JPEG, PNG, or WebP up to 10 MB." : "That photo couldn't be read. Try another one.",
        requestId: req.id,
      });
      return;
    }
    req.nutritionScanInput = { imageBase64: Buffer.from(cleaned.bytes).toString("base64"), mimeType: cleaned.type };
    req.nutritionUsedRetake = false;
    if (input.retakeToken !== undefined) {
      await service.consumeRetake(nutritionDeps, authedUserId(req), input.retakeToken);
      req.nutritionUsedRetake = true;
    }
  };

  const quota = requireQuota("meal_scan", { sql: deps.sql, redis: deps.redis }, (req, key) => {
    req.nutritionScanQuotaKey = key;
  });
  const meter = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (req.nutritionUsedRetake !== true) await quota(req, reply);
  };

  app.post(
    "/v1/nutrition/analyze-photo",
    { bodyLimit: 14 * 1024 * 1024 + 1024, preHandler: [app.authenticate, validateScan, meter] },
    async (req, reply) => {
      const input = req.nutritionScanInput;
      if (input === undefined) throw new Error("scan validation did not run");
      const quotaKey = req.nutritionScanQuotaKey;
      const paidWith: service.ScanPaidWith | null =
        req.nutritionUsedRetake === true ? { retake: true } : quotaKey === undefined ? null : { quotaKey };
      if (paidWith === null) throw new Error("the scan meter did not run");
      try {
        const draft = await service.analyzePhoto(
          nutritionDeps,
          authedUserId(req),
          input.imageBase64,
          input.mimeType,
          paidWith,
          req.id,
        );
        return await reply.status(200).send(draft);
      } catch (err) {
        if (err instanceof service.ScanFailedError) {
          return await reply.status(err.statusCode).send({
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

  // A pack's label (ROADMAP 33b-iii-c): the same checks and meter as a meal photo, and one scan counted.
  app.post(
    "/v1/nutrition/labels/read",
    { bodyLimit: 14 * 1024 * 1024 + 1024, preHandler: [app.authenticate, validateScan, meter] },
    async (req, reply) => {
      const input = req.nutritionScanInput;
      if (input === undefined) throw new Error("scan validation did not run");
      const quotaKey = req.nutritionScanQuotaKey;
      const paidWith: service.ScanPaidWith | null =
        req.nutritionUsedRetake === true ? { retake: true } : quotaKey === undefined ? null : { quotaKey };
      if (paidWith === null) throw new Error("the scan meter did not run");
      try {
        return await reply.status(200).send(await service.readLabel(nutritionDeps, authedUserId(req), input.imageBase64, input.mimeType, paidWith, req.id));
      } catch (err) {
        if (err instanceof service.ScanFailedError) {
          return await reply.status(err.statusCode).send({
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

  /** How many photo scans the person has left: their own, from their own session. */
  app.get("/v1/nutrition/photo-scans", { preHandler: [app.authenticate] }, async (req, reply) =>
    reply.send(await quotaLeft("meal_scan", { sql: deps.sql, redis: deps.redis }, authedUserId(req))),
  );

  /** The macro rings' daily calories and macros: the person's own plan, from
   *  their stored onboarding answers (R3.1; ROADMAP 4a-iii) — the same number
   *  the onboarding screens show. No input to parse — the identity is the
   *  request's own session, so there is no id to tamper with. Responds
   *  { targets: null, missing: [...] } while the plan still lacks an answer:
   *  the server never fabricates a target (RULINGS 2026-07-15). */
  app.get("/v1/nutrition/targets", { preHandler: [app.authenticate] }, async (req, reply) => {
    return reply.send(await service.getTargets(nutritionDeps, authedUserId(req)));
  });

  /** The switch over the rings (ROADMAP 7a-iv-e): App's plan, or My own with
   *  the four numbers. One row per person keyed on the session's own id — no id
   *  to tamper with, as above. The health rules are the server's: typed
   *  calories under the app's floor, or under what keeps the weight for a plan
   *  that holds no cut, come back 400 with the number that binds. */
  app.put("/v1/nutrition/targets", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = parse(putNutritionTargetsRequestSchema, req.body, req, reply);
    if (body === null) return;
    return reply.send(await service.putTargets(nutritionDeps, authedUserId(req), body));
  });

  /** Meal ideas for what is left of today (ROADMAP 34d-i). Nothing to parse:
   *  the person is the session's own, so there is no id to change. No model
   *  call and no quota: the ideas are drawn from the food list. */
  app.get("/v1/nutrition/suggestions", { preHandler: [app.authenticate] }, async (req, reply) => {
    return reply.send(await service.getMealIdeas(nutritionDeps, authedUserId(req)));
  });

  /** Your week in food (ROADMAP 34f-i): the last 7 or 30 days of the person's own
   *  meals against each day's targets. The person is the session's own, so there is
   *  no id to change; no model call and no quota. */
  app.get("/v1/nutrition/food-week", { preHandler: [app.authenticate] }, async (req, reply) => {
    const q = parse(foodWeekQuerySchema, req.query, req, reply);
    if (q === null) return;
    return reply.send(await service.getFoodWeek(readDeps, authedUserId(req), q.days));
  });

  /** The person's own diet plan (ROADMAP 34e-i): one plan for each person, keyed on the
   *  session's own id, so there is no plan id to change and nobody reaches another's.
   *  Each change carries the phone's own `changeId`: sent twice, it is made once. No
   *  model call and no quota; the app-wide limit bounds it, as for the meal ideas. */
  app.get("/v1/nutrition/diet-plan", { preHandler: [app.authenticate] }, async (req, reply) => {
    return reply.send(await dietPlan.getDietPlan(readDeps, authedUserId(req)));
  });

  app.post("/v1/nutrition/diet-plan/make", { preHandler: [app.authenticate] }, async (req, reply) => {
    const v = parse(makeDietPlanRequestSchema, req.body, req, reply);
    if (v === null) return;
    return reply.send(await dietPlan.makeDietPlan(nutritionDeps, authedUserId(req), v));
  });

  app.put("/v1/nutrition/diet-plan/days/:day", { preHandler: [app.authenticate] }, async (req, reply) => {
    const p = parse(dietPlanDayParamsSchema, req.params, req, reply);
    if (p === null) return;
    const v = parse(putDietPlanDayRequestSchema, req.body, req, reply);
    if (v === null) return;
    return reply.send(await dietPlan.putDietPlanDay(nutritionDeps, authedUserId(req), p.day, v));
  });

  app.post("/v1/nutrition/diet-plan/days/:day/swap", { preHandler: [app.authenticate] }, async (req, reply) => {
    const p = parse(dietPlanDayParamsSchema, req.params, req, reply);
    if (p === null) return;
    const v = parse(swapDietPlanMealRequestSchema, req.body, req, reply);
    if (v === null) return;
    return reply.send(await dietPlan.swapDietPlanMeal(nutritionDeps, authedUserId(req), p.day, v));
  });

  app.get("/v1/nutrition/foods", { preHandler: [app.authenticate] }, async (req, reply) => {
    const q = parse(foodSearchQuerySchema, req.query, req, reply);
    if (q === null) return;
    return reply.send({ items: await service.searchFoods(nutritionDeps, q.q, q.limit) });
  });

  // A pack's barcode (ROADMAP 33b-iii-a). It uses none of a person's scans: no AI runs, and it is one
  // read of our own copy. The limit only stops a script: no one scans 120 packs a minute. A gym's wi-fi
  // is one address for all its members, so the address is not counted.
  const barcodeLimit = createDualRateLimit({
    name: "nutrition_barcode",
    max: 120,
    ipMax: null,
    windowMs: 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  app.get("/v1/nutrition/barcode/:code", { preHandler: [app.authenticate, barcodeLimit] }, async (req, reply) => {
    const p = parse(barcodeParamSchema, req.params, req, reply);
    if (p === null) return;
    return reply.send(await service.barcodeLookup(nutritionDeps, authedUserId(req), p.code));
  });

  /** The person's last different foods, each at the amount they last had (ROADMAP 32b-ii-a). */
  // What a person checked against a pack. Only stops a script: saving costs no scan.
  const labelLimit = createDualRateLimit({
    name: "nutrition_label_save",
    max: 60,
    ipMax: null,
    windowMs: 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  app.get("/v1/nutrition/labels", { preHandler: [app.authenticate, labelLimit] }, async (req, reply) =>
    reply.send(await service.labelFoodsOf(nutritionDeps, authedUserId(req))),
  );
  app.put("/v1/nutrition/labels/:id", { preHandler: [app.authenticate, labelLimit] }, async (req, reply) => {
    const p = parse(labelFoodParamSchema, req.params, req, reply);
    if (p === null) return;
    const body = parse(labelFoodSaveSchema, req.body, req, reply);
    if (body === null) return;
    const saved = await service.saveLabelFood(nutritionDeps, authedUserId(req), p.id, body);
    return saved === null ? notFound(req, reply) : reply.send(saved);
  });
  app.delete("/v1/nutrition/labels/:id", { preHandler: [app.authenticate, labelLimit] }, async (req, reply) => {
    const p = parse(labelFoodParamSchema, req.params, req, reply);
    if (p === null) return;
    return (await service.removeLabelFood(nutritionDeps, authedUserId(req), p.id)) ? reply.status(204).send() : notFound(req, reply);
  });

  app.get("/v1/nutrition/foods/recent", { preHandler: [app.authenticate] }, async (req, reply) => {
    return reply.send({ items: await service.recentFoodsOf(nutritionDeps, authedUserId(req)) });
  });

  /** Live preview (Kd-approved 2026-07-16): server-computed nutrition for
   *  proposed grams, nothing persisted, NO quota (no AI call — curated-table
   *  math; the §9.3 ledger meters spend, and there is none here). */
  app.post("/v1/nutrition/meals/preview", { preHandler: [app.authenticate] }, async (req, reply) => {
    const v = parse(previewMealRequestSchema, req.body, req, reply);
    if (v === null) return;
    return reply.send(await service.previewMeal(nutritionDeps, authedUserId(req), v));
  });

  // Photo confirm (scanToken) or manual entry (mealName) — GAP-2 ruling. With the
  // phone's own `id` the same meal sent twice is one meal: 201 when it is saved,
  // 200 with the meal as it is now when it already was (ROADMAP 32a).
  app.post("/v1/nutrition/meals", { preHandler: [app.authenticate] }, async (req, reply) => {
    const v = parse(createMealRequestSchema, req.body, req, reply);
    if (v === null) return;
    const saved =
      "scanToken" in v
        ? await service.confirmMeal(nutritionDeps, authedUserId(req), v)
        : await service.createManualMeal(nutritionDeps, authedUserId(req), v);
    return reply.status(saved.created ? 201 : 200).send({ meal: saved.meal });
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

  /** A logged food changed (ROADMAP 7a-iv-g): what the meal's items would come to,
   *  nothing saved — the same rule the PATCH saves by. No quota: no AI call. */
  app.post<{ Params: { id: string } }>(
    "/v1/nutrition/meals/:id/preview",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return notFound(req, reply);
      const v = parse(mealEditPreviewRequestSchema, req.body, req, reply);
      if (v === null) return;
      const preview = await service.previewMealEdit(nutritionDeps, authedUserId(req), req.params.id, v);
      return preview === null ? notFound(req, reply) : reply.send(preview);
    },
  );

  /** Each of a saved meal's items' measures, so a logged food opens in the measure
   *  picker (ROADMAP 7a-iv-g). */
  app.get<{ Params: { id: string } }>(
    "/v1/nutrition/meals/:id/measures",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return notFound(req, reply);
      const measures = await service.mealMeasures(nutritionDeps, authedUserId(req), req.params.id);
      return measures === null ? notFound(req, reply) : reply.send({ measures });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/nutrition/meals/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return notFound(req, reply);
      const deleted = await service.deleteMeal(nutritionDeps, authedUserId(req), req.params.id);
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

  // With the phone's own `id` the same dish sent twice is one dish: 201 when it is saved, 200 with
  // the dish as it is now when it already was, 404 for an id that is somebody else's (ROADMAP 32b-ii-b).
  app.post("/v1/nutrition/dishware", { preHandler: [app.authenticate] }, async (req, reply) => {
    const v = parse(createDishwareRequestSchema, req.body, req, reply);
    if (v === null) return;
    const saved = await service.createDishware(readDeps, authedUserId(req), v);
    if (saved === null) return notFound(req, reply);
    return reply.status(saved.created ? 201 : 200).send({ dishware: saved.dish });
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
    // An account deleted while this request waited on it is a 401 from the
    // service — the answer sign-in gives every request after a deletion.
    const measurement = await service.createMeasurement(readDeps, authedUserId(req), v);
    return reply.status(201).send({ measurement });
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
