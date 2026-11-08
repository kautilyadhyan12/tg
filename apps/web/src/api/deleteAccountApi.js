import axios from 'axios';
import { deleteAccountResponseSchema, sendCodeResponseSchema } from '@app/shared';

// THE WEBSITE'S DELETE YOUR ACCOUNT PAGE (21b-ii). Nobody is signed in: the code emailed to the address
// typed is the proof. Not `authApi`, whose 401 handling would send the reader to a sign-in, and no
// cookies go with it.
const pageApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: false,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
});

async function readThrough(schema, request) {
  const res = await request;
  const parsed = schema.safeParse(res.data);
  if (!parsed.success) {
    const err = new Error('delete account answer did not match its contract');
    err.isContractError = true;
    throw err;
  }
  return parsed.data;
}

export const deleteAccountService = {
  sendCode: (email, robotToken) =>
    readThrough(sendCodeResponseSchema, pageApi.post('/v1/account-deletion/code', robotToken ? { email, robotToken } : { email })),
  deleteAccount: (email, code) => readThrough(deleteAccountResponseSchema, pageApi.post('/v1/account-deletion', { email, code })),
};
