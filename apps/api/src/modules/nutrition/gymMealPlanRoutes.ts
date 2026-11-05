// The meal plans a gym gives its members: the console's routes (ROADMAP Stage 2 24a-i). Authenticate,
// Zod-parse, and the service asks the Plans tick before the rate limit and the handler.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createGymMealPlanRequestSchema, giveGymMealPlanRequestSchema, gymMealPlanEntryParamsSchema, stopGymMealPlanRequestSchema, gymMealPlanDayParamsSchema, gymMealPlanMealParamsSchema, gymMealPlanParamsSchema,
  putGymMealPlanDayRequestSchema, renameGymMealPlanRequestSchema,
} from "@app/shared";
import { createDualRateLimit } from "../auth/rateLimit.js";
import { parseOr400, requireUserId } from "../orgs/posts/routes.js";
import { gymInPath, orgParamsSchema } from "../orgs/schemas.js";
import * as giving from "./gymMealPlanGivingService.js";
import * as service from "./gymMealPlanService.js";
import type { NutritionDeps } from "./service.js";

export function registerGymMealPlanRoutes(app: FastifyInstance, deps: NutritionDeps): void {
  const limiter = (name: string, max: number, ipMax: number) =>
    createDualRateLimit({
      name,
      max,
      ipMax,
      windowMs: 60 * 60 * 1000,
      identifier: (req) => req.authUser?.id ?? null,
      // Each gym has its own count at an address, asked after who is asking.
      ipScope: gymInPath,
      redis: deps.redis,
    });
  // Several staff of one gym share its wi-fi, hence each explicit `ipMax`. A week is written a day
  // at a time, each food's amount changed with its measures open.
  const readLimit = limiter("gym_meal_plans_read", 1200, 6000);
  const writeLimit = limiter("gym_meal_plans_write", 600, 3000);
  // A member's phone reads its gym's plan when Food or the Dashboard opens; a gym's members share
  // its wi-fi.
  const mineLimit = limiter("gym_meal_plan_mine", 600, 6000);
  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };

  app.get("/v1/orgs/:gymId/meal-plans", { preHandler: app.authenticate }, async (req, reply) => {
    const p = parseOr400(orgParamsSchema, req.params, req, reply);
    if (p === null) return;
    const plans = await giving.listGymMealPlans(deps, requireUserId(req), p.gymId, gate(readLimit)(req, reply));
    if (plans === null) return;
    return reply.status(200).send(plans);
  });

  app.post("/v1/orgs/:gymId/meal-plans", { preHandler: app.authenticate }, async (req, reply) => {
    const p = parseOr400(orgParamsSchema, req.params, req, reply);
    if (p === null) return;
    const body = parseOr400(createGymMealPlanRequestSchema, req.body, req, reply);
    if (body === null) return;
    const plan = await service.createGymMealPlan(deps, requireUserId(req), p.gymId, body, gate(writeLimit)(req, reply));
    if (plan === null) return;
    return reply.status(200).send(plan);
  });

  app.get("/v1/orgs/:gymId/meal-plans/:planId", { preHandler: app.authenticate }, async (req, reply) => {
    const p = parseOr400(gymMealPlanParamsSchema, req.params, req, reply);
    if (p === null) return;
    const plan = await service.getGymMealPlan(deps, requireUserId(req), p.gymId, p.planId, gate(readLimit)(req, reply));
    if (plan === null) return;
    return reply.status(200).send(plan);
  });

  app.patch("/v1/orgs/:gymId/meal-plans/:planId", { preHandler: app.authenticate }, async (req, reply) => {
    const p = parseOr400(gymMealPlanParamsSchema, req.params, req, reply);
    if (p === null) return;
    const body = parseOr400(renameGymMealPlanRequestSchema, req.body, req, reply);
    if (body === null) return;
    const plan = await service.renameGymMealPlan(deps, requireUserId(req), p.gymId, p.planId, body, gate(writeLimit)(req, reply));
    if (plan === null) return;
    return reply.status(200).send(plan);
  });

  app.delete("/v1/orgs/:gymId/meal-plans/:planId", { preHandler: app.authenticate }, async (req, reply) => {
    const p = parseOr400(gymMealPlanParamsSchema, req.params, req, reply);
    if (p === null) return;
    if (!(await service.deleteGymMealPlan(deps, requireUserId(req), p.gymId, p.planId, gate(writeLimit)(req, reply)))) return;
    return reply.status(204).send();
  });

  app.put("/v1/orgs/:gymId/meal-plans/:planId/days/:day", { preHandler: app.authenticate }, async (req, reply) => {
    const p = parseOr400(gymMealPlanDayParamsSchema, req.params, req, reply);
    if (p === null) return;
    const body = parseOr400(putGymMealPlanDayRequestSchema, req.body, req, reply);
    if (body === null) return;
    const plan = await service.putGymMealPlanDay(deps, requireUserId(req), p.gymId, p.planId, p.day, body, gate(writeLimit)(req, reply));
    if (plan === null) return;
    return reply.status(200).send(plan);
  });

  app.get("/v1/orgs/:gymId/meal-plans/:planId/days/:day/meals/:meal/measures", { preHandler: app.authenticate }, async (req, reply) => {
    const p = parseOr400(gymMealPlanMealParamsSchema, req.params, req, reply);
    if (p === null) return;
    const measures = await service.gymMealPlanMeasures(deps, requireUserId(req), p.gymId, p.planId, p.day, p.meal, gate(readLimit)(req, reply));
    if (measures === null) return;
    return reply.status(200).send({ measures });
  });

  // ── Who gets a plan (24a-ii) ──

  app.get("/v1/orgs/:gymId/meal-plans/mine", { preHandler: app.authenticate }, async (req, reply) => {
    const p = parseOr400(orgParamsSchema, req.params, req, reply);
    if (p === null) return;
    const mine = await giving.myGymMealPlan(deps, requireUserId(req), p.gymId, gate(mineLimit)(req, reply));
    if (mine === null) return;
    return reply.status(200).send(mine);
  });

  app.get("/v1/orgs/:gymId/meal-plans/groups", { preHandler: app.authenticate }, async (req, reply) => {
    const p = parseOr400(orgParamsSchema, req.params, req, reply);
    if (p === null) return;
    const groups = await giving.groupChoices(deps, requireUserId(req), p.gymId, gate(readLimit)(req, reply));
    if (groups === null) return;
    return reply.status(200).send(groups);
  });

  app.get("/v1/orgs/:gymId/meal-plans/:planId/given", { preHandler: app.authenticate }, async (req, reply) => {
    const p = parseOr400(gymMealPlanParamsSchema, req.params, req, reply);
    if (p === null) return;
    const given = await giving.givenOf(deps, requireUserId(req), p.gymId, p.planId, gate(readLimit)(req, reply));
    if (given === null) return;
    return reply.status(200).send({ given });
  });

  app.post("/v1/orgs/:gymId/meal-plans/:planId/give-preview", { preHandler: app.authenticate }, async (req, reply) => {
    const p = parseOr400(gymMealPlanParamsSchema, req.params, req, reply);
    if (p === null) return;
    const body = parseOr400(giveGymMealPlanRequestSchema, req.body, req, reply);
    if (body === null) return;
    const preview = await giving.previewGiveToGroup(deps, requireUserId(req), p.gymId, p.planId, body.to, gate(readLimit)(req, reply));
    if (preview === null) return;
    return reply.status(200).send({ preview });
  });

  app.post("/v1/orgs/:gymId/meal-plans/:planId/give", { preHandler: app.authenticate }, async (req, reply) => {
    const p = parseOr400(gymMealPlanParamsSchema, req.params, req, reply);
    if (p === null) return;
    const body = parseOr400(giveGymMealPlanRequestSchema, req.body, req, reply);
    if (body === null) return;
    const given = await giving.giveToGroup(deps, requireUserId(req), p.gymId, p.planId, body.to, gate(writeLimit)(req, reply));
    if (given === null) return;
    return reply.status(200).send({ given });
  });

  app.post("/v1/orgs/:gymId/meal-plans/:planId/stop", { preHandler: app.authenticate }, async (req, reply) => {
    const p = parseOr400(gymMealPlanParamsSchema, req.params, req, reply);
    if (p === null) return;
    const body = parseOr400(stopGymMealPlanRequestSchema, req.body, req, reply);
    if (body === null) return;
    const given = await giving.stopGiving(deps, requireUserId(req), p.gymId, p.planId, body.audienceIds, gate(writeLimit)(req, reply));
    if (given === null) return;
    return reply.status(200).send({ given });
  });

  app.get("/v1/orgs/:gymId/member-list/entries/:entryId/meal-plan", { preHandler: app.authenticate }, async (req, reply) => {
    const p = parseOr400(gymMealPlanEntryParamsSchema, req.params, req, reply);
    if (p === null) return;
    const answer = await giving.planForRecord(deps, requireUserId(req), p.gymId, p.entryId, gate(readLimit)(req, reply));
    if (answer === null) return;
    return reply.status(200).send(answer);
  });
}
