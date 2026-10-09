// A challenge's result on its post (spec Part 3 §15.6; ROADMAP 19d-ii-b): the post's shape,
// and that `posts.ts` reading a challenge's shape leaves what events and challenges take
// from posts whole. `posts.js` is read first on purpose: that order is the one a loop
// between the files would break.
import { describe, expect, it } from "vitest";
import { GYM_POST_PHOTO_MAX_BYTES, gymPostSchema, postLength, staffGymPostSchema } from "../src/posts.js";
import { GYM_EVENT_POSTER_MAX_BYTES } from "../src/gymEvents.js";
import { memberGymChallengeSchema, staffGymChallengeSchema } from "../src/gymChallenges.js";
import * as all from "../src/index.js";

const ID = "11111111-1111-4111-8111-111111111111";
const without = (from: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> => Object.fromEntries(Object.entries(from).filter(([key]) => !keys.includes(key)));
const challenge = {
  id: ID,
  name: "October Six",
  details: "",
  prize: "A month free",
  counts: "gym_days",
  startsOn: "2026-10-01",
  endsOn: "2026-10-06",
  target: null,
  who: "everyone",
  unit: "",
  lowestWins: false,
  teams: "none",
  cancelled: false,
  state: "ended",
  joined: false,
  can: { join: false, leave: false, pick: false },
  teamBoard: null,
  joinedCount: null,
  board: { status: "shown", ranked: 3, top: [{ userId: ID, name: "Asha R.", initials: "AR", place: 1, value: 5, reached: false, isMe: false }], leaders: 1, reached: null },
  me: null,
};
const post = {
  id: ID,
  author: { name: null, initials: "" },
  body: "October Six has ended.",
  photos: [],
  pinned: false,
  createdAt: "2026-10-07T06:30:00.000Z",
  reactions: { like: 0, strong: 0, fire: 0, love: 0 },
  mine: null,
  fromMember: false,
  authorId: null,
  own: false,
  wrote: false,
  reported: false,
  hidden: false,
  challengeResult: { today: "2026-10-08", canOpen: true, challenge },
};

describe("a challenge's result on its post", () => {
  it("the challenge in it is a challenge as a member is sent one", () => {
    expect(memberGymChallengeSchema.safeParse(challenge).success).toBe(true);
    expect(gymPostSchema.safeParse(post).success).toBe(true);
    expect(staffGymPostSchema.safeParse({ ...post, authorStopped: false }).success).toBe(true);
    expect(gymPostSchema.safeParse({ ...post, challengeResult: null }).success).toBe(true);
  });

  it.each([
    ["no field at all", without(post, ["challengeResult"])],
    ["a result with no challenge", { ...post, challengeResult: { today: "2026-10-08", canOpen: true } }],
    ["a challenge with a field of its own missing", { ...post, challengeResult: { ...post.challengeResult, challenge: { ...challenge, board: undefined } } }],
    ["a day that is not a day", { ...post, challengeResult: { ...post.challengeResult, today: "8 October" } }],
    ["something more than the three fields", { ...post, challengeResult: { ...post.challengeResult, winner: "Asha Rao" } }],
  ])("is refused: %s", (_what, given) => {
    expect(gymPostSchema.safeParse(given).success).toBe(false);
  });

  it("staff are sent whether a challenge's result has been posted, and whether that post was removed", () => {
    const sent = { ...without(challenge, ["joined", "can", "teamBoard", "board", "me"]), top: [], withNumber: null, teamList: [] };
    expect(staffGymChallengeSchema.safeParse({ ...sent, resultPost: null }).success).toBe(true);
    expect(staffGymChallengeSchema.safeParse({ ...sent, resultPost: { postedAt: "2026-10-07T18:38:00.000Z", removed: true, hidden: false } }).success).toBe(true);
    // Without whether it is hidden from members, it is not a reply staff are sent.
    expect(staffGymChallengeSchema.safeParse({ ...sent, resultPost: { postedAt: "2026-10-07T18:38:00.000Z", removed: false } }).success).toBe(false);
    expect(staffGymChallengeSchema.safeParse(sent).success).toBe(false);
    expect(staffGymChallengeSchema.safeParse({ ...sent, resultPost: { postedAt: "yesterday", removed: false, hidden: false } }).success).toBe(false);
  });
});

describe("what events and challenges take from posts", () => {
  it("is whole, whichever file is read first", () => {
    expect(GYM_POST_PHOTO_MAX_BYTES).toBe(1024 * 1024);
    expect(Number.isInteger(GYM_EVENT_POSTER_MAX_BYTES) && GYM_EVENT_POSTER_MAX_BYTES > 0).toBe(true);
    expect(postLength("a🏋️")).toBe(3);
    // Still named by the package under the names every reader uses.
    expect(all.GYM_POST_PHOTO_MAX_BYTES).toBe(GYM_POST_PHOTO_MAX_BYTES);
    expect(all.postLength).toBe(postLength);
  });
});
