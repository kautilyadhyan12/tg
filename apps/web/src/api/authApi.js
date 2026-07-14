import axios from 'axios';

// P2.8 web repoint (Card 1) — auth on the NEW /v1 API with httpOnly-cookie
// sessions (v1 §6.1: "rotating refresh tokens (httpOnly cookie on web)").
// There are NO tokens in JS: the browser holds access + refresh as httpOnly
// cookies, sent automatically by `withCredentials`. No Authorization header,
// nothing in localStorage — the old localStorage-Bearer model is gone.
const authApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// The login / refresh calls must never recurse through the refresh interceptor.
function isAuthEndpoint(url) {
  return (
    typeof url === 'string' &&
    (url.includes('/v1/auth/login') || url.includes('/v1/auth/refresh'))
  );
}

// Guard against redirect loops: a 401 while already on an auth page (e.g. a
// wrong login password) must not reload /login forever.
function redirectToLogin() {
  if (typeof window === 'undefined') return; // SSR / node tests: no-op
  const p = window.location.pathname;
  if (
    !p.startsWith('/login') && !p.startsWith('/register') &&
    !p.startsWith('/verify-email') && !p.startsWith('/reset-password') &&
    !p.startsWith('/forgot-password')
  ) {
    window.location.href = '/login';
  }
}

// Reactive refresh: the access cookie lives ~15 min (v1 §6.1) and is httpOnly,
// so we can't read its expiry — instead, on a 401 we rotate via
// POST /v1/auth/refresh (which re-sets the cookies) and retry the original
// request ONCE. A 401 means the server rejected the request BEFORE running it,
// so retrying is safe even for a POST — this is NOT the network-failure retry
// R10.2 forbids (there the write may already have happened); it is capped at
// one 401-triggered retry and never fires on 5xx / network errors.
let refreshInFlight = null; // shared so concurrent 401s trigger a single refresh

function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = authApi
      .post('/v1/auth/refresh')
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

authApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    const status = error.response?.status;
    if (status === 401 && config && !config._retried && !isAuthEndpoint(config.url)) {
      config._retried = true;
      try {
        await refreshSession();
      } catch {
        // Refresh itself failed → the session is truly gone.
        redirectToLogin();
        return Promise.reject(error);
      }
      return authApi(config); // retry once, now carrying the rotated cookies
    }
    return Promise.reject(error);
  },
);

export const authService = {
  register:        (data)             => authApi.post('/v1/auth/register', data),
  login:           (data)             => authApi.post('/v1/auth/login', data),
  logout:          ()                 => authApi.post('/v1/auth/logout'),
  verifyEmail:     (token)            => authApi.post('/v1/auth/verify-email', { token }),
  forgotPassword:  (email)            => authApi.post('/v1/auth/forgot-password', { email }),
  resetPassword:   (token, password)  => authApi.post('/v1/auth/reset-password', { token, password }),
  changePassword:  (data)             => authApi.post('/v1/auth/change-password', data),
  getMe:           ()                 => authApi.get('/v1/auth/me'),
};

export default authApi;
