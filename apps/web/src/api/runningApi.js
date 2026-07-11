import mlApi from './mlApi';

export const runningService = {
  // Route planning
  generateRoutes: (data)              => mlApi.post('/running/routes/generate', data),
  saveRoute:      (route)             => mlApi.post('/running/routes/save', { route }),
  getRoute:       (id)                => mlApi.get(`/running/routes/${id}`),

  // Scheduling
  createSchedule: (data)              => mlApi.post('/running/schedule', data),
  getSchedule:    ()                  => mlApi.get('/running/schedule'),
  cancelSchedule: (id)                => mlApi.delete(`/running/schedule/${id}`),

  // Live sessions
  startSession:   (data)             => mlApi.post('/running/sessions/start', data),
  matchPath:      (path)             => mlApi.post('/running/match', { path }),
  trackSession:   (id, data)         => mlApi.patch(`/running/sessions/${id}/track`, data),
  completeSession:(id, data)         => mlApi.patch(`/running/sessions/${id}/complete`, data),
  getSessions:    (limit = 20)       => mlApi.get('/running/sessions', { params: { limit } }),
  getSummary:     (id)               => mlApi.get(`/running/sessions/${id}/summary`),

  // Hub
  getStats:       ()                 => mlApi.get('/running/stats'),
};
