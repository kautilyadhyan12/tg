import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin, Clock, Flame, TrendingUp, Mountain, Trophy, Home, Share2, Download, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import html2canvas from 'html2canvas';
import { runningService } from '../api/runningApi';
import RouteMap from '../components/running/RouteMap';

const ACCENT = '#FF8A1F';
const EASE = [0.22, 1, 0.36, 1];

function fmtTime(min) {
  const t = Math.round(min * 60);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h > 0 ? `${h}h ` : '') + `${m}m ${s}s`;
}
function fmtPace(sec) {
  if (!sec) return '--:--';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Lightweight confetti burst (no dependency) ──────────────────────────────────
function Confetti() {
  const colors = ['#FF8A1F', '#FFB347', '#FFD66B', '#4ade80', '#60a5fa'];
  const bits = Array.from({ length: 40 });
  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {bits.map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.3;
        const dur = 1.6 + Math.random() * 1.2;
        const color = colors[i % colors.length];
        const size = 6 + Math.random() * 8;
        return (
          <motion.div key={i}
            initial={{ y: -40, x: `${left}vw`, opacity: 1, rotate: 0 }}
            animate={{ y: '110vh', rotate: 360 + Math.random() * 360, opacity: [1, 1, 0] }}
            transition={{ duration: dur, delay, ease: 'easeIn' }}
            style={{ position: 'absolute', width: size, height: size * 0.6,
                     background: color, borderRadius: 2 }} />
        );
      })}
    </div>
  );
}

function Metric({ icon: Icon, label, value, color = ACCENT }) {
  return (
    <div className="rounded-2xl p-4 text-center" style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}>
      <Icon className="w-5 h-5 mx-auto mb-2" style={{ color }} />
      <p className="text-xl font-black tabular-nums text-white">{value}</p>
      <p className="text-2xs uppercase tracking-wider mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</p>
    </div>
  );
}

export default function RunSummary() {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showConfetti, setShowConfetti] = useState(false);
  const [sharing, setSharing] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    runningService.getSummary(sessionId)
      .then(({ data }) => {
        setS(data.session);
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 2600);
      })
      .catch(() => toast.error('Could not load summary'))
      .finally(() => setLoading(false));
  }, [sessionId]);

  // Generate a shareable image from the summary card.
  const shareCard = async () => {
    if (!cardRef.current) return;
    setSharing(true);
    try {
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: '#0A0908', scale: 2, useCORS: true,
      });
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const file = new File([blob], 'my-run.png', { type: 'image/png' });

      // Use native share sheet on mobile if available (best for IG/WhatsApp).
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My run', text: 'Just finished a run! 🏃' });
      } else {
        // Desktop fallback: download the image.
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'my-run.png'; a.click();
        URL.revokeObjectURL(url);
        toast.success('Run card downloaded');
      }
    } catch {
      toast.error('Could not create share card');
    } finally { setSharing(false); }
  };

  if (loading) return <div className="p-6" style={{ color: 'rgba(255,255,255,0.4)' }}>Loading…</div>;
  if (!s) return null;

  return (
    <div className="p-5 max-w-4xl mx-auto pb-12">
      <AnimatePresence>{showConfetti && <Confetti />}</AnimatePresence>

      {/* Celebration header with img15 */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}
        className="relative overflow-hidden rounded-3xl mb-5" style={{ height: 320 }}>
        <img src="/running/run-jump.jpg" alt="" className="absolute inset-0 w-full h-full"
             style={{ objectFit: 'cover', objectPosition: 'center 25%' }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(10,9,8,0.2) 0%, rgba(10,9,8,0.3) 45%, rgba(10,9,8,0.96) 100%)' }} />
        <div className="relative z-10 h-full flex flex-col items-center justify-end pb-5">
          <motion.div initial={{ scale: 0.5, rotate: -15 }} animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 12 }}
            className="w-16 h-16 rounded-2xl mb-2 flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#FF8A1F,#FFB347)', boxShadow: '0 8px 30px rgba(255,138,31,0.6)' }}>
            <Trophy className="w-8 h-8 text-white" />
          </motion.div>
          <h1 className="text-3xl font-black tracking-tighter text-white" style={{ textShadow: '0 2px 16px rgba(0,0,0,0.6)' }}>RUN COMPLETE! 🎉</h1>
          <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.7)' }}>
            Strong finish. {new Date(s.completed_at).toLocaleDateString()}
          </p>
        </div>
      </motion.div>

      {/* Shareable card (this exact element becomes the image) */}
      <motion.div ref={cardRef} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, ease: EASE }}
        className="relative overflow-hidden rounded-3xl mb-4 p-5"
        style={{ background: 'linear-gradient(135deg, #1a1310 0%, #0f0d0b 70%)', border: '1px solid rgba(255,138,31,0.18)' }}>
        <div className="absolute -top-12 -right-12 w-52 h-52 rounded-full pointer-events-none"
             style={{ background: 'radial-gradient(circle, rgba(255,138,31,0.2), transparent 70%)' }} />
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <span className="text-2xs font-black uppercase tracking-widest" style={{ color: ACCENT }}>AI Home Gym · Run</span>
            <Flame className="w-4 h-4" style={{ color: ACCENT }} />
          </div>
          <div className="flex items-end gap-2 mb-4">
            <span className="text-6xl font-black tracking-tighter text-white tabular-nums leading-none">{s.distance_km}</span>
            <span className="text-2xl font-bold mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>km</span>
          </div>
          {s.path?.length > 1 && (
            <div className="rounded-2xl overflow-hidden mb-4" style={{ height: 200 }}>
              <RouteMap livePath={s.path} height={200} />
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            {[['Time', fmtTime(s.duration_min)], ['Pace', `${fmtPace(s.avg_pace_sec_km)}/km`], ['Calories', `${s.calories_burned}`]].map(([l, v]) => (
              <div key={l} className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <p className="text-base font-black text-white tabular-nums">{v}</p>
                <p className="text-2xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>{l}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Share button */}
      <motion.button whileTap={{ scale: 0.97 }} onClick={shareCard} disabled={sharing}
        className="w-full py-3.5 rounded-2xl font-bold text-white flex items-center justify-center gap-2 mb-4 disabled:opacity-60"
        style={{ background: 'linear-gradient(90deg,#FF8A1F,#FFB347)', boxShadow: '0 4px 18px rgba(255,138,31,0.4)' }}>
        {sharing ? <Loader2 className="w-5 h-5 animate-spin" />
          : <><Share2 className="w-5 h-5" /> Share your run</>}
      </motion.button>

      {/* Extra metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Metric icon={MapPin} label="Distance" value={`${s.distance_km} km`} />
        <Metric icon={Clock} label="Time" value={fmtTime(s.duration_min)} color="#60a5fa" />
        <Metric icon={TrendingUp} label="Avg pace" value={fmtPace(s.avg_pace_sec_km)} color="#FFD66B" />
        <Metric icon={Flame} label="Calories" value={`${s.calories_burned}`} color="#ef4444" />
      </div>

      {s.elevation_gain_m > 0 && (
        <div className="rounded-2xl p-4 mb-5 flex items-center justify-between"
             style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
            <Mountain className="w-4 h-4" /> Elevation gain
          </span>
          <span className="text-white font-bold">{s.elevation_gain_m} m</span>
        </div>
      )}

      {/* Splits */}
      {s.splits?.length > 0 && (
        <div className="rounded-2xl p-4 mb-5" style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-sm font-bold text-white mb-3">Per-km splits</p>
          <div className="space-y-2">
            {s.splits.map((sec, i) => {
              const max = Math.max(...s.splits);
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-2xs w-9" style={{ color: 'rgba(255,255,255,0.4)' }}>km {i + 1}</span>
                  <div className="flex-1 h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${(sec / max) * 100}%` }}
                      transition={{ delay: i * 0.05, ease: EASE }}
                      style={{ background: 'linear-gradient(90deg,#FF8A1F,#FFB347)' }} />
                  </div>
                  <span className="text-2xs w-12 text-right text-white tabular-nums">{fmtPace(sec)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={() => navigate('/running')}
          className="flex-1 py-3 rounded-2xl font-bold text-white" style={{ background: 'rgba(255,255,255,0.08)' }}>
          Back to Running
        </button>
        <button onClick={() => navigate('/dashboard')}
          className="flex items-center justify-center gap-2 px-5 py-3 rounded-2xl font-bold"
          style={{ background: 'rgba(255,255,255,0.08)', color: '#fff' }}>
          <Home className="w-4 h-4" /> Home
        </button>
      </div>
    </div>
  );
}
