import type { FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import * as repo from "./repo.js";

/** The gym in the address; a route's other ids are its own to parse. */
const gymInAddress = z.object({ gymId: z.string().uuid() });

type Limit = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

/** A staff route's limit, asked only of the gym's own staff. Anybody else is on the way
 *  to the service's 404, and that answer must not count against the address the gym's
 *  staff share: three accounts at the front desk's wi-fi could otherwise lock them out. */
export function staffOnly(sql: Sql, limit: Limit): Limit {
  return async (req, reply) => {
    const userId = req.authUser?.id;
    const params = gymInAddress.safeParse(req.params);
    if (userId === undefined || !params.success) return;
    if ((await repo.getStaffAuthority(sql, params.data.gymId, userId)) === null) return;
    await limit(req, reply);
  };
}
