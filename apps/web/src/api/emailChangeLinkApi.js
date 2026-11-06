import axios from 'axios';
import { emailChangeLinkResponseSchema, emailChangeUndoResponseSchema } from '@app/shared';

// THE PAGE THE "UNDO THIS CHANGE" LINK OPENS (item 19's security pass, H1). Nobody is signed in: the
// token is the whole request, and it rides in the body, never in an address. Not `authApi`, whose 401
// handling would send the reader to a sign-in.
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
    const err = new Error('undo link answer did not match its contract');
    err.isContractError = true;
    throw err;
  }
  return parsed.data;
}

export const emailChangeLinkService = {
  read: (token) => readThrough(emailChangeLinkResponseSchema, linkApi.post('/v1/email-change/read', { token })),
  undo: (token) => readThrough(emailChangeUndoResponseSchema, linkApi.post('/v1/email-change/undo', { token })),
};
