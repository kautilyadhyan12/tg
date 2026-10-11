import { atRiskMessageResponseSchema, atRiskResponseSchema, atRiskSettingsResponseSchema, sendGymNudgeResponseSchema } from '@app/shared';
import authApi from './authApi';

// THE CONSOLE'S AT RISK PAGE (spec Part 3 §16.4; ROADMAP 20d-i): for staff holding
// `members.read`. The server refuses anyone else whatever a screen shows. Each answer is
// read through its contract, so a body this screen cannot read is an error, never an
// empty list.
function contractError(what) {
  const err = new Error(`response for ${what} did not match its contract`);
  err.isContractError = true;
  return err;
}

const gymPath = (gymId) => `/v1/orgs/${encodeURIComponent(gymId)}`;

export const atRiskService = {
  /** Who has stopped coming, with the gym's two numbers and what its check-ins allow. */
  list: async (gymId) => {
    const res = await authApi.get(`${gymPath(gymId)}/at-risk`);
    const parsed = atRiskResponseSchema.safeParse(res.data);
    if (!parsed.success) throw contractError('the at risk list');
    return parsed.data;
  },
  /** The gym's two numbers, saved by whoever runs the gym. */
  saveSettings: async (gymId, settings) => {
    const res = await authApi.put(`${gymPath(gymId)}/at-risk/settings`, settings);
    const parsed = atRiskSettingsResponseSchema.safeParse(res.data);
    if (!parsed.success) throw contractError('the at risk settings');
    return parsed.data.settings;
  },
  /** One of the four come-back lines, to one person in the app. Not sent twice: a second
   *  inside the wait is refused by the server. */
  sendMessage: async (gymId, userId, preset) => {
    const res = await authApi.post(`${gymPath(gymId)}/members/${encodeURIComponent(userId)}/nudge`, { preset });
    const parsed = sendGymNudgeResponseSchema.safeParse(res.data);
    if (!parsed.success) throw contractError('that message');
    return parsed.data.nudge;
  },
  /** The gym's own words to one person in the app. `key` is the box's own, so the same
   *  box pressed twice sends once. */
  sendOwnMessage: async (gymId, userId, body, key) => {
    const res = await authApi.post(`${gymPath(gymId)}/at-risk/messages`, { userId, body, key });
    const parsed = atRiskMessageResponseSchema.safeParse(res.data);
    if (!parsed.success) throw contractError('that message');
    return parsed.data.message;
  },
};
