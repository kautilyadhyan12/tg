import { useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { landingRoute, readDoor, readJoinCode, rememberJoinCode } from '../../pages/landingRoute';

const Spinner = () => (
  <div
    className="min-h-screen flex items-center justify-center"
    style={{ background: '#0A0908' }}
  >
    <div className="flex flex-col items-center gap-4">
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{
          background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
          boxShadow:  '0 0 30px rgba(255,138,31,0.4)',
          animation:  'pulse 2s ease-in-out infinite',
        }}
      >
        <svg
          width="24" height="24" viewBox="0 0 24 24"
          fill="none" stroke="white"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M6 4v16M18 4v16M6 12h12M3 8h3M18 8h3M3 16h3M18 16h3" />
        </svg>
      </div>
      <div
        className="w-6 h-6 border-2 rounded-full animate-spin"
        style={{
          borderColor:    'rgba(255,138,31,0.2)',
          borderTopColor: '#FF8A1F',
        }}
      />
      <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.35)' }}>
        Loading...
      </p>
    </div>
  </div>
);

export const ProtectedRoute = ({ children, requireOnboarding = true }) => {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (requireOnboarding && user.onboardingCompleted === false) {
    return <Navigate to="/onboarding" replace />;
  }
  return children;
};

// A signed-in person who lands back on /login (a bookmark, the browser's back
// button) is sent on rather than shown the form again — and it goes through the
// SAME decision the login button does, so the door they chose this session is
// still honoured. Sending them to the dashboard here while the button sends them
// to the console is exactly the "works sometimes" door `landingRoute` exists to
// prevent.
export const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return children;
  return <Navigate to={landingRoute(user, readDoor(), readJoinCode())} replace />;
};

// The poster address, `/org/join?code=…`, sits behind `ProtectedRoute`, which
// sends a signed-out person to sign in and an unfinished one into setup. Both
// leave the address behind, so the code is kept on the way (ROADMAP 4b-ii-b):
// the sign-in page and setup read it on arrival. It is written in an effect,
// and React runs a render's effects before it draws the next render — here, the
// page the guard's redirect leads to. Someone already set up stays on the page,
// which reads the code from the address itself.
export const CarryJoinCode = ({ children }) => {
  const { user, loading } = useAuth();
  const [params] = useSearchParams();
  const code = params.get('code');
  const leaving = !loading && (!user || user.onboardingCompleted === false);

  useEffect(() => {
    if (leaving) rememberJoinCode(code);
  }, [leaving, code]);

  return children;
};