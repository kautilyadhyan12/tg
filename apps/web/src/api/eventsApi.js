import { gymEventResponseSchema, gymEventsResponseSchema, staffGymEventsResponseSchema } from '@app/shared';
import authApi from './authApi';

// A GYM'S EVENTS (spec Part 3 §15.4; ROADMAP 19c-i). Every answer is read through its
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

const gymPath = (gymId) => `/v1/orgs/${encodeURIComponent(gymId)}/events`;
const eventPath = (gymId, eventId) => `${gymPath(gymId)}/${encodeURIComponent(eventId)}`;

/** Where an event's poster is shown from. Used as an <img> address, so it is the api's full
 *  address; the browser sends the sign-in cookie with it. */
export function eventPosterUrl({ gymId, eventId, posterId }) {
  return `${authApi.defaults.baseURL ?? ''}${eventPath(gymId, eventId)}/poster/${encodeURIComponent(posterId)}`;
}

export const eventsService = {
  /** The gym's coming events, for a member. */
  list: (gymId) => readThrough(gymEventsResponseSchema, 'the events', authApi.get(gymPath(gymId))),
};

// THE CONSOLE'S EVENTS PAGE: for staff holding `posts.manage`. The server refuses anyone
// else whatever a screen shows.
export const staffEventsService = {
  list: (gymId) => readThrough(staffGymEventsResponseSchema, 'the events', authApi.get(`${gymPath(gymId)}/staff`)),
  /** A new event; one key is one event. `fields` may hold `poster`, base64. */
  add: (gymId, eventKey, fields) =>
    readThrough(gymEventResponseSchema, 'the event', authApi.post(gymPath(gymId), { eventKey, ...fields })).then((data) => data.event),
  /** `fields.poster`: left out keeps the poster, null takes it off, base64 is a new one. */
  change: (gymId, eventId, fields) =>
    readThrough(gymEventResponseSchema, 'the event', authApi.put(eventPath(gymId, eventId), fields)).then((data) => data.event),
  setCancelled: (gymId, eventId, cancelled) =>
    readThrough(gymEventResponseSchema, 'the event', authApi.put(`${eventPath(gymId, eventId)}/cancelled`, { cancelled })).then((data) => data.event),
};
