import { gymGroupMessagesSwitchResponseSchema, gymInboxResponseSchema, markGymInboxReadResponseSchema } from '@app/shared';
import authApi from './authApi';

// A MEMBER'S INBOX FROM THEIR GYM (spec Part 3 §16.1; ROADMAP 20a). Every answer is read
// through its contract, so a body this screen cannot read is an error, never an empty inbox.
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

const inboxPath = (gymId) => `/v1/orgs/${encodeURIComponent(gymId)}/inbox`;

export const inboxService = {
  /** The gym's messages to this member, newest first. Reading marks nothing. */
  read: (gymId) => readThrough(gymInboxResponseSchema, 'the inbox', authApi.get(inboxPath(gymId))),
  /** Marks as read every message sent up to `upTo`: the `asOf` of the read that was shown. */
  markRead: (gymId, upTo) =>
    readThrough(markGymInboxReadResponseSchema, 'the inbox', authApi.post(`${inboxPath(gymId)}/read`, { upTo })).then((data) => data.unread),
  /** The member's own switch for this gym's messages to groups; answers how it now stands. */
  setGroupMessages: (gymId, on) =>
    readThrough(gymGroupMessagesSwitchResponseSchema, 'that switch', authApi.put(`${inboxPath(gymId)}/group-messages`, { on })).then(
      (data) => data.groupMessages,
    ),
};
