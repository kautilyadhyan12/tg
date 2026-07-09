/**
 * Per-user localStorage utility.
 * All user data is stored under user_${userId}_${key}
 * so different users on the same browser never share data.
 */

// ── base64url-safe JWT payload decode ────────────────────────────────────────
// JWTs are base64URL-encoded ('-' and '_' instead of '+' and '/', no '=').
// Plain atob() THROWS on those characters, and the old catch fell back to
// 'guest' — meaning users whose token payload happened to contain '-' or '_'
// (random chance, depends on their id bits) silently had all their data
// saved under the shared 'guest' bucket, colliding with other accounts on
// the same device. Normalize to standard base64 before decoding.
function decodeJwtPayload(token) {
  const part = token.split('.')[1];
  if (!part) return null;
  let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return JSON.parse(atob(b64));
}

// Cache the decode per token string — userKey() runs on every storage call.
let _cachedToken = null;
let _cachedUserId = 'guest';

export const getUserId = () => {
  try {
    const token = localStorage.getItem('accessToken');
    if (!token) return 'guest';
    if (token === _cachedToken) return _cachedUserId;
    const payload = decodeJwtPayload(token);
    _cachedToken = token;
    _cachedUserId = String(payload?.id || payload?._id || 'guest');
    return _cachedUserId;
  } catch {
    return 'guest';
  }
};

export const userKey = (key) => `user_${getUserId()}_${key}`;

export const getItem = (key, fallback = null) => {
  try {
    const raw = localStorage.getItem(userKey(key));
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

export const setItem = (key, value) => {
  try {
    localStorage.setItem(userKey(key), JSON.stringify(value));
  } catch (err) {
    console.error('Storage error:', err);
  }
};

export const removeItem = (key) => {
  localStorage.removeItem(userKey(key));
};
