// A staff invitation email's link, `/staff-invitation` (Part 3 §10.3; ROADMAP 4a-i). The
// link is not a key: the invitation hangs on the address, so this page only sends the
// person to sign in with it through the Manage door. Signed in already, they go to the
// console's front page, where the invitation is waiting. Drawn in the console's third look
// (V5-d, board `StaffInvite`).
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ArrowRight, Dumbbell, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { GYM_DOOR, rememberDoor } from './landingRoute';
import { consoleLook } from './console/consoleMenu';

export default function StaffInvitationLink() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (user) return <Navigate to="/console" replace />;
  return (
    <div className={`c-console t-${consoleLook(location.search, import.meta.env.DEV)} c-door-page`}>
      <div className="c-door-side">
        <div className="c-door-col c-stack-m">
          <div className="c-door-brand">
            <span className="c-gymicon" aria-hidden="true">
              <Dumbbell size={18} />
            </span>
            <span className="c-s16 c-w7 c-t1">KWAZO</span>
          </div>
          <div className="c-card c-stack-m c-door-card">
            <span className="c-invite-ic" aria-hidden="true">
              <UserPlus size={22} />
            </span>
            <div className="c-stack-xs">
              <h1 className="c-h1">You&apos;re invited to help run a gym or studio</h1>
              <p className="c-sub">Sign in with the email address the invitation was sent to. Your invitation will be waiting.</p>
            </div>
            <Link
              to="/login"
              // A staff invitation opens the console, whichever door this browser used last.
              onClick={() => rememberDoor(GYM_DOOR)}
              className="c-btn c-btn-lg c-btn-p c-door-wide"
            >
              Sign in
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
