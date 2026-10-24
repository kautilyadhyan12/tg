import axios from 'axios';
import { agreementLinkResponseSchema, agreementLinkSignResponseSchema } from '@app/shared';

// THE PAGE AN EMAILED LINK TO SIGN OPENS (ROADMAP 18u-ii-b). Nobody is signed in: the token is
// the whole request, and it rides in the body, never in an address. Not `authApi`, whose 401
// handling would send the reader to a sign-in they do not have.
const linkApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: false,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
});

async function readThrough(schema, request) {
  const res = await request;
  const parsed = schema.safeParse(res.data);
  if (!parsed.success) {
    const err = new Error('agreement link answer did not match its contract');
    err.isContractError = true;
    throw err;
  }
  return parsed.data;
}

export const agreementLinkService = {
  read: (token) => readThrough(agreementLinkResponseSchema, linkApi.post('/v1/agreement-link/read', { token })),
  /** `body`: the wording's id and the details' key the page showed, who signs, and the name. */
  sign: (token, body) => readThrough(agreementLinkSignResponseSchema, linkApi.post('/v1/agreement-link/sign', { token, ...body })),
};
