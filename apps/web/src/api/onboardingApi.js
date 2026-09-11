// Onboarding v2 on the new API (ROADMAP Stage 1 item 4a-ii): the answers so
// far and the plan they make.
//   GET   /v1/users/me/onboarding   the answers and the plan, or what is missing
//   PATCH /v1/users/me/onboarding   one screen's answers: a key left out is left
//                                   alone, null clears it, {} simply re-reads
// Both carry the DEVICE's time zone, so the finish date is counted in the
// person's own day (RULINGS 2026-07-21); the day itself is never sent. Every
// answer is parsed through the shared contract, the same object the server
// parses its reply through, so a malformed body can never become a number on
// screen.
import { onboardingIncompleteBodySchema, onboardingResponseSchema } from '@app/shared';
import authApi from './authApi';
import { detectTimezone } from './userApi';

const PATH = '/v1/users/me/onboarding';

/** The query: the device's zone, or nothing when the browser cannot say (the
 *  server then uses the zone it has stored). */
export function onboardingParams(zone = detectTimezone()) {
  return typeof zone === 'string' && zone.trim() !== '' ? { timeZone: zone.trim() } : {};
}

async function readThrough(request) {
  const res = await request;
  const parsed = onboardingResponseSchema.safeParse(res.data);
  if (!parsed.success) {
    // Flagged so `errorText` says the server answered with something this
    // screen cannot read, rather than blaming the connection.
    const err = new Error('onboarding response did not match its contract');
    err.isContractError = true;
    throw err;
  }
  return { ...res, data: parsed.data };
}

export const onboardingService = {
  get: () => readThrough(authApi.get(PATH, { params: onboardingParams() })),
  patch: (body) => readThrough(authApi.patch(PATH, body, { params: onboardingParams() })),
};

/** The questions a refused finish names (the server's 409), or null when the
 *  failure was anything else. */
export function refusedFinish(err) {
  if (err?.response?.status !== 409) return null;
  const parsed = onboardingIncompleteBodySchema.safeParse(err.response.data);
  return parsed.success ? parsed.data.missing : null;
}
