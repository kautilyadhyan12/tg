// "You're invited": shown straight after "Before you start" and before setup to a
// person whose address a gym has invited (Part 3 §10.2), so somebody who stops halfway
// through setup is already in their gym. `ProtectedRoute` draws it in place of the page
// the person was on their way to; Continue or Not now goes on to that page, and the
// invitations stay in Settings → Gym.
import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Dumbbell } from 'lucide-react';
import InvitationCard from '../components/gym/InvitationCard';

export default function InvitationsGate({ invitations, onDone }) {
  const [answered, setAnswered] = useState(() => new Set());
  const allAnswered = invitations.every((invitation) => answered.has(invitation.id));

  const onAnswered = ({ invitationId }) => {
    setAnswered((before) => new Set(before).add(invitationId));
  };

  return (
    <div className="min-h-screen flex justify-center p-6 sm:p-8" style={{ background: '#0A0908' }}>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md"
      >
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

        <h1 className="text-3xl font-bold tracking-tighter mb-2" style={{ color: 'rgba(255,255,255,0.95)' }}>
          {invitations.length === 1 ? "You're invited" : `You have ${String(invitations.length)} invitations`}
        </h1>
        <p className="text-sm mb-6" style={{ color: 'rgba(255,255,255,0.55)' }}>
          You can also decide later, in Settings → Gym.
        </p>

        <div className="flex flex-col gap-5">
          {invitations.map((invitation) => (
            <InvitationCard key={invitation.id} invitation={invitation} onAnswered={onAnswered} />
          ))}
        </div>

        <button
          type="button"
          onClick={onDone}
          className="w-full py-3.5 mt-6 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2"
          style={
            allAnswered
              ? { background: 'linear-gradient(135deg, #FF8A1F, #FFB347)', color: '#fff', minHeight: 44 }
              : { border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.85)', minHeight: 44 }
          }
        >
          {allAnswered ? 'Continue' : 'Not now'}
          <ArrowRight className="w-4 h-4" />
        </button>
      </motion.div>
    </div>
  );
}
