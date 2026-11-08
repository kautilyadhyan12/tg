// THE WALLS AROUND A PUBLIC DOOR THAT EMAILS A CODE TO A TYPED ADDRESS: the sign-in page, and the
// website's Delete your account page (21b-ii). One set, shared: the buckets are Redis keys by name, so
// a robot that moves from one door to the other meets the same counts.
//
// The per-PERSON limits are in the database (three unused codes a day, then one more past the robot
// check; five guesses a code), so nothing here counts by the email typed: a stranger who typed
// somebody's address could otherwise use up that person's allowance and lock them out (the security
// pass on item 12, H2). These buckets are the wall against a client that VARIES the address: every send
// is an email Kd pays for. A gym's wi-fi puts a whole gym on one internet address (ROADMAP Stage 4 item
// 10: 200 people in an hour), so the address's first 20 sends an hour go straight through and every
// send after needs the robot check, not a refusal. 500 an hour is the ceiling even with the check. On
// top sits ONE ceiling on sends a day across everyone, the outage-and-bill stop.
import type { FastifyReply, FastifyRequest } from "fastify";
import { SIGN_IN_FREE_SENDS_PER_ADDRESS, SIGN_IN_ROBOT_WORDS, sendCodeRequestSchema } from "@app/shared";
import type { AppConfig } from "../../config.js";
import type { RedisLike } from "../../redis.js";
import type { RobotCheck } from "../orgs/gymPage/robotCheck.js";
import { createDualRateLimit } from "./rateLimit.js";

const HOUR_MS = 60 * 60 * 1000;
const HOUR_S = HOUR_MS / 1000;
const DAY_S = 24 * 60 * 60;
const DAY_CEILING_KEY = "rl:code_send:all:day";
/** 1,000 wrong guesses at live codes an hour from one address. Counted after the guess (a live code
 *  must exist, so each one costs a send, past 20 a robot check); read before. */
const WRONG_GUESSES_PER_ADDRESS = 1000;

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface CodeDoor {
  /** Before the send: the robot check past the address's free 20 an hour (and when asked by the
   *  handler), the hour's 500 and the day's ceiling. */
  beforeSend: PreHandler[];
  /** Whether this request passed the robot check, for the database's day rule. */
  passedRobot(req: FastifyRequest): boolean;
  askForRobot(req: FastifyRequest, reply: FastifyReply): FastifyReply;
  /** After a send resolved: only a sent email is counted against the day's ceiling. */
  countSent(): Promise<void>;
  /** Before a guess: the address's wrong guesses this hour. */
  guessRoom: PreHandler;
  countWrongGuess(req: FastifyRequest): Promise<void>;
}

export function createCodeDoor(deps: { config: AppConfig; redis: RedisLike; robotCheck: RobotCheck }): CodeDoor {
  const sendLimit = createDualRateLimit({
    name: "code_send",
    max: 500,
    ipMax: 500,
    windowMs: HOUR_MS,
    identifier: () => null,
    redis: deps.redis,
  });

  // The ceiling counts EMAILS, not requests: read here, stepped only after a send has resolved, so a
  // refusal never spends one of the day's sends. Read-then-count can overshoot by the requests in
  // flight together, nothing against a stop in the thousands. A missing key and a Redis outage both
  // read as "none yet" and open; with Redis down every send has passed the robot check first.
  const dayCeiling: PreHandler = async (req, reply) => {
    const sentToday = Number((await deps.redis.get(DAY_CEILING_KEY)) ?? "0");
    if (sentToday >= deps.config.CODE_EMAILS_PER_DAY) {
      await reply.status(429).send({
        error: "code_ceiling",
        message: "Sign-in codes are paused for today. Please try again tomorrow, or sign in with Google.",
        requestId: req.id,
      });
    }
  };

  // THE ROBOT CHECK. It runs before the limits, so a request without a passed check counts against
  // nobody's allowance. A request that would send nothing (answered 400 here) spends none of the 20.
  // Every answer is put to Cloudflare, and failures are never counted against the address: one person
  // there could otherwise lock out everybody sharing it. Each answer is used once. REDIS DOWN: the 20
  // cannot be counted, nor the day's ceiling, so every send asks for the check (item 12's pass, H3).
  const passed = new WeakSet<FastifyRequest>();
  const askForRobot = (req: FastifyRequest, reply: FastifyReply) =>
    reply.status(403).send({ error: "robot_check", message: SIGN_IN_ROBOT_WORDS.robot_check, robotCheckKey: deps.robotCheck.siteKey, requestId: req.id });
  const robotGate: PreHandler = async (req, reply) => {
    const parsed = sendCodeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      await reply.status(400).send({
        error: "validation_error",
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
        requestId: req.id,
      });
      return;
    }
    const token = parsed.data.robotToken;
    if (token !== undefined) {
      const answer = await deps.robotCheck.verify(token, "sign_in");
      if (answer === "unavailable") {
        await reply.status(503).send({ error: "robot_unavailable", message: SIGN_IN_ROBOT_WORDS.robot_unavailable, requestId: req.id });
        return;
      }
      if (answer !== "passed") {
        await reply.status(403).send({ error: "robot_failed", message: SIGN_IN_ROBOT_WORDS.robot_failed, robotCheckKey: deps.robotCheck.siteKey, requestId: req.id });
        return;
      }
      passed.add(req);
    }
    const sends = await deps.redis.incrWithTtl(`rl:code_send_free:ip:${req.ip}`, HOUR_S);
    if (sends === null) req.log.warn({ event: "ratelimit.robot_check_redis_down", limiter: "code_send_free" }, "every code send asks for the robot check (Redis unavailable)");
    const free = sends !== null && sends <= SIGN_IN_FREE_SENDS_PER_ADDRESS;
    if (!free && !passed.has(req)) await askForRobot(req, reply);
  };

  const wrongGuessKey = (req: FastifyRequest) => `rl:code_verify_wrong:ip:${req.ip}`;
  const guessRoom: PreHandler = async (req, reply) => {
    if (Number((await deps.redis.get(wrongGuessKey(req))) ?? "0") >= WRONG_GUESSES_PER_ADDRESS) {
      await reply.status(429).send({ error: "rate_limited", message: "Too many attempts. Please try again later.", requestId: req.id });
    }
  };

  return {
    beforeSend: [robotGate, sendLimit, dayCeiling],
    passedRobot: (req) => passed.has(req),
    askForRobot,
    countSent: async () => {
      await deps.redis.incrWithTtl(DAY_CEILING_KEY, DAY_S);
    },
    guessRoom,
    countWrongGuess: async (req) => {
      await deps.redis.incrWithTtl(wrongGuessKey(req), HOUR_S);
    },
  };
}
