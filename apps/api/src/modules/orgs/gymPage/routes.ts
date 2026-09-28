// A gym's own page (ROADMAP 20c-iv-a): the console's two routes behind sign-in, and the
// two public ones anybody with the link uses — no cookie, no sign-in.
//
// The public form is limited per internet address and per page, separately: people
// behind one phone carrier's address, or at one gym's wi-fi, share an address, and the
// robot check, not the address limit, is what stops robots. The page's allowance is
// spent only by sends that passed the robot check (`service.sendEnquiry`), so robots
// cannot use it up for the people after them.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import { ENQUIRY_WORDS, gymEnquiryRequestSchema, setGymPageRequestSchema } from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
import type { RobotCheck } from "./robotCheck.js";
import * as service from "./service.js";

/** The slug in a page's address: what `slugifyName` makes, and nothing else. */
const slugParamsSchema = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,100}$/) }).strict();

function parseOr400<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    // Issue paths and codes only, never the value: it is somebody's name or number.
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
      requestId: req.id,
    });
    return null;
  }
  return parsed.data;
}

function requireUserId(req: FastifyRequest): string {
  const userId = req.authUser?.id;
  if (userId === undefined) throw new Error("authenticate preHandler did not run");
  return userId;
}

/** A slug the schema refuses is the same 404 as a page that is off. */
const slugOf = (req: FastifyRequest): string | null => {
  const parsed = slugParamsSchema.safeParse(req.params);
  return parsed.success ? parsed.data.slug : null;
};

const ENQUIRY_PAGE_MAX = 120;
const ENQUIRY_PAGE_WINDOW_S = 60 * 60;

const notFound = (req: FastifyRequest, reply: FastifyReply): FastifyReply =>
  reply.status(404).send({ error: "page_not_found", message: ENQUIRY_WORDS.not_found, requestId: req.id });

export interface GymPageRouteDeps {
  sql: Sql;
  redis: RedisLike;
  robotCheck: RobotCheck;
}

export function registerGymPageRoutes(app: FastifyInstance, deps: GymPageRouteDeps): void {
  const pageDeps: service.GymPageDeps = { sql: deps.sql, now: () => new Date(), robotCheck: deps.robotCheck };

  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };

  /** The console: a page opened, a page saved. */
  const readLimit = createDualRateLimit({
    name: "gym_page_read",
    max: 600,
    ipMax: 2000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const writeLimit = createDualRateLimit({
    name: "gym_page_write",
    max: 60,
    ipMax: 200,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  /** Anybody opening a page: by address alone. */
  const publicReadLimit = createDualRateLimit({
    name: "gym_page_public_read",
    max: 600,
    ipMax: 600,
    windowMs: 60 * 60 * 1000,
    identifier: () => null,
    redis: deps.redis,
  });
  /** The form: 60 sends an hour from one address, whatever they carry. */
  const enquiryAddressLimit = createDualRateLimit({
    name: "gym_enquiry",
    max: 60,
    ipMax: 60,
    windowMs: 60 * 60 * 1000,
    identifier: () => null,
    redis: deps.redis,
  });
  /** …and 120 messages an hour to one page, counted only once the robot check passed.
   *  Redis down: let it through with a log, as the address limit does. */
  const pageRoom = (req: FastifyRequest, slug: string) => async (): Promise<boolean> => {
    const count = await deps.redis.incrWithTtl(`rl:gym_enquiry_page:${slug}`, ENQUIRY_PAGE_WINDOW_S);
    if (count === null) {
      req.log.warn({ event: "ratelimit.open_redis_down", limiter: "gym_enquiry_page" }, "rate limiter failing open (Redis unavailable)");
      return true;
    }
    return count <= ENQUIRY_PAGE_MAX;
  };
  const signedIn = { preHandler: [app.authenticate] };

  app.get("/v1/orgs/:gymId/page", signedIn, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const page = await service.getGymPage(pageDeps, requireUserId(req), params.gymId, gate(readLimit)(req, reply));
    if (page === null) return;
    return reply.status(200).send({ page });
  });

  app.put("/v1/orgs/:gymId/page", signedIn, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(setGymPageRequestSchema, req.body, req, reply);
    if (body === null) return;
    const page = await service.setGymPage(pageDeps, requireUserId(req), params.gymId, body, gate(writeLimit)(req, reply));
    if (page === null) return;
    return reply.status(200).send({ page });
  });

  app.get("/v1/public/gyms/:slug", async (req, reply) => {
    await publicReadLimit(req, reply);
    if (reply.sent) return;
    const slug = slugOf(req);
    if (slug === null) return notFound(req, reply);
    const page = await service.publicPage(pageDeps, slug);
    return reply.status(200).header("cache-control", "no-store").send({ page });
  });

  app.post("/v1/public/gyms/:slug/enquiries", async (req, reply) => {
    const slug = slugOf(req);
    if (slug === null) return notFound(req, reply);
    const body = parseOr400(gymEnquiryRequestSchema, req.body, req, reply);
    if (body === null) return;
    const done = await service.sendEnquiry(pageDeps, slug, body, {
      address: gate(enquiryAddressLimit)(req, reply),
      page: pageRoom(req, slug),
    });
    if (done === null) return;
    return reply.status(202).send({ received: true });
  });
}
