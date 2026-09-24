// The invitation email's link, `/join/{slug}` (Part 3 §9.12, §10.2). The link is not a
// key: the invitation hangs on the address, so this page only sends the person to sign
// in with it. Signed in already, they go to their invitations. On a phone the link will
// open the app once it exists.
import { Link, Navigate } from 'react-router-dom';
import { ArrowRight, Dumbbell } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { MEMBER_DOOR, rememberDoor } from './landingRoute';

export default function InvitationLink() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/invitations" replace />;
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
          Your gym invited you
        </h1>
        <p className="text-sm mb-6" style={{ color: 'rgba(255,255,255,0.65)' }}>
          Sign in with the email address your gym has for you. Your invitation will be waiting.
        </p>
        <Link
          to="/login"
          // An invitation is to the member app, whichever door this browser used last.
          onClick={() => rememberDoor(MEMBER_DOOR)}
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
