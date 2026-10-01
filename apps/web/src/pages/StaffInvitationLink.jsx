// A staff invitation email's link, `/staff-invitation` (Part 3 §10.3; ROADMAP 4a-i). The
// link is not a key: the invitation hangs on the address, so this page only sends the
// person to sign in with it through the Manage door. Signed in already, they go to the
// console's front page, where the invitation is waiting.
import { Link, Navigate } from 'react-router-dom';
import { ArrowRight, Dumbbell } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { GYM_DOOR, rememberDoor } from './landingRoute';

export default function StaffInvitationLink() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/console" replace />;
  return (
    <div className="min-h-screen flex items-center justify-center p-6 sm:p-8" style={{ background: '#0A0908' }}>
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2.5 mb-8">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #FF8A1F, #FFB347)', boxShadow: '0 0 20px rgba(255,138,31,0.35)' }}
          >
            <Dumbbell className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight" style={{ color: 'rgba(255,255,255,0.95)' }}>
            AI Home Gym
          </span>
        </div>
        <h1 className="text-3xl font-bold tracking-tighter mb-3" style={{ color: 'rgba(255,255,255,0.95)' }}>
          You&apos;re invited to help run a gym
        </h1>
        <p className="text-sm mb-6" style={{ color: 'rgba(255,255,255,0.65)' }}>
          Sign in with the email address the invitation was sent to. Your invitation will be waiting.
        </p>
        <Link
          to="/login"
          // A staff invitation opens the console, whichever door this browser used last.
          onClick={() => rememberDoor(GYM_DOOR)}
          className="w-full py-3.5 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg, #FF8A1F, #FFB347)', color: '#fff', minHeight: 44 }}
        >
          Sign in
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
