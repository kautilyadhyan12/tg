// The health screening and the consent log on the new API (ROADMAP Stage 1
// items 3b and 4b-i).
//   GET  /v1/users/me/health-screening   the stored answer, and what it derives
//   PUT  /v1/users/me/health-screening   the whole screening replaced
//   POST /v1/users/me/consents           one tap on a disclaimer
//
// The question is ONE yes or no plus "Check first" (RULINGS 2026-09-09): the
// app never asks what the condition is, so there is nothing else to send. Both
// replies are parsed through the shared contract, the same object the server
// parses its reply through, so a malformed body can never become a screen.
import {
  CURRENT_DISCLAIMER_VERSION,
  consentRecordResponseSchema,
  healthScreeningResponseSchema,
} from '@app/shared';
import authApi from './authApi';

const PATH = '/v1/users/me/health-screening';

/** The build that showed the words, stored on every consent row, made to fit
 *  the contract whatever the build sets: clipped to the 40 characters allowed,
 *  and a variable set to nothing (or to spaces) falls back exactly as an unset
 *  one does — the contract asks for at least one character, so a blank would
 *  be a 400 on the tap that records the person's agreement, and nobody could
 *  finish setup. Until the deploy sets `VITE_APP_VERSION` (roadmap Stage 4
 *  item 1) a build honestly says it is a development one rather than claiming
 *  a version nobody released. */
export function clipVersion(raw) {
  return String(raw ?? '').trim().slice(0, 40) || 'web-dev';
}

export const APP_VERSION = clipVersion(import.meta.env?.VITE_APP_VERSION);

async function readThrough(request, schema) {
  const res = await request;
  const parsed = schema.safeParse(res.data);
  if (!parsed.success) {
    // Flagged so `errorText` says the server answered with something this
    // screen cannot read, rather than blaming the connection.
    const err = new Error('health response did not match its contract');
    err.isContractError = true;
    throw err;
  }
  return { ...res, data: parsed.data };
}

export const healthService = {
  get: () => readThrough(authApi.get(PATH), healthScreeningResponseSchema),
  /** `checkFirst` is required on a yes and refused on a no — the screen never
   *  sends a yes until one of the two is picked. */
  put: (body) => readThrough(authApi.put(PATH, body), healthScreeningResponseSchema),
};

export const consentService = {
  /** One tap. The client names the screen and the wording VERSION it showed;
   *  the SERVER writes the text it holds for that version, so a row can only
   *  ever carry words the app has actually shown (RULINGS 2026-09-07). */
  record: (purpose) =>
    readThrough(
      authApi.post('/v1/users/me/consents', {
        purpose,
        wordingVersion: CURRENT_DISCLAIMER_VERSION[purpose],
        appVersion: APP_VERSION,
      }),
      consentRecordResponseSchema,
    ),
};
