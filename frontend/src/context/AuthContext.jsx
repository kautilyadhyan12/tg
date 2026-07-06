import { createContext, useContext, useState, useEffect } from 'react';
import { authService } from '../api/authApi';
import mlApi from '../api/mlApi';

const AuthContext = createContext(null);

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
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      setLoading(false);
      return;
    }
    mlApi.get('/users/profile')
      .then((res) => {
        setUser(res.data.user);
      })
      .catch((err) => {
        // Only destroy the session when the SERVER says the token is bad
        // (401/403). A network blip or a server restart during app open is
        // NOT a reason to log the user out — previously any error wiped the
        // tokens and forced a re-login. Keeping them means a simple refresh
        // restores the session once connectivity returns.
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
        }
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // ── Login ─────────────────────────────────────────────────────────────────
  const login = async (email, password) => {
    const res = await authService.login({ email, password });

    localStorage.setItem('accessToken', res.data.accessToken);
    if (res.data.refreshToken) {
      localStorage.setItem('refreshToken', res.data.refreshToken);
    }

    setUser(res.data.user);
    return res.data;
  };

  // ── Register ──────────────────────────────────────────────────────────────
  const register = async (fullName, email, password) => {
    const res = await authService.register({ fullName, email, password });
    return res.data;
  };

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = async () => {
    try {
      await authService.logout();
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      // Note: user-specific data (workout_builder etc) is kept
      // It is stored under user_${userId}_${key} so it won't
      // interfere with other users
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