import mlApi from './mlApi';

const ML_BASE = import.meta.env.VITE_ML_API_URL || 'http://localhost:8000/api';

export const nutritionService = {
  getTargets: () => mlApi.get('/nutrition/targets'),

  searchFood: (query, limit = 10) =>
    mlApi.get('/nutrition/search', { params: { q: query, limit } }),

  logMeal: (meal) =>
    mlApi.post('/nutrition/meals', meal),

  getTodayMeals: () =>
    mlApi.get('/nutrition/meals/today'),

  getMealsByDate: (dateStr) =>
    mlApi.get(`/nutrition/meals/date/${dateStr}`),

  deleteMeal: (mealId) =>
    mlApi.delete(`/nutrition/meals/${mealId}`),

  updateMeal: (mealId, data) =>
    mlApi.patch(`/nutrition/meals/${mealId}`, data),

  getWeeklySummary: () =>
    mlApi.get('/nutrition/weekly-summary'),

  // Photo analysis uses fetch directly (multipart upload)
  analyzePhoto: async (file) => {
    const token = localStorage.getItem('accessToken');
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${ML_BASE}/nutrition/analyze-photo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `Analysis failed: ${response.status}`);
    }

    return response.json();
  },
};