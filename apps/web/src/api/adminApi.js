import {
  adminDayResponseSchema,
  adminDoorStateSchema,
  adminPeopleResponseSchema,
  adminPersonDaysResponseSchema,
  adminSetLimitsResponseSchema,
} from '@app/shared';
import authApi from './authApi';

// THE ADMIN PAGE (ROADMAP Stage 2 item 14a-i): Kd's own. The server answers "not found" to
// every other account and keeps the page locked until his door is open, so this file decides
// nothing; it reads answers through their contract, so a body this screen cannot read is an
// error, never an empty list.
function contractError(what) {
  const err = new Error(`response for ${what} did not match its contract`);
  err.isContractError = true;
  return err;
}

function read(schema, data, what) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw contractError(what);
  return parsed.data;
}

export const adminService = {
  /** The door's state, or null for "not found": this account is not the admin. */
  door: async () => {
    try {
      const res = await authApi.get('/v1/admin/door');
      return read(adminDoorStateSchema, res.data, 'the admin door');
    } catch (err) {
      if (err?.response?.status === 404) return null;
      throw err;
    }
  },
  makePassword: async (password) => read(adminDoorStateSchema, (await authApi.post('/v1/admin/door/password', { password })).data, 'the admin door'),
  openDoor: async (password) => read(adminDoorStateSchema, (await authApi.post('/v1/admin/door/open', { password })).data, 'the admin door'),
  lock: async () => {
    await authApi.post('/v1/admin/door/lock');
  },

  /** One page of the people using the app; `after` is the last page's `next`. */
  people: async ({ search = '', after = null } = {}) => {
    const params = {};
    if (search.trim() !== '') params.search = search.trim();
    if (after !== null) params.after = after;
    const res = await authApi.get('/v1/admin/people', { params });
    return read(adminPeopleResponseSchema, res.data, 'the people list');
  },

  /** One person's days, 30 at a time (14a-ii); `before` is the last page's `next`. `zone` is the
   *  admin's own, for a person whose phone has sent none. */
  personDays: async (personId, { zone, before = null }) => {
    const params = { zone };
    if (before !== null) params.before = before;
    const res = await authApi.get(`/v1/admin/people/${encodeURIComponent(personId)}/days`, { params });
    return read(adminPersonDaysResponseSchema, res.data, "a person's days");
  },

  /** Everyone who used the app on one day (14a-ii); `from` is the last page's `next`. */
  day: async (day, { zone, from = 0 }) => {
    const params = { zone };
    if (from > 0) params.from = String(from);
    const res = await authApi.get(`/v1/admin/days/${encodeURIComponent(day)}`, { params });
    return read(adminDayResponseSchema, res.data, 'the day');
  },

  /** Sets one feature's number a day for these people, or with `perDay` null takes it back. */
  setLimits: async ({ userIds, feature, perDay }) => {
    const res = await authApi.put('/v1/admin/limits', { userIds, feature, perDay });
    return read(adminSetLimitsResponseSchema, res.data, 'setting the numbers');
  },
};

/** A refusal because the door is shut (it timed out, or was locked elsewhere). */
export const isDoorShut = (err) => err?.response?.status === 403 && err?.response?.data?.error === 'admin_locked';
