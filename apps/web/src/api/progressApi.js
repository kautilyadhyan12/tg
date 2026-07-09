import mlApi from './mlApi';

export const progressService = {
  getOverview:             (period = '30d') => mlApi.get('/progress/overview',              { params: { period } }),
  getCaloriesTrend:        (period = '30d') => mlApi.get('/progress/calories-trend',        { params: { period } }),
  getWeeklyWorkouts:       (period = '90d') => mlApi.get('/progress/weekly-workouts',       { params: { period } }),
  getActivityHeatmap:      ()               => mlApi.get('/progress/activity-heatmap'),
  getCategoryDistribution: (period = '30d') => mlApi.get('/progress/category-distribution', { params: { period } }),
  getPersonalRecords:      ()               => mlApi.get('/progress/personal-records'),
  getPredictions:          ()               => mlApi.get('/progress/predictions'),
  logMeasurement:          (data)           => mlApi.post('/progress/measurements', data),
  getMeasurements:         (limit = 30)     => mlApi.get('/progress/measurements', { params: { limit } }),
  deleteMeasurement:       (id)             => mlApi.delete(`/progress/measurements/${id}`),
};