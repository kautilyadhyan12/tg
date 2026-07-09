import axios from 'axios';

const mlApi = axios.create({
  baseURL: import.meta.env.VITE_ML_API_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

mlApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

mlApi.interceptors.response.use(
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

export default mlApi;