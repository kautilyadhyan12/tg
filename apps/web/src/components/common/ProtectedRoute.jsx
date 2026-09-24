import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { landingRoute, readDoor, readJoinCode, rememberJoinCode } from '../../pages/landingRoute';
import InvitationsGate from '../../pages/InvitationsGate';
import SignUpNote from '../../pages/SignUpNote';
import { refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import { forgetInvitations, loadInvitations, saidNotNow, sayNotNow, waitingNow } from '../gym/invitationsStore';

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

// "You're invited" (Part 3 §10.2): after "Before you start" and before setup, for a
// person with an invitation still to answer. Read once per visit; a read that fails
// lets the person on, since the invitations are also in Settings → Gym.
function InvitationsCheck({ userId, children }) {
  const settled = () => {
    if (saidNotNow(userId)) return { phase: 'done', waiting: [] };
    const known = waitingNow(userId);
    if (known === null) return { phase: 'loading', waiting: [] };
    return known.length > 0 ? { phase: 'asking', waiting: known } : { phase: 'done', waiting: [] };
  };
  const [check, setCheck] = useState(settled);

  useEffect(() => {
    if (check.phase !== 'loading') return undefined;
    let live = true;
    loadInvitations(userId).then(
      () => {
        if (live) setCheck(settled());
      },
      () => {
        if (live) setCheck({ phase: 'done', waiting: [] });
      },
    );
    return () => {
      live = false;
    };
    // `settled` reads only `userId` and the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check.phase, userId]);

  if (check.phase === 'loading') return <Spinner />;
  if (check.phase === 'asking') {
    return (
      <InvitationsGate
        invitations={check.waiting}
        onDone={() => {
          sayNotNow(userId);
          forgetInvitations();
          refreshConsoleOrgsAfterChange();
          setCheck({ phase: 'done', waiting: [] });
        }}
      />
    );
  }
  return children;
}

export const ProtectedRoute = ({ children, requireOnboarding = true, requireSignUpNote = true, requireInvitations = true }) => {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  // THE SIGN-UP NOTE COMES FIRST ON THE TRAINING SIDE (ROADMAP 4d): before
  // setup and every member screen. The console opts out, route by route, as it
  // opts out of setup: Kd, 2026-09-14, from the click-through, *"it should show
  // to someone who trains not to someone who create organisation"*, so a person
  // who runs an organisation meets it the first time they come to train. It is
  // drawn IN PLACE rather than sent to an address of its own, so the address
  // the person was on their way to (a poster's join link with its code) is
  // still there when they continue.
  //
  // `!== true`, the opposite of the setup check below, on purpose: a profile
  // read that failed shows the note to someone who has already ticked it (one
  // more tap, one more true row), where failing open would let someone who
  // never ticked it in with no record. It cannot trap anyone the way a
  // finished wizard could: ticking needs only the tap's own request.
  if (requireSignUpNote && user.signUpDisclaimerAgreed !== true) return <SignUpNote />;
  const page =
    requireOnboarding && user.onboardingCompleted === false ? <Navigate to="/onboarding" replace /> : children;
  if (!requireInvitations) return page;
  return (
    <InvitationsCheck key={user.id} userId={user.id}>
      {page}
    </InvitationsCheck>
  );
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
// the sign-in page and setup read it on arrival. This link is the newest word,
// so one with no code, or none the server could have made, leaves no code kept
// (`rememberJoinCode`). It is written in an effect, and React runs a render's
// effects before it draws the next render — here, the page the guard's redirect
// leads to. Someone already set up stays on the page, which reads the code from
// the address itself.
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