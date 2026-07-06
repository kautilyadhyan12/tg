import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Footprints, ChevronUp } from 'lucide-react';
import { useRun } from '../../context/RunContext';

/*
 * RunMiniBar — floating "run in progress" bar (like Spotify's now-playing).
 * Renders on every page when a run is active, EXCEPT the full run screen
 * itself. Tap it to return to the live run.
 */

const ACCENT = '#FF8A1F';

function fmtTime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return (h > 0 ? `${h}:` : '') + `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
function fmtPace(sec) {
  if (!sec || !isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function RunMiniBar() {
  const run = useRun();
  const navigate = useNavigate();
  const location = useLocation();

  // Don't show on the full run screen (you're already there).
  const onRunScreen = location.pathname.startsWith('/running/active');
  const show = run?.active && !onRunScreen;
  const pace = run && run.distance >= 0.1 ? run.elapsed / run.distance : 0;

  return (
    <AnimatePresence>
      {show && (
        <motion.button
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 90, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          onClick={() => navigate('/running/active')}
          className="fixed left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 px-4 py-3 rounded-2xl"
          style={{
            bottom: 20, width: 'min(92vw, 420px)',
            background: 'rgba(20,18,16,0.92)', backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,138,31,0.3)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}>
          {/* Pulsing record dot + icon */}
          <div className="relative flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0"
               style={{ background: 'linear-gradient(135deg,#FF8A1F,#FFB347)' }}>
            <Footprints className="w-4 h-4 text-white" />
            {run?.running && (
              <motion.span
                className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
                style={{ background: '#ef4444', border: '2px solid #141210' }}
                animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
                transition={{ repeat: Infinity, duration: 1.4 }} />
            )}
          </div>

          {/* Live stats */}
          <div className="flex-1 text-left min-w-0">
            <p className="text-2xs font-bold uppercase tracking-widest" style={{ color: ACCENT }}>
              {run?.running ? 'Run in progress' : 'Run paused'}
            </p>
            <p className="text-sm font-bold text-white tabular-nums truncate">
              {run?.distance?.toFixed(2)} km · {fmtTime(run?.elapsed || 0)} · {fmtPace(pace)}/km
            </p>
          </div>

          <ChevronUp className="w-5 h-5 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.5)' }} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
