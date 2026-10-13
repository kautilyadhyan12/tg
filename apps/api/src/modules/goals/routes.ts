// A person's goals (ROADMAP Stage 5 item 30a). Order: authenticate → parse → handler.
// Every route is keyed on the signed-in person; a goal id that is somebody else's is 404.
//
// No limit of its own: a person keeps at most MAX_GOALS rows and nothing here grows
// beyond that, so the app-wide limit is the bound, as for the health screening.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import { goalIdParamsSchema, putGoalRequestSchema } from "@app/shared";
import * as service from "./service.js";

const authedUserId = (req: FastifyRequest): string => {
  const id = req.authUser?.id;
  if (id === undefined) throw new Error("authenticate preHandler did not run");
  return id;
};

/** 400 with the paths and codes only, never the values sent. */
function parse<T>(schema: z.ZodType<T>, value: unknown, req: FastifyRequest, reply: FastifyReply): T | null {
  const parsed = schema.safeParse(value);
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

export function registerGoalRoutes(app: FastifyInstance, deps: { sql: Sql; now?: () => Date }): void {
  const goalsDeps: service.GoalsDeps = { sql: deps.sql, ...(deps.now === undefined ? {} : { now: deps.now }) };

  app.get("/v1/goals", { preHandler: [app.authenticate] }, async (req, reply) => {
    return reply.status(200).send(await service.listGoals(goalsDeps, authedUserId(req)));
  });

  // Add or change. The id is the phone's own, so a request sent twice is one goal.
  app.put("/v1/goals/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parse(goalIdParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parse(putGoalRequestSchema, req.body, req, reply);
    if (body === null) return;
    const { created, goal } = await service.putGoal(goalsDeps, authedUserId(req), params.id, body);
    return reply.status(created ? 201 : 200).send({ goal });
  });

  app.delete("/v1/goals/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parse(goalIdParamsSchema, req.params, req, reply);
    if (params === null) return;
    if (!(await service.deleteGoal(goalsDeps, authedUserId(req), params.id))) {
      return reply.status(404).send({ error: "not_found", message: "Goal not found.", requestId: req.id });
    }
    return reply.status(204).send();
  });
}
