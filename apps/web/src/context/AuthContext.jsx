import { createContext, useContext, useState, useEffect } from 'react';
import { authService } from '../api/authApi';
import { resetTimezoneSync, syncTimezone, userService } from '../api/userApi';
import { setCurrentUserId } from '../utils/storage';
import { flushSyncQueue } from '../sync/syncClient';

const AuthContext = createContext(null);

/** Publish the session's user id to the per-user storage layer BEFORE the app
 *  renders with it: localStorage buckets (and the offline sync queue) are keyed
 *  by it, and it is no longer derivable from a token (httpOnly cookies, v1
 *  §6.1). Then kick the app-load flush — syncClient can no longer do that at
 *  import time, because the id arrives asynchronously (see syncClient.js). */
const adoptSession = (user) => {
  setCurrentUserId(user?.id ?? null);
  if (user) flushSyncQueue().catch(() => {});
};

// Card 6: the onboarding gate flag lives on the users module, not the auth view
// (authUserSchema omits it by design — v1 §6.1:442), so /v1/auth/me and login
// never carry it. Fetch it from /v1/users/me so ProtectedRoute/PublicRoute/Login
// can enforce onboarding again (a Card-1 regression: with the field absent the
// `=== false` gates saw undefined and enforced it for nobody). Fails OPEN
// (undefined) on any error — a profile-read blip must never trap a logged-in
// user; the gate stays exactly as permissive as it is today on failure.
/** One profile read, two facts — the onboarding gate flag and the stored
 *  timezone. Kept as ONE request because both are needed on every session
 *  adoption and the profile already carries both. */
const fetchProfileFacts = async () => {
  try {
    const res = await userService.getProfile();
    return {
      onboardingCompleted: res.data.user?.onboardingCompleted,
      timezone: res.data.user?.timezone ?? null,
    };
  } catch {
    // timezone UNDEFINED, not null (T3 F3): a failed read is not the same as
    // "the server has none", and conflating them makes a transient blip write.
    return { onboardingCompleted: undefined, timezone: undefined };
  }
};


export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

// ── Per-user localStorage helpers ─────────────────────────────────────────────
export const getUserKey = (userId, key) => `user_${userId}_${key}`;

export const getUserData = (userId, key, fallback = null) => {
  try {
    const raw = localStorage.getItem(getUserKey(userId, key));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

export const setUserData = (userId, key, value) => {
  try {
    localStorage.setItem(getUserKey(userId, key), JSON.stringify(value));
  } catch (err) {
    console.error('localStorage error:', err);
  }
};

export const removeUserData = (userId, key) => {
  localStorage.removeItem(getUserKey(userId, key));
};

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  // ── Restore session on mount ──────────────────────────────────────────────
  // Cookies are httpOnly (v1 §6.1) — JS can't inspect them, so we always ask
  // the server who we are. /v1/auth/me carries the access cookie; if it is
  // expired the authApi interceptor rotates via /v1/auth/refresh and retries.
  // A genuine 401 (no valid session) → logged out, no localStorage to clear.
  useEffect(() => {
    authService.getMe()
      .then(async (res) => {
        const authUser = res.data.user;
        adoptSession(authUser);                     // flush timing UNCHANGED (bound to getMe)
        // Enrich with the gate flag BEFORE loading clears, so ProtectedRoute
        // never renders once with onboardingCompleted===undefined (gate open)
        // and then redirects — the `finally` below awaits this.
        const { onboardingCompleted, timezone } = await fetchProfileFacts();
        setUser({ ...authUser, onboardingCompleted });
        // Fire-and-forget AFTER the gate flag has landed: a best-effort write
        // must never delay rendering or hold the loading spinner open.
        void syncTimezone(timezone);
      })
      .catch(() => {
        adoptSession(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // ── Login ─────────────────────────────────────────────────────────────────
  // The server sets the httpOnly access + refresh cookies and returns { user }
  // only — no tokens in the body (DECISIONS 2026-07-11; shared authUserSchema).
  const login = async (email, password) => {
    const res = await authService.login({ email, password });
    const authUser = res.data.user;
    adoptSession(authUser);
    // Enrich with the onboarding gate flag so Login.jsx can route to the wizard
    // vs the dashboard, and ProtectedRoute sees it immediately (login returns
    // authUserSchema, which omits it — same reason as session restore above).
    const { onboardingCompleted, timezone } = await fetchProfileFacts();
    const user = { ...authUser, onboardingCompleted };
    setUser(user);
    // Login is the FIRST session a new account gets, so it is where a timezone
    // is usually captured for the first time. Fire-and-forget: the login
    // resolves on its own timing regardless (best-effort, as above).
    void syncTimezone(timezone);
    return { ...res.data, user };
  };

  // ── Register ──────────────────────────────────────────────────────────────
  // New API field is `displayName` (shared registerRequestSchema); the form
  // still collects `fullName`, so map it here.
  const register = async (fullName, email, password) => {
    const res = await authService.register({ email, password, displayName: fullName });
    return res.data;
  };

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = async () => {
    try {
      await authService.logout(); // server clears the httpOnly cookies
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      // Per-user app data (workout_builder etc) is kept — stored under
      // user_${userId}_${key}, it won't interfere with other users. Dropping
      // the id back to 'guest' is what stops the next account on this browser
      // from reading it (or flushing this user's queued workouts).
      adoptSession(null);
      setUser(null);
      // The next account on this browser must get its OWN timezone written
      // (T3 F1): without this the second user of a shared laptop stays
      // UTC-bucketed for the rest of the page load.
      resetTimezoneSync();
    }
  };

  // ── Update user ───────────────────────────────────────────────────────────
  const updateUser = (data) => {
    setUser((prev) => ({ ...prev, ...data }));
  };

  // ── Forgot password ───────────────────────────────────────────────────────
  const forgotPassword = async (email) => {
    const res = await authService.forgotPassword({ email });
    return res.data;
  };

  // ── Reset password ────────────────────────────────────────────────────────
  const resetPassword = async (token, password) => {
    const res = await authService.resetPassword({ token, password });
    return res.data;
  };

  const value = {
    user,
    setUser,
    loading,
    login,
    logout,
    register,
    updateUser,
    forgotPassword,
    resetPassword,
    isAuthenticated: !!user,
  };

  // ── Loading screen ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: '#0A0908' }}
      >
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
              boxShadow:  '0 0 30px rgba(255,138,31,0.4)',
              animation:  'pulse 2s ease-in-out infinite',
            }}
          >
            <svg
              width="24" height="24" viewBox="0 0 24 24"
              fill="none" stroke="white"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M6 4v16M18 4v16M6 12h12M3 8h3M18 8h3M3 16h3M18 16h3" />
            </svg>
          </div>
          <div
            className="w-6 h-6 border-2 rounded-full animate-spin"
            style={{
              borderColor:    'rgba(255,138,31,0.2)',
              borderTopColor: '#FF8A1F',
            }}
          />
          <p
            className="text-sm font-medium"
            style={{ color: 'rgba(255,255,255,0.35)' }}
          >
            Loading...
          </p>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}