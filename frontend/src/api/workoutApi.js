import mlApi from './mlApi';

export const workoutService = {
  getStats:        ()           => mlApi.get('/workouts/stats'),
  getHistory:      (limit = 10) => mlApi.get('/workouts', { params: { limit } }),
  createSession:   (data)       => mlApi.post('/workouts', data),
  completeSession: (id, data)   => mlApi.patch(`/workouts/${id}/complete`, data),
  getSummary:      (id)         => mlApi.get(`/workouts/${id}/summary`),
  getHistory:      (month, year)     => mlApi.get('/workouts/history', { params: { month, year } }),
  saveTemplate:    (name, exercises) => mlApi.post('/workouts/templates', { name, exercises }),
  getTemplates:    ()                => mlApi.get('/workouts/templates'),
  deleteTemplate:  (id)              => mlApi.delete(`/workouts/templates/${id}`),
  useTemplate:     (id)              => mlApi.post(`/workouts/templates/${id}/use`),
};