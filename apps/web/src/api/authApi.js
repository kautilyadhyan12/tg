import axios from 'axios';

const authApi = axios.create({
  baseURL: import.meta.env.VITE_AUTH_API_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

authApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

authApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('accessToken');
      // Guard against redirect loops: a 401 while already on an auth page
      // (e.g. a wrong login password) must not reload /login forever.
      const p = window.location.pathname;
      if (!p.startsWith('/login') && !p.startsWith('/register') &&
          !p.startsWith('/verify-email') && !p.startsWith('/reset-password') &&
          !p.startsWith('/forgot-password')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export const authService = {
  register:        (data)             => authApi.post('/auth/register', data),
  login:           (data)             => authApi.post('/auth/login', data),
  logout:          ()                 => authApi.post('/auth/logout'),
  verifyEmail:     (token)            => authApi.post('/auth/verify-email', { token }),
  forgotPassword:  (email)            => authApi.post('/auth/forgot-password', { email }),
  resetPassword:   (token, password)  => authApi.post('/auth/reset-password', { token, password }),
  getMe:           ()                 => authApi.get('/auth/me'),
};

export default authApi;