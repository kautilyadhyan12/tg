// The signed-in person's own invitations (Part 3 §10.2; ROADMAP 3b-ii-a):
//   GET  /v1/orgs/invitations                     what is waiting for my address
//   POST /v1/orgs/invitations/:invitationId/accept   Join
//   POST /v1/orgs/invitations/:invitationId/decline  No thanks
// Authenticate, then the rate limit, then the handler; there is no privilege to hold,
// since the caller's own proved address is the whole credential.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { invitationParamsSchema } from "@app/shared";
import type { Sql } from "postgres";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { acceptInvitation, declineInvitation, myInvitations, type Caller, type JoinDeps } from "./join.js";
import type { InviteSettings } from "./settings.js";

const HOUR_MS = 60 * 60 * 1000;

function callerOf(req: FastifyRequest): Caller {
  const user = req.authUser;
  if (user === undefined) throw new Error("authenticate preHandler did not run");
  return user;
}

function invitationIdOf(req: FastifyRequest, reply: FastifyReply): string | null {
  const parsed = invitationParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.code}`).join("; "),
      requestId: req.id,
    });
    return null;
  }
  return parsed.data.invitationId;
}

export function registerInvitationRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; redis: RedisLike; invites: InviteSettings | null; now?: () => Date },
): void {
  const joinDeps: JoinDeps = {
    sql: deps.sql,
    redis: deps.redis,
    invites: deps.invites,
    now: deps.now ?? (() => new Date()),
  };
  const byPerson = (req: FastifyRequest): string | null => req.authUser?.id ?? null;
  // A gym's whole induction can sign up on its one wi-fi address: 200 people, each
  // tapping Join and perhaps No thanks and Join again, is 600 an hour from one address.
  const answerLimit = createDualRateLimit({
    name: "invitation_answer",
    max: 10,
    ipMax: 600,
    windowMs: HOUR_MS,
    identifier: byPerson,
    redis: deps.redis,
  });
  // The web asks once after sign-in and again on Settings → Gym.
  const readLimit = createDualRateLimit({
    name: "invitation_read",
    max: 60,
    ipMax: 3000,
    windowMs: HOUR_MS,
    identifier: byPerson,
    redis: deps.redis,
  });

  app.get("/v1/orgs/invitations", { preHandler: [app.authenticate, readLimit] }, async (req, reply) => {
    return reply.status(200).send(await myInvitations(joinDeps, callerOf(req)));
  });

  app.post("/v1/orgs/invitations/:invitationId/accept", { preHandler: [app.authenticate, answerLimit] }, async (req, reply) => {
    const invitationId = invitationIdOf(req, reply);
    if (invitationId === null) return;
    return reply.status(200).send(await acceptInvitation(joinDeps, callerOf(req), invitationId));
  });

  app.post("/v1/orgs/invitations/:invitationId/decline", { preHandler: [app.authenticate, answerLimit] }, async (req, reply) => {
    const invitationId = invitationIdOf(req, reply);
    if (invitationId === null) return;
    return reply.status(200).send(await declineInvitation(joinDeps, callerOf(req), invitationId));
  });
}
