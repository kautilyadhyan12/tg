import {
  blockedGymPosterResponseSchema,
  blockedGymPostersResponseSchema,
  gymPostReactionResponseSchema,
  gymPostReactorsResponseSchema,
  gymPostResponseSchema,
  gymPostSettingsSchema,
  gymPosterStoppedResponseSchema,
  gymPostsResponseSchema,
  keptGymPostResponseSchema,
  removedGymPostResponseSchema,
  reportedGymPostResponseSchema,
  reportedGymPostsResponseSchema,
  staffGymPostResponseSchema,
  staffGymPostsResponseSchema,
  stoppedGymPostersResponseSchema,
} from '@app/shared';
import authApi from './authApi';

// A GYM'S UPDATES (spec Part 3 §15.2, §15.3; ROADMAP 19b-i, 19b-ii-a). Every answer is read through its
// contract, so a body this screen cannot read is an error, never an empty list.
function contractError(what) {
  const err = new Error(`response for ${what} did not match its contract`);
  err.isContractError = true;
  return err;
}

async function readThrough(schema, what, request) {
  const res = await request;
  const parsed = schema.safeParse(res.data);
  if (!parsed.success) throw contractError(what);
  return parsed.data;
}

const gymPath = (gymId) => `/v1/orgs/${encodeURIComponent(gymId)}/posts`;
const postPath = (gymId, postId) => `${gymPath(gymId)}/${encodeURIComponent(postId)}`;
const from = (before) => (before === undefined || before === null ? {} : { params: { before } });

/** Where a post's photo is shown from. Used as an <img> address, so it is the api's full
 *  address; the browser sends the sign-in cookie with it. */
export function postPhotoUrl({ gymId, postId, photoId }) {
  return `${authApi.defaults.baseURL ?? ''}${postPath(gymId, postId)}/photos/${encodeURIComponent(photoId)}`;
}

export const postsService = {
  /** A page of the gym's posts, for a member; `before` is the last answer's `next`. */
  list: (gymId, before) => readThrough(gymPostsResponseSchema, 'the updates', authApi.get(gymPath(gymId), from(before))),
  /** The member's one reaction to a post, or null to take it off. */
  react: (gymId, postId, reaction) =>
    readThrough(gymPostReactionResponseSchema, 'your reaction', authApi.put(`${postPath(gymId, postId)}/reaction`, { reaction })),
  /** The member's own post, where the gym lets its members post; one key is one post. */
  add: (gymId, postKey, body, photos) => readThrough(gymPostResponseSchema, 'your post', authApi.post(`${gymPath(gymId)}/mine`, { postKey, body, photos })),
  /** Removes the member's own post. */
  removeOwn: (gymId, postId) => readThrough(removedGymPostResponseSchema, 'the change', authApi.delete(`${gymPath(gymId)}/mine/${encodeURIComponent(postId)}`)),
  /** Reports a post to the gym's staff, with why and anything the member typed. */
  report: (gymId, postId, reason, note) =>
    readThrough(
      reportedGymPostResponseSchema,
      'your report',
      authApi.post(`${postPath(gymId, postId)}/report`, note.trim() === '' ? { reason } : { reason, note: note.trim() }),
    ),
  /** Blocks whoever wrote this post: the member is sent none of their posts or reactions. */
  block: (gymId, postId) => readThrough(blockedGymPosterResponseSchema, 'the change', authApi.put(`${postPath(gymId, postId)}/block`)),
  /** The people the member has blocked at this gym. */
  blocked: (gymId) => readThrough(blockedGymPostersResponseSchema, "who you've blocked", authApi.get(`${gymPath(gymId)}/blocked`)),
  unblock: (gymId, blockId) => readThrough(blockedGymPosterResponseSchema, 'the change', authApi.delete(`${gymPath(gymId)}/blocked/${encodeURIComponent(blockId)}`)),
};

// THE CONSOLE'S UPDATES PAGE: for staff holding `posts.manage`. The server refuses anyone
// else whatever a screen shows.
export const staffPostsService = {
  list: (gymId, before) => readThrough(staffGymPostsResponseSchema, 'the updates', authApi.get(`${gymPath(gymId)}/staff`, from(before))),
  /** Who gave one reaction to a post, by name. */
  reactors: (gymId, postId, reaction) =>
    readThrough(gymPostReactorsResponseSchema, 'who reacted', authApi.get(`${postPath(gymId, postId)}/reactions`, { params: { reaction } })),
  /** A new post: its words and photos (base64, already shrunk), under the key it was
   *  written under, so sending it again after a lost reply makes no second post. */
  add: (gymId, postKey, body, photos) => readThrough(staffGymPostResponseSchema, 'your post', authApi.post(gymPath(gymId), { postKey, body, photos })),
  setPinned: (gymId, postId, pinned) => readThrough(staffGymPostResponseSchema, 'the change', authApi.put(`${postPath(gymId, postId)}/pin`, { pinned })),
  remove: (gymId, postId) => readThrough(removedGymPostResponseSchema, 'the change', authApi.delete(postPath(gymId, postId))),
  /** The reported posts nobody has answered yet, longest waiting first. */
  reported: (gymId) => readThrough(reportedGymPostsResponseSchema, 'the reported posts', authApi.get(`${gymPath(gymId)}/reported`)),
  /** Keeps a reported post: the reports staff were shown (made up to `upTo`, the list
   *  item's `lastReportedAt`) are answered. `waiting` says how many arrived after them. */
  keep: (gymId, postId, upTo) => readThrough(keptGymPostResponseSchema, 'the change', authApi.post(`${postPath(gymId, postId)}/keep`, { upTo })),
  /** The gym's switch: whether its members may post. */
  setMembersCanPost: (gymId, membersCanPost) => readThrough(gymPostSettingsSchema, 'the change', authApi.put(`${gymPath(gymId)}/settings`, { membersCanPost })),
  /** The people this gym has stopped posting. */
  stopped: (gymId) => readThrough(stoppedGymPostersResponseSchema, 'who is stopped from posting', authApi.get(`${gymPath(gymId)}/stopped`)),
  /** Stops one person posting, or lets them post again. */
  setStopped: (gymId, userId, stopped) =>
    readThrough(
      gymPosterStoppedResponseSchema,
      'the change',
      stopped ? authApi.put(`${gymPath(gymId)}/stopped/${encodeURIComponent(userId)}`) : authApi.delete(`${gymPath(gymId)}/stopped/${encodeURIComponent(userId)}`),
    ),
};
