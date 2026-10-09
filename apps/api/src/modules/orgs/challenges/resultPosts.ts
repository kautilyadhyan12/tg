// A CHALLENGE'S RESULT IS POSTED TO UPDATES WHEN IT ENDS (spec Part 3 §15.6; ROADMAP 19d-ii-b).
//
// The post says only that the challenge has ended. Who won is read with the post each time
// (`resultsForPosts`), so nothing about a person is written here. `worker.ts` runs this on
// a schedule and `tools/challenge-results.ts` by hand; a second run writes nothing.
import { GYM_CHALLENGE_ENDED_DAYS, GYM_CHALLENGE_RESULT_POST_ENDING } from "@app/shared";
import type { Sql } from "postgres";
import { insertAudit } from "../repo.js";
import { insertChallengeResultPosts } from "../posts/repo.js";

export interface ResultPostsDeps {
  sql: Sql;
  log: { info: (obj: object, msg: string) => void };
}

/** Posts the result of every challenge that ended in the last fortnight and has no post,
 *  each with its line in `audit_log`, in one step. `gymIds` is for tests on a shared database. */
export async function postChallengeResults(deps: ResultPostsDeps, opts: { now?: Date; gymIds?: readonly string[] } = {}): Promise<{ posted: number }> {
  const now = opts.now ?? new Date();
  const posted = await deps.sql.begin(async (tx) => {
    const made = await insertChallengeResultPosts(tx, now, GYM_CHALLENGE_ENDED_DAYS, GYM_CHALLENGE_RESULT_POST_ENDING, opts.gymIds ?? null);
    for (const post of made) {
      await insertAudit(tx, { actorUserId: null, gymId: post.gymId, action: "org.challenge_result_posted", targetType: "post", targetId: post.id, meta: { challenge: post.challengeId } });
    }
    return made.length;
  });
  if (posted > 0) deps.log.info({ event: "challenge_results.posted", posted }, "challenge results posted");
  return { posted };
}
