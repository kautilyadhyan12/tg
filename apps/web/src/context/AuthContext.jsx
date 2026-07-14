import { createContext, useContext, useState, useEffect } from 'react';
import { authService } from '../api/authApi';

const AuthContext = createContext(null);

// Interim compat shim: the new API user shape (v1 §6.1) exposes `displayName`,
// but 6 display sites still read `user.fullName`. Alias it here so this auth
// card stays contained; the users/profile card migrates those sites and drops
// this. (New shape: { id, email, displayName, emailVerified, locale, units }.)
const normalizeUser = (u) => (u ? { ...u, fullName: u.displayName } : u);

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
      .then((res) => setUser(normalizeUser(res.data.user)))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // ── Login ─────────────────────────────────────────────────────────────────
  // The server sets the httpOnly access + refresh cookies and returns { user }
  // only — no tokens in the body (DECISIONS 2026-07-11; shared authUserSchema).
  const login = async (email, password) => {
    const res = await authService.login({ email, password });
    setUser(normalizeUser(res.data.user));
    return res.data;
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
      // user_${userId}_${key}, it won't interfere with other users.
      setUser(null);
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