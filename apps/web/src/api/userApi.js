import mlApi from './mlApi';

export const userService = {
  getProfile:         ()     => mlApi.get('/users/profile'),
  updateProfile:      (data) => mlApi.patch('/users/profile', data),
  completeOnboarding: (data) => mlApi.patch('/users/onboarding', data),
};