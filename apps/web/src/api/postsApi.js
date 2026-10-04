import {
  gymPostReactionResponseSchema,
  gymPostResponseSchema,
  gymPostsResponseSchema,
  removedGymPostResponseSchema,
  staffGymPostsResponseSchema,
} from '@app/shared';
import authApi from './authApi';

// A GYM'S UPDATES (spec Part 3 §15.2; ROADMAP 19b-i). Every answer is read through its
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
};

// THE CONSOLE'S UPDATES PAGE: for staff holding `posts.manage`. The server refuses anyone
// else whatever a screen shows.
export const staffPostsService = {
  list: (gymId, before) => readThrough(staffGymPostsResponseSchema, 'the updates', authApi.get(`${gymPath(gymId)}/staff`, from(before))),
  /** A new post: its words and photos (base64, already shrunk), under the key it was
   *  written under, so sending it again after a lost reply makes no second post. */
  add: (gymId, postKey, body, photos) => readThrough(gymPostResponseSchema, 'your post', authApi.post(gymPath(gymId), { postKey, body, photos })),
  setPinned: (gymId, postId, pinned) => readThrough(gymPostResponseSchema, 'the change', authApi.put(`${postPath(gymId, postId)}/pin`, { pinned })),
  remove: (gymId, postId) => readThrough(removedGymPostResponseSchema, 'the change', authApi.delete(postPath(gymId, postId))),
};
