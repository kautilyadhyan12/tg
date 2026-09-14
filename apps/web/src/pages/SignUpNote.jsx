// "Before you start": the sign-up note (RULINGS 2026-09-07: one explicit tap
// at sign-up, stored with the time, the build and the words; ROADMAP 4d). Kd
// picked its own screen straight after signing in (2026-09-14) over a tick box
// on "Get started": that page is sign-in too and must never say who is new,
// "Continue with Google" leaves the site, and a tap can only be kept once the
// account exists.
//
// `ProtectedRoute` draws this IN PLACE of whatever a signed-in person asked for
// — setup or the member app, through either door; the six console routes opt
// out — until their profile says this account has ticked the note in today's
// words. The tap is kept on the server the moment it is made, so no device asks
// again; Continue only lets this tab go on to the screen it was already on its
// way to.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Dumbbell, LogOut } from 'lucide-react';
import { CURRENT_DISCLAIMER_VERSION, DISCLAIMER_WORDINGS } from '@app/shared';
import DisclaimerTick from '../components/common/DisclaimerTick';
import { useAuth } from '../context/AuthContext';
import { useDisclaimerTap } from '../hooks/useDisclaimerTap';

export default function SignUpNote() {
  const navigate = useNavigate();
  const { logout, updateUser } = useAuth();
  const tap = useDisclaimerTap('sign_up');
  const wording = DISCLAIMER_WORDINGS.sign_up[CURRENT_DISCLAIMER_VERSION.sign_up];

  // The one way past this screen without ticking, as it is out of setup: it
  // ends the session, so the gate is untouched.
  const [signingOut, setSigningOut] = useState(false);
  const handleSignOut = async () => {
    setSigningOut(true);
    await logout();
    navigate('/login');
  };

  // Offered only once the server has kept the tap (`tap.agreed`), so the flag
  // set here is never ahead of the record a reload reads back.
  const handleContinue = () => {
    if (tap.agreed) updateUser({ signUpDisclaimerAgreed: true });
  };

  const ready = tap.agreed && !signingOut;

  return (
    <div className="min-h-screen flex items-center justify-center p-8 relative" style={{ background: '#0A0908' }}>
      {/* Ambient glow, as on Get started */}
      <div
        className="absolute pointer-events-none"
        style={{
          top:        '20%',
          left:       '10%',
          width:      400,
          height:     400,
          background: 'radial-gradient(ellipse, rgba(255,138,31,0.06) 0%, transparent 70%)',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md relative z-10"
      >
        <div className="flex items-center gap-2.5 mb-10">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
              boxShadow:  '0 0 20px rgba(255,138,31,0.35)',
            }}
          >
            <Dumbbell className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight" style={{ color: 'rgba(255,255,255,0.95)' }}>
            AI Home Gym
          </span>
        </div>

        <h1 className="text-4xl font-bold tracking-tighter mb-6" style={{ color: 'rgba(255,255,255,0.95)' }}>
          Before you start
        </h1>

        <DisclaimerTick wording={wording} tap={tap} hint="Tick this to continue." large />

        <motion.button
          type="button"
          onClick={handleContinue}
          disabled={!ready}
          whileHover={ready ? { scale: 1.01 } : undefined}
          whileTap={ready ? { scale: 0.99 } : undefined}
          className="w-full py-3.5 mt-6 rounded-2xl font-semibold text-sm text-white
                     flex items-center justify-center gap-2 transition-all duration-200
                     disabled:cursor-not-allowed"
          style={{
            background: ready ? 'linear-gradient(135deg, #FF8A1F, #FFB347)' : 'rgba(255,138,31,0.25)',
            boxShadow:  ready ? '0 4px 20px rgba(255,138,31,0.35)' : 'none',
            color:      ready ? '#fff' : 'rgba(255,255,255,0.55)',
          }}
        >
          Continue
          <ArrowRight className="w-4 h-4" />
        </motion.button>

        <div className="flex justify-center mt-5">
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
          >
            <LogOut className="w-3.5 h-3.5" />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
