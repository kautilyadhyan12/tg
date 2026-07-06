import mlApi from './mlApi';

export const recommendationService = {
  getRecommendations: (limit = 6) =>
    mlApi.get('/recommendations', { params: { limit } }),
};