import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { googleSuccessRoute } from './googleSuccessRoute';

// web-repoint (Google half): the OAuth callback sets the SAME httpOnly cookies
// as password login and redirects here with NOTHING in the URL. AuthProvider's
// mount effect (getMe → adoptSession) has therefore already established the
// session by the time this renders — this page only ROUTES.
//
// The old flow is gone by design (R3.7/R3.10): no `#token` fragment, no
// localStorage, no raw `setUser`. Reading the session from context routes it
// through adoptSession, so the shared-browser queue hazard Card 2 closed stays
// closed.
export default function GoogleAuthSuccess() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    // Routing decision is a pure, unit-tested function (googleSuccessRoute).
    // null = AuthProvider is still restoring the cookie session — stay put.
    const dest = googleSuccessRoute(user, loading);
    if (dest) navigate(dest, { replace: true });
  }, [user, loading, navigate]);

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: '#0A0908' }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center gap-4"
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
            boxShadow: '0 0 40px rgba(255,138,31,0.4)',
          }}
        >
          <Check className="w-8 h-8 text-white" />
        </div>
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'rgba(255,138,31,0.7)' }} />
        <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.65)' }}>
          Signing you in with Google...
        </p>
      </motion.div>
    </div>
  );
}
