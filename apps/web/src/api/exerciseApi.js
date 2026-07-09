import mlApi from './mlApi';

export const exerciseService = {
  // Get exercises with filters
  getExercises: (params) => mlApi.get('/exercises', { params }),

  // Get single exercise
  getExercise: (id) => mlApi.get(`/exercises/${id}`),

  // Get all categories
  getCategories: () => mlApi.get('/exercises/categories'),

  // Get all muscles
  getMuscles: () => mlApi.get('/exercises/muscles'),

  getMedia: (name) => mlApi.get(`/exercises/media/${encodeURIComponent(name)}`),
};