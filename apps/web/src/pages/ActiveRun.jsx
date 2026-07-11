import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Square, Loader2, Crosshair, Minimize2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { runningService } from '../api/runningApi';
import { useRun } from '../context/RunContext';
import NavigationMap from '../components/running/NavigationMap';

const ACCENT = '#FF8A1F';
const EASE = [0.22, 1, 0.36, 1];

function fmtTime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return (h > 0 ? `${h}:` : '') + `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
function fmtPace(sec) {
  if (!sec || !isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function ActiveRun() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const run = useRun();

  const urlKm    = parseFloat(params.get('km')) || 5;
  const urlRoute = params.get('route');
  const urlSched = params.get('schedule');

  const [confirmExit, setConfirmExit] = useState(false);
  const [follow, setFollow]           = useState(true);
  const [finishing, setFinishing]     = useState(false);
  const [starting, setStarting]       = useState(false);
  const [plannedPreview, setPlannedPreview] = useState([]);

  // Load planned route polyline for preview (before start) and for the map.
  useEffect(() => {
    if (!urlRoute || run.active) return;
    runningService.getRoute(urlRoute)
      .then(({ data }) => setPlannedPreview(data.route.coords || []))
      .catch(() => {});
  }, [urlRoute, run.active]);

  const handleStart = async () => {
    setStarting(true);
    const ok = await run.startRun({
      routeId: urlRoute, scheduleId: urlSched, targetKm: urlKm, plannedPath: plannedPreview,
    });
    setStarting(false);
    if (!ok) toast.error('Could not start run');
  };

  const handleFinish = async () => {
    setFinishing(true);
    const res = await run.finishRun();
    if (res.ok) navigate(`/running/summary/${res.sessionId}`);
    else { toast.error('Could not save run'); setFinishing(false); }
  };

  // Values come from context when active, else from URL/preview before start.
  const isLive       = run.active;
  const targetKm     = isLive ? run.targetKm : urlKm;
  const plannedPath  = isLive ? run.plannedPath : plannedPreview;
  const distance     = isLive ? run.distance : 0;
  const elapsed      = isLive ? run.elapsed : 0;
  const position     = isLive ? run.position : null;
  const heading      = isLive ? run.heading : 0;
  const livePath     = isLive ? run.rawPath : [];
  const running      = run.running;
  const gpsReady     = run.gpsReady;

  // Only show pace once enough real distance is covered, so early GPS
  // jitter can't produce a nonsensical number (e.g. 68:00/km while standing).
  const pace = distance >= 0.1 ? elapsed / distance : 0;
  const progress = Math.min(100, (distance / targetKm) * 100);

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: '#0A0908' }}>
      {/* Map (z-0 stacking context so Leaflet's internal high z-index panes
          stay BELOW the control overlays above) */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <NavigationMap
          plannedPath={plannedPath}
          livePath={livePath}
          position={position}
          heading={heading}
          follow={follow}
          onUserPan={() => setFollow(false)}
        />
      </div>

      {/* Top bar */}
      <div className="relative z-10 pointer-events-none"
           style={{ background: 'linear-gradient(180deg, rgba(10,9,8,0.85) 0%, rgba(10,9,8,0) 100%)' }}>
        <div className="px-4 pt-5 pb-8 flex items-center justify-between">
          <button onClick={() => (isLive ? setConfirmExit(true) : navigate('/running'))}
                  className="pointer-events-auto px-3 py-1.5 rounded-full text-xs font-semibold"
                  style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', backdropFilter: 'blur(8px)' }}>
            {isLive ? 'Discard' : 'Back'}
          </button>

          <div className="px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5"
               style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', backdropFilter: 'blur(8px)' }}>
            <span style={{ color: ACCENT }}>●</span> {targetKm} KM GOAL
            {!gpsReady && isLive && <span style={{ color: 'rgba(255,255,255,0.5)' }}> · GPS…</span>}
          </div>

          {/* Minimize: keep run going, browse other screens */}
          {isLive ? (
            <button onClick={() => navigate('/running')}
                    className="pointer-events-auto flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold"
                    style={{ background: ACCENT, color: '#fff', backdropFilter: 'blur(8px)' }}>
              <Minimize2 className="w-3.5 h-3.5" /> Minimize
            </button>
          ) : <div style={{ width: 84 }} />}
        </div>
      </div>

      {/* Exit/discard confirmation */}
      <AnimatePresence>
        {confirmExit && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex items-center justify-center p-6"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-xs rounded-3xl p-6 text-center"
              style={{ background: '#161412', border: '1px solid rgba(255,255,255,0.1)' }}>
              <p className="text-lg font-bold text-white mb-1">Discard this run?</p>
              <p className="text-sm mb-5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Your progress ({distance.toFixed(2)} km) won't be saved.
              </p>
              <div className="flex flex-col gap-2">
                <button onClick={() => { run.discardRun(); navigate('/running'); }}
                        className="w-full py-3 rounded-xl font-bold text-white" style={{ background: '#ef4444' }}>
                  Discard & exit
                </button>
                <button onClick={() => setConfirmExit(false)}
                        className="w-full py-3 rounded-xl font-bold text-white" style={{ background: 'rgba(255,255,255,0.1)' }}>
                  Keep running
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Re-center */}
      <AnimatePresence>
        {!follow && (
          <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => setFollow(true)}
            className="absolute z-20 right-4 bottom-72 flex items-center gap-2 px-4 py-2.5 rounded-full font-semibold text-sm"
            style={{ background: ACCENT, color: '#fff', boxShadow: '0 4px 16px rgba(255,138,31,0.5)' }}>
            <Crosshair className="w-4 h-4" /> Re-center
          </motion.button>
        )}
      </AnimatePresence>

      {/* Bottom panel */}
      <div className="relative z-10 mt-auto rounded-t-3xl px-5 pt-5 pb-7"
           style={{ background: 'rgba(13,12,11,0.92)', backdropFilter: 'blur(20px)',
                    borderTop: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 -8px 40px rgba(0,0,0,0.5)' }}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-2xs font-bold uppercase tracking-widest" style={{ color: ACCENT }}>
            {progress >= 100 ? 'Goal smashed 🔥' : `${Math.round(progress)}% to goal`}
          </span>
          <span className="text-2xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {(targetKm - distance > 0 ? targetKm - distance : 0).toFixed(2)} km left
          </span>
        </div>
        <div className="h-2 rounded-full mb-5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <motion.div className="h-full rounded-full" animate={{ width: `${progress}%` }} transition={{ ease: EASE, duration: 0.6 }}
            style={{ background: 'linear-gradient(90deg,#FF8A1F,#FFB347)', boxShadow: '0 0 12px rgba(255,138,31,0.6)' }} />
        </div>

        <div className="grid grid-cols-3 gap-2 mb-6">
          <div className="text-center">
            <p className="text-4xl font-black tracking-tighter tabular-nums text-white">{distance.toFixed(2)}</p>
            <p className="text-2xs uppercase tracking-widest mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>Kilometers</p>
          </div>
          <div className="text-center border-x" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <p className="text-4xl font-black tracking-tighter tabular-nums text-white">{fmtTime(elapsed)}</p>
            <p className="text-2xs uppercase tracking-widest mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>Time</p>
          </div>
          <div className="text-center">
            <p className="text-4xl font-black tracking-tighter tabular-nums" style={{ color: ACCENT }}>{fmtPace(pace)}</p>
            <p className="text-2xs uppercase tracking-widest mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>Pace /km</p>
          </div>
        </div>

        {!isLive ? (
          <motion.button whileTap={{ scale: 0.96 }} onClick={handleStart} disabled={starting}
            className="w-full py-4 rounded-2xl font-black text-lg text-white flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: 'linear-gradient(90deg,#FF8A1F,#FFB347)', boxShadow: '0 4px 20px rgba(255,138,31,0.5)' }}>
            {starting ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Play className="w-5 h-5 fill-white" /> START RUN</>}
          </motion.button>
        ) : (
          <div className="flex gap-3">
            <motion.button whileTap={{ scale: 0.96 }} onClick={() => running ? run.pause() : run.resume()}
              className="flex-1 py-4 rounded-2xl font-bold text-white flex items-center justify-center gap-2"
              style={{ background: 'rgba(255,255,255,0.1)' }}>
              {running ? <><Pause className="w-5 h-5" /> Pause</> : <><Play className="w-5 h-5 fill-white" /> Resume</>}
            </motion.button>
            <motion.button whileTap={{ scale: 0.96 }} onClick={handleFinish} disabled={finishing}
              className="flex-1 py-4 rounded-2xl font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: '#ef4444', boxShadow: '0 4px 16px rgba(239,68,68,0.4)' }}>
              {finishing ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Square className="w-5 h-5 fill-white" /> Finish</>}
            </motion.button>
          </div>
        )}
      </div>
    </div>
  );
}
