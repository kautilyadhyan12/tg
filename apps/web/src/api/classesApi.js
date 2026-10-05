import { classBookingResponseSchema, memberClassesResponseSchema } from '@app/shared';
import authApi from './authApi';

// A MEMBER'S CLASSES (spec Part 3 §13.6; ROADMAP 17d). Every answer is read through its
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

const gymPath = (gymId) => `/v1/orgs/${encodeURIComponent(gymId)}`;
const bookingPath = (gymId, sessionId) => `${gymPath(gymId)}/class-sessions/${encodeURIComponent(sessionId)}/booking`;

export const classesService = {
  /** A week of the gym's coming classes, each with the reader's own booking. */
  list: (gymId, week) =>
    readThrough(memberClassesResponseSchema, 'the classes', authApi.get(`${gymPath(gymId)}/member-classes`, { params: { week } })),
  /** Book, Join waitlist (`joinWaitlist`) and Claim. The same `requestKey` again changes nothing. */
  book: (gymId, sessionId, requestKey, joinWaitlist) =>
    readThrough(classBookingResponseSchema, 'your booking', authApi.post(bookingPath(gymId, sessionId), { requestKey, joinWaitlist })).then(
      (data) => data.booking,
    ),
  /** Cancel a booking, or leave the waitlist. Past the free time the server answers 409
   *  `late_cancel` until `lateOk`. */
  cancel: (gymId, sessionId, lateOk) =>
    readThrough(classBookingResponseSchema, 'your booking', authApi.post(`${bookingPath(gymId, sessionId)}/cancel`, { lateOk })).then(
      (data) => data.booking,
    ),
};
