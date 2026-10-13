// The register's routes (spec Part 3 §14.3; ROADMAP 18b-i): authenticate, the asker's own
// ceiling, Zod-parse, who may, the limit, then the work. The service owns the
// authorisation, and every limit that counts an address is asked AFTER it and a gym at a
// time: a refused ask leaves the gym's address alone, and one gym's desk never uses up
// another's at a shared address.
//
//   GET    /v1/orgs/:gymId/register                         the Sell page (`billing.members` or `memberships.manage`)
//   GET    /v1/orgs/:gymId/register/people?query=           who a sale can be for (`billing.members`)
//   POST   /v1/orgs/:gymId/register/sales                   one sale (`billing.members`)
//   POST   /v1/orgs/:gymId/register/sales/:saleId/undo      take it back, the same day
//   PUT    /v1/orgs/:gymId/register/tax                     the gym's tax (`memberships.manage`)
//   POST   /v1/orgs/:gymId/register/products                add a product
//   PUT    /v1/orgs/:gymId/register/products/:productId     change one, every field
//   DELETE /v1/orgs/:gymId/register/products/:productId     archive it
//   POST   /v1/orgs/:gymId/register/products/:productId/restore
//   POST   /v1/orgs/:gymId/register/discounts               add a discount (`memberships.manage`)
//   PUT    /v1/orgs/:gymId/register/discounts/:discountId   change one, every field
//   DELETE /v1/orgs/:gymId/register/discounts/:discountId   archive it
//   POST   /v1/orgs/:gymId/register/discounts/:discountId/restore
//   GET    /v1/orgs/:gymId/member-list/entries/:entryId/purchases   what one person bought (`billing.members`)
//
// A sale carries the form's own key: the same key twice is one sale.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import {
  salePeopleQuerySchema,
  salesTaxSchema,
  saveGymDiscountRequestSchema,
  saveGymProductRequestSchema,
  sellProductRequestSchema,
  updateGymDiscountRequestSchema,
  updateGymProductRequestSchema,
} from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { memberListEntryParamsSchema, orgParamsSchema } from "../schemas.js";
import * as service from "./service.js";

const productParamsSchema = z.object({ gymId: z.string().uuid(), productId: z.string().uuid() }).strict();
const discountParamsSchema = z.object({ gymId: z.string().uuid(), discountId: z.string().uuid() }).strict();
const saleParamsSchema = z.object({ gymId: z.string().uuid(), saleId: z.string().uuid() }).strict();

export function registerRegisterRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike; now: () => Date }): void {
  const registerDeps: service.RegisterDeps = { sql: deps.sql, now: deps.now };
  const gymOf = (params: unknown): string | null => z.object({ gymId: z.string().uuid() }).safeParse(params).data?.gymId ?? null;
  const hour = 60 * 60 * 1000;
  const limitOf = (name: string, max: number, ipMax: number | null) =>
    createDualRateLimit({
      name,
      max,
      ipMax,
      windowMs: hour,
      identifier: (req) => req.authUser?.id ?? null,
      ...(ipMax === null ? {} : { ipScope: (req: FastifyRequest) => gymOf(req.params) }),
      redis: deps.redis,
    });

  /** Every ask, refused ones too, against the asker alone and never the address. */
  const askerLimit = limitOf("orgs_register_asks", 3000, null);
  /** The page is read after every sale, and the search as staff type. A gym's staff share
   *  one address, so the address ceiling is several people's. */
  const readLimit = limitOf("orgs_register_read", 1200, 6000);
  const searchLimit = limitOf("orgs_register_people", 1200, 6000);
  /** A busy desk sells a few hundred things a day; one person, one an every few seconds. */
  const sellLimit = limitOf("orgs_register_sell", 600, 3000);
  const manageLimit = limitOf("orgs_register_manage", 300, 900);

  const refused = (issues: readonly { path: PropertyKey[]; code: string }[], requestId: string) => ({
    error: "validation_error",
    // Issue paths and codes only, never the offending value.
    message: issues
      .slice(0, 10)
      .map((i) => `${i.path.map(String).join(".")}: ${i.code}`)
      .join("; "),
    requestId,
  });
  const userOf = (req: FastifyRequest): string => {
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    return userId;
  };
  const pre = { preHandler: [app.authenticate, askerLimit] };
  /** True where the limit let the request through. */
  const within = async (limit: ReturnType<typeof limitOf>, req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    await limit(req, reply);
    return !reply.sent;
  };

  app.get("/v1/orgs/:gymId/register", pre, async (req, reply) => {
    const params = orgParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const viewer = await service.requireReader(registerDeps, userOf(req), params.data.gymId);
    if (!(await within(readLimit, req, reply))) return reply;
    return reply.status(200).header("cache-control", "no-store").send(await service.getRegister(registerDeps, params.data.gymId, viewer));
  });

  app.get("/v1/orgs/:gymId/register/people", pre, async (req, reply) => {
    const params = orgParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const query = salePeopleQuerySchema.safeParse(req.query);
    if (!query.success) return reply.status(400).send(refused(query.error.issues, req.id));
    const viewer = await service.requireReader(registerDeps, userOf(req), params.data.gymId);
    if (!viewer.canSell) return reply.status(403).send({ error: "forbidden", message: "Your role doesn't allow that.", requestId: req.id });
    if (!(await within(searchLimit, req, reply))) return reply;
    return reply.status(200).header("cache-control", "no-store").send(await service.findPeople(registerDeps, params.data.gymId, viewer, query.data.query));
  });

  app.post("/v1/orgs/:gymId/register/sales", pre, async (req, reply) => {
    const params = orgParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const body = sellProductRequestSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send(refused(body.error.issues, req.id));
    const userId = userOf(req);
    const viewer = await service.requireSeller(registerDeps, userId, params.data.gymId);
    if (!(await within(sellLimit, req, reply))) return reply;
    return reply.status(201).send(await service.sellProduct(registerDeps, userId, params.data.gymId, viewer, body.data));
  });

  app.post("/v1/orgs/:gymId/register/sales/:saleId/undo", pre, async (req, reply) => {
    const params = saleParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const userId = userOf(req);
    const viewer = await service.requireSeller(registerDeps, userId, params.data.gymId);
    if (!(await within(sellLimit, req, reply))) return reply;
    return reply.status(200).send(await service.undoSale(registerDeps, userId, params.data.gymId, viewer, params.data.saleId));
  });

  app.put("/v1/orgs/:gymId/register/tax", pre, async (req, reply) => {
    const params = orgParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const body = salesTaxSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send(refused(body.error.issues, req.id));
    const userId = userOf(req);
    const viewer = await service.requireManager(registerDeps, userId, params.data.gymId);
    if (!(await within(manageLimit, req, reply))) return reply;
    return reply.status(200).send(await service.saveTax(registerDeps, userId, params.data.gymId, viewer, body.data));
  });

  app.post("/v1/orgs/:gymId/register/products", pre, async (req, reply) => {
    const params = orgParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const body = saveGymProductRequestSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send(refused(body.error.issues, req.id));
    const userId = userOf(req);
    const viewer = await service.requireManager(registerDeps, userId, params.data.gymId);
    if (!(await within(manageLimit, req, reply))) return reply;
    return reply.status(201).send(await service.createProduct(registerDeps, userId, params.data.gymId, viewer, body.data));
  });

  app.put("/v1/orgs/:gymId/register/products/:productId", pre, async (req, reply) => {
    const params = productParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const body = updateGymProductRequestSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send(refused(body.error.issues, req.id));
    const userId = userOf(req);
    const viewer = await service.requireManager(registerDeps, userId, params.data.gymId);
    if (!(await within(manageLimit, req, reply))) return reply;
    return reply.status(200).send(await service.updateProduct(registerDeps, userId, params.data.gymId, viewer, params.data.productId, body.data));
  });

  app.delete("/v1/orgs/:gymId/register/products/:productId", pre, async (req, reply) => {
    const params = productParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const userId = userOf(req);
    const viewer = await service.requireManager(registerDeps, userId, params.data.gymId);
    if (!(await within(manageLimit, req, reply))) return reply;
    return reply.status(200).send(await service.archiveProduct(registerDeps, userId, params.data.gymId, viewer, params.data.productId));
  });

  app.post("/v1/orgs/:gymId/register/products/:productId/restore", pre, async (req, reply) => {
    const params = productParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const userId = userOf(req);
    const viewer = await service.requireManager(registerDeps, userId, params.data.gymId);
    if (!(await within(manageLimit, req, reply))) return reply;
    return reply.status(200).send(await service.restoreProduct(registerDeps, userId, params.data.gymId, viewer, params.data.productId));
  });

  app.post("/v1/orgs/:gymId/register/discounts", pre, async (req, reply) => {
    const params = orgParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const body = saveGymDiscountRequestSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send(refused(body.error.issues, req.id));
    const userId = userOf(req);
    const viewer = await service.requireManager(registerDeps, userId, params.data.gymId);
    if (!(await within(manageLimit, req, reply))) return reply;
    return reply.status(201).send(await service.createDiscount(registerDeps, userId, params.data.gymId, viewer, body.data));
  });

  app.put("/v1/orgs/:gymId/register/discounts/:discountId", pre, async (req, reply) => {
    const params = discountParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const body = updateGymDiscountRequestSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send(refused(body.error.issues, req.id));
    const userId = userOf(req);
    const viewer = await service.requireManager(registerDeps, userId, params.data.gymId);
    if (!(await within(manageLimit, req, reply))) return reply;
    return reply.status(200).send(await service.updateDiscount(registerDeps, userId, params.data.gymId, viewer, params.data.discountId, body.data));
  });

  app.delete("/v1/orgs/:gymId/register/discounts/:discountId", pre, async (req, reply) => {
    const params = discountParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const userId = userOf(req);
    const viewer = await service.requireManager(registerDeps, userId, params.data.gymId);
    if (!(await within(manageLimit, req, reply))) return reply;
    return reply.status(200).send(await service.archiveDiscount(registerDeps, userId, params.data.gymId, viewer, params.data.discountId));
  });

  app.post("/v1/orgs/:gymId/register/discounts/:discountId/restore", pre, async (req, reply) => {
    const params = discountParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const userId = userOf(req);
    const viewer = await service.requireManager(registerDeps, userId, params.data.gymId);
    if (!(await within(manageLimit, req, reply))) return reply;
    return reply.status(200).send(await service.restoreDiscount(registerDeps, userId, params.data.gymId, viewer, params.data.discountId));
  });

  app.get("/v1/orgs/:gymId/member-list/entries/:entryId/purchases", pre, async (req, reply) => {
    const params = memberListEntryParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const viewer = await service.requireReader(registerDeps, userOf(req), params.data.gymId);
    if (!viewer.canSell) return reply.status(403).send({ error: "forbidden", message: "Your role doesn't allow that.", requestId: req.id });
    if (!(await within(readLimit, req, reply))) return reply;
    return reply.status(200).header("cache-control", "no-store").send(await service.getPurchases(registerDeps, params.data.gymId, viewer, params.data.entryId));
  });
}
