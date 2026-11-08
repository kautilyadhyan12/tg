// The admin door (Kd, 2026-11-08): the admin account's sign-in must be fresh (a code typed in the
// last few minutes), then his own password opens the page for at most 12 hours, in this browser's
// sign-in session only. The door's key is a random token in an httpOnly cookie; Redis keeps only
// its hash, with whose session it is, and forgets it after 12 hours.
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import { ADMIN_DOOR_HOURS, ADMIN_FRESH_MINUTES, type AdminDoorState } from "@app/shared";
import type { AppConfig } from "../../config.js";
import type { RedisLike } from "../../redis.js";
import type { PasswordHasher } from "../auth/service.js";
import { cookieOptions, mintOpaqueToken, sha256Hex } from "../auth/tokens.js";
import * as repo from "./repo.js";

export const DOOR_COOKIE = "adminDoor";
export const DOOR_PATH = "/v1/admin";
const DOOR_SECONDS = ADMIN_DOOR_HOURS * 60 * 60;
const doorKey = (token: string): string => `admin-door:${sha256Hex(token)}`;
const heldSchema = z.object({ userId: z.string(), familyId: z.string(), until: z.string() }).strict();

export interface DoorDeps {
  sql: Sql;
  redis: RedisLike;
  config: AppConfig;
  hasher: PasswordHasher;
  now: () => Date;
}

export class DoorError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Who = { userId: string; familyId: string };

/** The open door this request carries for this account and session, or null. */
async function openUntil(deps: DoorDeps, req: FastifyRequest, who: Who): Promise<Date | null> {
  const token = req.cookies[DOOR_COOKIE];
  if (token === undefined || token === "") return null;
  const raw = await deps.redis.get(doorKey(token));
  if (raw === null) return null;
  let held: unknown = null;
  try {
    held = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = heldSchema.safeParse(held);
  if (!parsed.success || parsed.data.userId !== who.userId || parsed.data.familyId !== who.familyId) return null;
  const until = new Date(parsed.data.until);
  return until > deps.now() ? until : null;
}

/** A sign-in made with an emailed code in the last few minutes (Kd: "the fresh code"). */
async function fresh(deps: DoorDeps, who: Who): Promise<boolean> {
  const session = await repo.sessionBegan(deps.sql, who.userId, who.familyId);
  return session !== null && session.byCode && deps.now().getTime() - session.began.getTime() <= ADMIN_FRESH_MINUTES * 60 * 1000;
}

export async function doorState(deps: DoorDeps, req: FastifyRequest, who: Who): Promise<AdminDoorState> {
  const [password, until, isFresh] = await Promise.all([repo.getDoorPassword(deps.sql, who.userId), openUntil(deps, req, who), fresh(deps, who)]);
  return { passwordSet: password !== null, open: until !== null, openUntil: until === null ? null : until.toISOString(), fresh: isFresh };
}

async function open(deps: DoorDeps, reply: FastifyReply, who: Who): Promise<AdminDoorState> {
  const token = mintOpaqueToken();
  const until = new Date(deps.now().getTime() + DOOR_SECONDS * 1000);
  const kept = await deps.redis.setex(doorKey(token), DOOR_SECONDS, JSON.stringify({ userId: who.userId, familyId: who.familyId, until: until.toISOString() }));
  if (!kept) throw new DoorError(503, "admin_unavailable", "The admin page cannot open right now. Please try again in a few minutes.");
  reply.setCookie(DOOR_COOKIE, token, cookieOptions(deps.config, DOOR_SECONDS, DOOR_PATH));
  await repo.auditDoor(deps.sql, who.userId, "admin.door_opened");
  return { passwordSet: true, open: true, openUntil: until.toISOString(), fresh: true };
}

const NOT_FRESH = "Sign in with a new code first, then type your admin password.";

/** The first password, made once, from a fresh sign-in; it opens the door. */
export async function makePassword(deps: DoorDeps, reply: FastifyReply, who: Who, password: string): Promise<AdminDoorState> {
  if (!(await fresh(deps, who))) throw new DoorError(403, "fresh_code_needed", NOT_FRESH);
  const hash = await deps.hasher.hash(password);
  if (!(await repo.createDoorPassword(deps.sql, who.userId, hash, deps.hasher.algo))) {
    throw new DoorError(409, "password_already_made", "Your admin password is made already. Type it to open the page.");
  }
  return await open(deps, reply, who);
}

/** A fresh sign-in and the right password open the door for 12 hours. */
export async function unlock(deps: DoorDeps, reply: FastifyReply, who: Who, password: string): Promise<AdminDoorState> {
  if (!(await fresh(deps, who))) throw new DoorError(403, "fresh_code_needed", NOT_FRESH);
  const stored = await repo.getDoorPassword(deps.sql, who.userId);
  if (stored === null) throw new DoorError(409, "password_not_made", "Make your admin password first.");
  if (!(await deps.hasher.verify(password, stored.hash, stored.algo))) {
    await repo.auditDoor(deps.sql, who.userId, "admin.door_wrong_password");
    throw new DoorError(403, "wrong_password", "That password is not right.");
  }
  return await open(deps, reply, who);
}

/** Lock: the door's key is forgotten and its cookie cleared. */
export async function lock(deps: DoorDeps, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[DOOR_COOKIE];
  if (token !== undefined && token !== "") await deps.redis.del(doorKey(token));
  reply.setCookie(DOOR_COOKIE, "", cookieOptions(deps.config, 0, DOOR_PATH));
}

/** preHandler after `adminOnly`: the page's own reads and writes need the door open. */
export function requireOpenDoor(deps: DoorDeps) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> => {
    const userId = req.authUser?.id;
    const familyId = req.authUser?.familyId ?? null;
    if (userId === undefined || familyId === null || (await openUntil(deps, req, { userId, familyId })) === null) {
      await reply.status(403).send({ error: "admin_locked", message: "Open the admin page with your password first.", requestId: req.id });
      return reply;
    }
    return undefined;
  };
}
