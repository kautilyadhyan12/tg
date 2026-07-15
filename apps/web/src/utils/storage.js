/**
 * Per-user localStorage utility.
 * All user data is stored under user_${userId}_${key}
 * so different users on the same browser never share data.
 */

// ── the signed-in user's id ──────────────────────────────────────────────────
// Pushed in by AuthContext (setCurrentUserId) on session restore / login /
// logout. This used to be decoded from a localStorage JWT, but the web repoint
// moved sessions to httpOnly cookies (v1 §6.1) which JS cannot read — so the id
// MUST be supplied by the auth layer. Without it getUserId() would return
// 'guest' for everyone and every account on a device would share one bucket,
// including the offline sync queue (syncQueue.js keys on userKey) — which would
// let one user's queued workouts flush under another's session.
// NOTE: because the id now arrives asynchronously (after /v1/auth/me), any
// flush trigger must run AFTER auth resolves — see syncClient.js.
let _currentUserId = 'guest';

/** Set by AuthContext whenever the session changes. Falsy id → 'guest'. */
export const setCurrentUserId = (id) => {
  _currentUserId = id ? String(id) : 'guest';
};

export const getUserId = () => _currentUserId;

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
