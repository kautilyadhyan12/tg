// P2.5b — coach routes (thin, R7.1). THE first metered endpoint: R3.3 order
// on /chat is authn → entitlement+quota (requireQuota reads the resolver) →
// parse → handler. Thread reads are self-keyed (R3.2); foreign ids → 404.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import type { AppConfig } from "../../config.js";
import type { RedisLike } from "../../redis.js";
import { requireQuota } from "../quotas/service.js";
import type { Embedder } from "./embedder.js";
import type { ChatProvider } from "./llm.adapter.js";
import { createGroqProvider, createOpenRouterProvider } from "./llm.adapter.js";
import { createMiniLmEmbedder } from "./embedder.adapter.js";
import { coachChatRequestSchema, coachThreadListQuerySchema } from "./schemas.js";
import * as service from "./service.js";
import { buildProvider } from "./service.js";

function parse<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
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

function authedUserId(req: FastifyRequest): string {
  const userId = req.authUser?.id;
  if (userId === undefined) throw new Error("authenticate preHandler did not run");
  return userId;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CoachRouteOverrides {
  chatProvider?: ChatProvider;
  embedder?: Embedder;
}

export function registerCoachRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; redis: RedisLike; config: AppConfig },
  overrides: CoachRouteOverrides = {},
): void {
  const provider =
    overrides.chatProvider ??
    buildProvider(
      deps.config.GROQ_API_KEY === undefined
        ? null
        : createGroqProvider(deps.config.GROQ_API_KEY, deps.config.COACH_MODEL),
      deps.config.OPENROUTER_API_KEY === undefined
        ? null
        : createOpenRouterProvider(deps.config.OPENROUTER_API_KEY),
    );
  const coachDeps: service.CoachDeps = {
    sql: deps.sql,
    redis: deps.redis,
    provider,
    embedder: overrides.embedder ?? createMiniLmEmbedder(),
    model: deps.config.COACH_MODEL,
    log: app.log,
  };

  app.post(
    "/v1/coach/chat",
    // R3.3: authn → quota (coach = fail-open; limits from entitlements).
    { preHandler: [app.authenticate, requireQuota("coach", { sql: deps.sql, redis: deps.redis })] },
    async (req, reply) => {
      const input = parse(coachChatRequestSchema, req.body, req, reply);
      if (input === null) return;
      const result = await service.chat(coachDeps, authedUserId(req), input);
      return reply.status(200).send(result);
    },
  );

  app.get("/v1/coach/threads", { preHandler: [app.authenticate] }, async (req, reply) => {
    const query = parse(coachThreadListQuerySchema, req.query, req, reply);
    if (query === null) return;
    return reply.status(200).send(await service.listThreads(coachDeps, authedUserId(req), query));
  });

  app.get<{ Params: { id: string } }>(
    "/v1/coach/threads/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const notFound = () =>
        reply.status(404).send({ error: "not_found", message: "thread not found", requestId: req.id });
      if (!UUID_RE.test(req.params.id)) return notFound();
      const detail = await service.getThreadDetail(coachDeps, authedUserId(req), req.params.id);
      if (detail === null) return notFound();
      return reply.status(200).send(detail);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/coach/threads/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const notFound = () =>
        reply.status(404).send({ error: "not_found", message: "thread not found", requestId: req.id });
      if (!UUID_RE.test(req.params.id)) return notFound();
      const deleted = await service.deleteThread(coachDeps, authedUserId(req), req.params.id);
      if (!deleted) return notFound();
      return reply.status(200).send({ message: "Thread deleted" });
    },
  );
}
