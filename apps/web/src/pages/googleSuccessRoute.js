// Pure routing decision for the Google OAuth landing, extracted so every branch
// is unit-testable without a DOM (the web project has no jsdom yet). Returning
// null means the session is still being restored — stay on the spinner.
export function googleSuccessRoute(user, loading) {
  if (loading) return null;
  // Reaching /success without a session means the cookie restore failed.
  if (!user) return '/login?error=google_failed';
  // Mirror the password-login routing (Login.jsx): finish onboarding first.
  // A missing flag fails OPEN to the dashboard (same as ProtectedRoute).
  return user.onboardingCompleted === false ? '/onboarding' : '/dashboard';
}
