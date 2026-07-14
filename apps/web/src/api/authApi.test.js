// P2.8 web repoint (Card 1) — authApi refresh-retry interceptor (v1 §6.1).
// Node env (vitest.config.js): we swap axios's adapter for a mock, so there is
// no network and no jsdom needed. redirectToLogin is window-guarded, so the
// redirect cases stub a minimal `window`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import authApi, { authService } from './authApi';

// Mock adapter driven by a per-url handler map. Each handler receives the axios
// config and the 1-based call count for that url, and returns { status, data }.
function installAdapter(handlers) {
  const calls = {};
  authApi.defaults.adapter = async (config) => {
    const key = Object.keys(handlers).find((k) => (config.url || '').includes(k));
    if (!key) throw new Error(`no mock handler for ${config.url}`);
    calls[key] = (calls[key] || 0) + 1;
    const r = handlers[key](config, calls[key]);
    if (r.status >= 200 && r.status < 300) {
      return { data: r.data ?? null, status: r.status, statusText: '', headers: {}, config, request: {} };
    }
    const err = new Error(`Request failed with status code ${r.status}`);
    err.config = config;
    err.response = { status: r.status, data: r.data ?? {}, headers: {}, config };
    throw err;
  };
  return calls;
}

afterEach(() => {
  authApi.defaults.adapter = undefined;
  vi.unstubAllGlobals();
});

describe('authApi refresh-retry interceptor (v1 §6.1)', () => {
  it('on 401, rotates via /v1/auth/refresh and retries the original request once', async () => {
    const calls = installAdapter({
      '/v1/auth/me': (_c, n) => (n === 1 ? { status: 401 } : { status: 200, data: { user: { id: 'u1' } } }),
      '/v1/auth/refresh': () => ({ status: 204 }),
    });
    const res = await authService.getMe();
    expect(res.status).toBe(200);
    expect(res.data.user.id).toBe('u1');
    expect(calls['/v1/auth/refresh']).toBe(1);
    expect(calls['/v1/auth/me']).toBe(2); // original + exactly one retry
  });

  it('when refresh fails, rejects the original 401 AND redirects to /login', async () => {
    vi.stubGlobal('window', { location: { pathname: '/dashboard', href: '' } });
    installAdapter({
      '/v1/auth/me': () => ({ status: 401 }),
      '/v1/auth/refresh': () => ({ status: 401 }),
    });
    await expect(authService.getMe()).rejects.toMatchObject({ response: { status: 401 } });
    expect(window.location.href).toBe('/login');
  });

  it('does NOT redirect when already on an auth page (loop guard)', async () => {
    vi.stubGlobal('window', { location: { pathname: '/login', href: '' } });
    installAdapter({
      '/v1/auth/me': () => ({ status: 401 }),
      '/v1/auth/refresh': () => ({ status: 401 }),
    });
    await expect(authService.getMe()).rejects.toMatchObject({ response: { status: 401 } });
    expect(window.location.href).toBe(''); // unchanged
  });

  it('concurrent 401s trigger a SINGLE refresh, then both retry', async () => {
    const calls = installAdapter({
      '/v1/auth/me': (_c, n) => (n <= 2 ? { status: 401 } : { status: 200, data: { ok: true } }),
      '/v1/auth/refresh': () => ({ status: 204 }),
    });
    const [a, b] = await Promise.all([authService.getMe(), authService.getMe()]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(calls['/v1/auth/refresh']).toBe(1); // one shared refresh, not two
  });

  it('a 401 from login itself is NOT retried (no refresh recursion)', async () => {
    const calls = installAdapter({
      '/v1/auth/login': () => ({ status: 401, data: { error: 'invalid_credentials' } }),
      '/v1/auth/refresh': () => ({ status: 204 }),
    });
    await expect(authService.login({ email: 'x@y.z', password: 'nope' }))
      .rejects.toMatchObject({ response: { status: 401 } });
    expect(calls['/v1/auth/refresh']).toBeUndefined(); // never attempted
  });
});
