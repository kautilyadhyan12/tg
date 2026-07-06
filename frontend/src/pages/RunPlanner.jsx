import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  MapPin, Navigation, Loader2, ArrowLeft,
  CalendarPlus, Play, CloudRain, Info,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { runningService } from '../api/runningApi';
import RouteMap from '../components/running/RouteMap';
import LocationAutocomplete from '../components/running/LocationAutocomplete';

const ACCENT = '#FF8A1F';
const EASE = [0.22, 1, 0.36, 1];
const DISTANCES = [3, 5, 10, 15, 21.1];

export default function RunPlanner() {
  const navigate = useNavigate();
  const [loc, setLoc]             = useState(null);     // {lat,lng}
  const [locating, setLocating]   = useState(false);
  const [targetKm, setTargetKm]   = useState(5);
  const [whenIso, setWhenIso]     = useState('');
  const [routes, setRoutes]       = useState([]);
  const [weather, setWeather]     = useState(null);
  const [mode, setMode]           = useState(null);
  const [notice, setNotice]       = useState(null);
  const [selected, setSelected]   = useState(0);
  const [loading, setLoading]     = useState(false);
  const [scheduling, setScheduling] = useState(false);

  // Manual location fallback — for when browser/OS geolocation is blocked,
  // unavailable, or just slow/inaccurate on a desktop without GPS.
  const [showManual, setShowManual] = useState(false);
  const [manualLat, setManualLat]   = useState('');
  const [manualLng, setManualLng]   = useState('');

  const getLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported on this device');
      setShowManual(true);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
        toast.success('Location found');
      },
      () => {
        setLocating(false);
        toast.error('Could not get location — try entering it manually below');
        setShowManual(true);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const useManualCoords = () => {
    const lat = parseFloat(manualLat);
    const lng = parseFloat(manualLng);
    if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      toast.error('Enter valid coordinates (lat -90..90, lng -180..180)');
      return;
    }
    setLoc({ lat, lng });
    toast.success('Location set');
  };

  const generate = async () => {
    if (!loc) { toast.error('Set your location first'); return; }
    setLoading(true);
    try {
      const { data } = await runningService.generateRoutes({
        lat: loc.lat, lng: loc.lng, target_km: targetKm,
        scheduled_iso: whenIso || null, count: 3,
      });
      setRoutes(data.routes || []);
      setWeather(data.weather || null);
      setMode(data.mode);
      setNotice(data.notice);
      setSelected(0);
      if (!data.routes?.length) toast.error('No routes found here');
    } catch {
      toast.error('Could not generate routes');
    } finally {
      setLoading(false);
    }
  };

  const startNow = async () => {
    const route = routes[selected];
    try {
      const { data } = await runningService.saveRoute(route);
      navigate(`/running/active?route=${data.route_id}&km=${targetKm}`);
    } catch {
      toast.error('Could not start run');
    }
  };

  const schedule = async () => {
    if (!whenIso) { toast.error('Pick a date and time'); return; }
    setScheduling(true);
    try {
      let routeId = null;
      const route = routes[selected];
      if (route) {
        const saved = await runningService.saveRoute(route);
        routeId = saved.data.route_id;
      }
      await runningService.createSchedule({
        scheduled_iso: whenIso, target_km: targetKm,
        route_id: routeId, recurrence: 'none',
        lat: loc.lat, lng: loc.lng,
      });
      toast.success('Run scheduled');
      navigate('/running');
    } catch {
      toast.error('Could not schedule');
    } finally {
      setScheduling(false);
    }
  };

  const sel = routes[selected];

  return (
    <div className="max-w-3xl mx-auto pb-10">
      {/* Hero banner (img14) */}
      <div className="relative overflow-hidden mb-6" style={{ height: 280 }}>
        <img src="/running/run-women.jpg" alt="" className="absolute inset-0 w-full h-full"
             style={{ objectFit: 'cover', objectPosition: 'center 30%' }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(10,9,8,0.45) 0%, rgba(10,9,8,0.15) 35%, rgba(10,9,8,0.5) 65%, rgba(10,9,8,0.96) 100%)' }} />
        <div className="relative z-10 h-full flex flex-col justify-between p-5">
          <button onClick={() => navigate('/running')}
                  className="self-start flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
                  style={{ background: 'rgba(0,0,0,0.45)', color: '#fff', backdropFilter: 'blur(8px)' }}>
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div>
            <h1 className="text-4xl font-black tracking-tighter text-white leading-none mb-1"
                style={{ textShadow: '0 2px 16px rgba(0,0,0,0.5)' }}>PLAN A RUN</h1>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
              We'll find and score routes around you.
            </p>
          </div>
        </div>
      </div>

      <div className="px-6">
      {/* Location */}
      <div className="rounded-2xl p-4 mb-4"
           style={{ background: '#161412', border: '1px solid rgba(255,255,255,0.06)' }}>
        <label className="text-sm text-white font-semibold mb-2 block">Starting point</label>
        <button onClick={getLocation}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
                style={{
                  background: loc ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.05)',
                  color: loc ? '#4ade80' : '#fff',
                }}>
          {locating
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Locating…</>
            : loc
              ? <><MapPin className="w-4 h-4" /> {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}</>
              : <><Navigation className="w-4 h-4" /> Use my current location</>}
        </button>

        <button onClick={() => setShowManual((v) => !v)}
                className="w-full text-center text-xs mt-2 py-1"
                style={{ color: 'rgba(255,255,255,0.4)' }}>
          {showManual ? 'Hide manual entry' : "GPS not working? Enter location manually"}
        </button>

        {showManual && (
          <div className="mt-3 pt-3 space-y-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            {/* Type-ahead place search (LocationIQ, with OSM fallback) */}
            <div>
              <label className="text-xs mb-1.5 block" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Search a place
              </label>
              <LocationAutocomplete
                onSelect={({ lat, lng, label }) => {
                  setLoc({ lat, lng });
                  toast.success(label.split(',').slice(0, 2).join(','));
                }}
              />
            </div>

            {/* Raw lat/lng entry */}
            <div>
              <label className="text-xs mb-1.5 block" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Or enter coordinates directly
              </label>
              <div className="flex gap-2">
                <input
                  type="number" step="any" placeholder="Latitude"
                  value={manualLat} onChange={(e) => setManualLat(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl text-sm"
                  style={{ background: 'rgba(255,255,255,0.05)', color: '#fff',
                           border: '1px solid rgba(255,255,255,0.08)' }}
                />
                <input
                  type="number" step="any" placeholder="Longitude"
                  value={manualLng} onChange={(e) => setManualLng(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl text-sm"
                  style={{ background: 'rgba(255,255,255,0.05)', color: '#fff',
                           border: '1px solid rgba(255,255,255,0.08)' }}
                />
                <button onClick={useManualCoords}
                        className="px-4 py-2 rounded-xl text-sm font-semibold"
                        style={{ background: 'rgba(255,255,255,0.08)', color: '#fff' }}>
                  Set
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Distance */}
      <div className="rounded-2xl p-4 mb-4"
           style={{ background: '#161412', border: '1px solid rgba(255,255,255,0.06)' }}>
        <label className="text-sm text-white font-semibold mb-2 block">Target distance</label>
        <div className="flex flex-wrap gap-2">
          {DISTANCES.map((d) => (
            <button key={d} onClick={() => setTargetKm(d)}
                    className="px-4 py-2 rounded-xl text-sm font-semibold"
                    style={{
                      background: targetKm === d ? ACCENT : 'rgba(255,255,255,0.05)',
                      color: '#fff',
                    }}>
              {d === 21.1 ? 'Half' : `${d}K`}
            </button>
          ))}
        </div>
      </div>

      {/* When (optional) */}
      <div className="rounded-2xl p-4 mb-4"
           style={{ background: '#161412', border: '1px solid rgba(255,255,255,0.06)' }}>
        <label className="text-sm text-white font-semibold mb-2 block">
          When? <span style={{ color: 'rgba(255,255,255,0.3)' }}>(optional — improves traffic & weather check)</span>
        </label>
        <input type="datetime-local" value={whenIso}
               onChange={(e) => setWhenIso(e.target.value)}
               className="w-full px-3 py-2.5 rounded-xl text-sm"
               style={{ background: 'rgba(255,255,255,0.05)', color: '#fff',
                        border: '1px solid rgba(255,255,255,0.08)' }} />
      </div>

      <motion.button whileTap={{ scale: 0.97 }} onClick={generate}
                     disabled={loading || !loc}
                     className="w-full py-3.5 rounded-xl font-semibold text-white mb-6 disabled:opacity-40"
                     style={{ background: ACCENT }}>
        {loading
          ? <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Finding routes…</span>
          : 'Find routes'}
      </motion.button>

      {/* Notice / weather */}
      {notice && (
        <div className="rounded-xl p-3 mb-4 flex gap-2 text-xs"
             style={{ background: 'rgba(255,214,107,0.08)', color: '#FFD66B' }}>
          <Info className="w-4 h-4 flex-shrink-0" /> {notice}
        </div>
      )}
      {weather && weather.risk !== 'none' && weather.risk !== 'unknown' && (
        <div className="rounded-xl p-3 mb-4 flex gap-2 text-xs"
             style={{ background: 'rgba(255,138,31,0.08)', color: '#FF8A1F' }}>
          <CloudRain className="w-4 h-4 flex-shrink-0" />
          {weather.summary} {weather.flags?.length ? `(${weather.flags.join(', ')})` : ''}
        </div>
      )}

      {/* Results */}
      {sel && (
        <>
          <RouteMap plannedPath={sel.coords} height={300} />
          {mode === 'mock' && (
            <p className="text-xs mt-2 mb-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Offline preview route — real road routing activates with an ORS key.
            </p>
          )}

          <div className="space-y-3 mt-4 mb-6">
            {routes.map((r, i) => {
              const active = i === selected;
              const circ = 2 * Math.PI * 26;
              return (
                <motion.button key={i} whileTap={{ scale: 0.99 }} onClick={() => setSelected(i)}
                  className="w-full rounded-2xl p-4 text-left"
                  style={{
                    background: active ? 'linear-gradient(135deg,#1a1310,#0f0d0b)' : '#121110',
                    border: `1px solid ${active ? ACCENT : 'rgba(255,255,255,0.08)'}`,
                    boxShadow: active ? '0 4px 20px rgba(255,138,31,0.18)' : 'none',
                  }}>
                  <div className="flex items-center gap-4">
                    {/* Circular score ring */}
                    <div className="relative flex-shrink-0" style={{ width: 64, height: 64 }}>
                      <svg width="64" height="64" style={{ transform: 'rotate(-90deg)' }}>
                        <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
                        <motion.circle cx="32" cy="32" r="26" fill="none" stroke={ACCENT} strokeWidth="6"
                          strokeLinecap="round" strokeDasharray={circ}
                          initial={{ strokeDashoffset: circ }}
                          animate={{ strokeDashoffset: circ - (circ * r.score) / 100 }}
                          transition={{ duration: 1, ease: EASE }} />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-lg font-black text-white leading-none tabular-nums">{r.score}</span>
                        <span className="text-2xs" style={{ color: 'rgba(255,255,255,0.4)' }}>score</span>
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white font-bold">{r.label}</span>
                        <span className="text-2xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                          {r.distance_km} km · {r.elevation_gain_m}m ↑
                        </span>
                      </div>
                      {/* compact metric chips */}
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {[['Safe', r.score_breakdown.safety, 35, '#4ade80'],
                          ['Traffic', r.score_breakdown.traffic, 25, '#60a5fa'],
                          ['Flat', r.score_breakdown.terrain, 20, '#FFD66B'],
                          ['Scenic', r.score_breakdown.scenic, 20, '#FF8A1F']].map(([lbl, val, mx, col]) => (
                          <span key={lbl} className="text-2xs px-2 py-0.5 rounded-md font-medium"
                                style={{ background: col + '20', color: col }}>
                            {lbl} {Math.round((val / mx) * 100)}%
                          </span>
                        ))}
                      </div>
                      <p className="text-2xs leading-snug" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        {r.reasons.slice(0, 2).join(' · ')}
                      </p>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>

          <div className="flex gap-3">
            <button onClick={startNow}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-white"
                    style={{ background: ACCENT }}>
              <Play className="w-4 h-4" /> Start now
            </button>
            <button onClick={schedule} disabled={scheduling}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold disabled:opacity-40"
                    style={{ background: 'rgba(255,255,255,0.06)', color: '#fff' }}>
              <CalendarPlus className="w-4 h-4" /> Schedule
            </button>
          </div>
        </>
      )}
      </div>
    </div>
  );
}
