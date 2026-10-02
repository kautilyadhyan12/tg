import axios from 'axios';
import { checkinScanResponseSchema, claimCheckinDeviceResponseSchema } from '@app/shared';

// THE FRONT DESK'S OWN CONNECTION (spec Part 3 §12.3; ROADMAP 16b-i). The desk is nobody's
// session: its key is an httpOnly cookie the api sends only to `/v1/checkin`. So it does
// not go through `authApi`, whose 401 handling refreshes a person's session and sends the
// page to sign-in — a desk switched off answers 401 and must say so where it stands.
const deskApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
});

function contractError() {
  const err = new Error('check-in answer did not match its contract');
  err.isContractError = true;
  return err;
}

async function readThrough(schema, request) {
  const res = await request;
  const parsed = schema.safeParse(res.data);
  if (!parsed.success) throw contractError();
  return parsed.data;
}

export const checkinService = {
  /** The tablet opens its one-time link: the server sets the device's key as a cookie. */
  claimDevice: (token) => readThrough(claimCheckinDeviceResponseSchema, deskApi.post('/v1/checkin/device/claim', { token })),
  /** What the scanner or the camera read: a pass or a key tag. */
  scan: (code) => readThrough(checkinScanResponseSchema, deskApi.post('/v1/checkin/scan', { code })),
};
