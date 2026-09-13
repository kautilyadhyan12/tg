import { landingRoute, readDoor, readJoinCode } from './landingRoute';

// Pure routing decision for the Google OAuth landing, extracted so every branch
// is unit-testable without a DOM (the web project has no jsdom yet).  Returning
// null means the session is still being restored — stay on the spinner.
//
// The DESTINATION half now lives in `landingRoute` and is shared with Login,
// PublicRoute and the onboarding wizard: this path leaves the site entirely and
// comes back, so it is the one that most needed the door to be remembered
// rather than held in React state. What stays here is what is specific to
// arriving from Google — the spinner, and a landing with no session at all.
export function googleSuccessRoute(user, loading, door = readDoor(), joinCode = readJoinCode()) {
  if (loading) return null;
  // Reaching /success without a session means the cookie restore failed.
  if (!user) return '/login?error=google_failed';
  return landingRoute(user, door, joinCode);
}
