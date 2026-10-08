import { memberPtResponseSchema, memberPtSessionResponseSchema } from '@app/shared';
import authApi from './authApi';

// A MEMBER'S OWN PERSONAL TRAINING (spec Part 3 §13.5; ROADMAP 17e-ii). Every answer is
// read through its contract, so a body this screen cannot read is an error, never an
// empty list.
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

const path = (gymId) => `/v1/orgs/${encodeURIComponent(gymId)}/member-pt`;

export const memberPtService = {
  /** Seven days of the gym's trainers' available times, with the reader's own sessions. */
  view: (gymId, week) => readThrough(memberPtResponseSchema, 'personal training', authApi.get(path(gymId), { params: { week } })),
  /** Book a time for the reader. The same `requestKey` again changes nothing. */
  book: (gymId, requestKey, time) =>
    readThrough(memberPtSessionResponseSchema, 'your session', authApi.post(`${path(gymId)}/sessions`, { requestKey, ...time })).then((data) => data.session),
  /** Cancel one of the reader's sessions. Past the free time the server answers 409
   *  `late_cancel` until `lateOk`. */
  cancel: (gymId, sessionId, lateOk) =>
    readThrough(
      memberPtSessionResponseSchema,
      'your session',
      authApi.post(`${path(gymId)}/sessions/${encodeURIComponent(sessionId)}/cancel`, { lateOk }),
    ).then((data) => data.session),
};
