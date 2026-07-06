import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, Check, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import authApi from '../api/authApi';

export default function GoogleAuthSuccess() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const ran        = useRef(false);

  useEffect(() => {
    // React Strict Mode runs effects twice in dev — guard against it
    if (ran.current) return;
    ran.current = true;

    (async () => {
      // Parse hash fragment: #token=xxx&onboarding=true
      const hash   = window.location.hash.substring(1);
      const params = new URLSearchParams(hash);
      const token  = params.get('token');
      const onboarding = params.get('onboarding') === 'true';

      if (!token) {
        navigate('/login?error=no_token');
        return;
      }

      // Store the token
      localStorage.setItem('accessToken', token);

      // Fetch the user profile to populate AuthContext
      try {
        const res = await authApi.get('/auth/me');
        const user = res.data.user;
        if (setUser) setUser(user);

        // Clean the URL (remove the fragment)
        window.history.replaceState(null, '', '/auth/google/success');

        // Route based on onboarding status
        setTimeout(() => {
          if (onboarding) {
            navigate('/onboarding', { replace: true });
          } else {
            navigate('/dashboard', { replace: true });
          }
        }, 800);
      } catch (err) {
        console.error('Google auth completion failed:', err);
        localStorage.removeItem('accessToken');
        navigate('/login?error=profile_fetch_failed', { replace: true });
      }
    })();
  }, [navigate, setUser]);

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: '#0A0908' }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1   }}
        className="flex flex-col items-center gap-4"
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
            boxShadow:  '0 0 40px rgba(255,138,31,0.4)',
          }}
        >
          <Check className="w-8 h-8 text-white" />
        </div>
        <Loader2 className="w-5 h-5 animate-spin"
                 style={{ color: 'rgba(255,138,31,0.7)' }} />
        <p className="text-sm font-medium"
           style={{ color: 'rgba(255,255,255,0.65)' }}>
          Signing you in with Google...
        </p>
      </motion.div>
    </div>
  );
}