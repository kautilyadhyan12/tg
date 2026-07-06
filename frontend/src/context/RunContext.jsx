import { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { runningService } from '../api/runningApi';

/*
 * RunContext — holds the ACTIVE run globally so it keeps tracking while the
 * user navigates to other pages (Spotify-style). The geolocation watch and
 * the timer live here, in a provider that wraps the whole app, so they are
 * NOT torn down when the run screen unmounts.
 *
 * Honest limit: this keeps a run alive across in-app navigation with the
 * screen on. It does NOT defeat the OS suspending GPS when the phone is
 * locked or the browser is fully backgrounded — that needs a native wrapper
 * (Capacitor) later.
 */

const RunContext = createContext(null);
export const useRun = () => useContext(RunContext);

// ── geo helpers ───────────────────────────────────────────────────────────────
function distKm(a, b) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180, la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const la1 = (a[0] * Math.PI) / 180, la2 = (b[0] * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function RunProvider({ children }) {
  const [active, setActive]       = useState(false);   // a run exists (running or paused)
  const [running, setRunning]     = useState(false);   // actively timing (not paused)
  const [sessionId, setSessionId] = useState(null);
  const [targetKm, setTargetKm]   = useState(5);
  const [routeId, setRouteId]     = useState(null);
  const [scheduleId, setScheduleId] = useState(null);
  const [plannedPath, setPlannedPath] = useState([]);
  const [elapsed, setElapsed]     = useState(0);
  const [distance, setDistance]   = useState(0);
  const [rawPath, setRawPath]     = useState([]);
  const [position, setPosition]   = useState(null);
  const [heading, setHeading]     = useState(0);
  const [gpsReady, setGpsReady]   = useState(false);

  const watchId    = useRef(null);
  const timerRef   = useRef(null);
  const lastPt     = useRef(null);
  const splits     = useRef([]);
  const splitMark  = useRef(0);
  const splitStart = useRef(0);

  // Timer ticks while running.
  useEffect(() => {
    if (running) timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    else clearInterval(timerRef.current);
    return () => clearInterval(timerRef.current);
  }, [running]);

  // Per-km splits.
  useEffect(() => {
    if (distance - splitMark.current >= 1) {
      splits.current.push(elapsed - splitStart.current);
      splitStart.current = elapsed;
      splitMark.current += 1;
    }
  }, [distance, elapsed]);

  const beginWatch = useCallback(() => {
    if (!navigator.geolocation || watchId.current != null) return;
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        // Reject low-accuracy fixes (desktop Wi-Fi drift, weak phone signal).
        // accuracy is the radius of uncertainty in metres; >50m is unreliable
        // for distance accumulation, so we mark GPS "searching" and skip it.
        const acc = pos.coords.accuracy;
        if (acc != null && acc > 50) {
          setGpsReady(false);
          return;
        }
        setGpsReady(true);
        const pt = [pos.coords.latitude, pos.coords.longitude];
        if (pos.coords.heading != null && !Number.isNaN(pos.coords.heading)) {
          setHeading(pos.coords.heading);
        } else if (lastPt.current && distKm(lastPt.current, pt) > 0.003) {
          setHeading(bearing(lastPt.current, pt));
        }
        setPosition(pt);
        setRawPath((prev) => {
          if (lastPt.current) {
            const d = distKm(lastPt.current, pt);
            // Lower bound filters jitter; upper bound filters GPS jumps.
            if (d > 0.0025 && d < 0.5) setDistance((dist) => dist + d);
          }
          lastPt.current = pt;
          return [...prev, pt];
        });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 8000 }
    );
  }, []);

  const stopWatch = useCallback(() => {
    if (watchId.current != null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopWatch();
    clearInterval(timerRef.current);
    lastPt.current = null; splits.current = []; splitMark.current = 0; splitStart.current = 0;
    setActive(false); setRunning(false); setSessionId(null);
    setElapsed(0); setDistance(0); setRawPath([]); setPosition(null);
    setHeading(0); setGpsReady(false); setPlannedPath([]);
    setRouteId(null); setScheduleId(null);
  }, [stopWatch]);

  // Start a brand-new run.
  const startRun = useCallback(async ({ routeId: rid, scheduleId: sid, targetKm: km, plannedPath: pp }) => {
    try {
      const { data } = await runningService.startSession({
        route_id: rid || null, schedule_id: sid || null, target_km: km || 5,
      });
      // fresh state
      lastPt.current = null; splits.current = []; splitMark.current = 0; splitStart.current = 0;
      setElapsed(0); setDistance(0); setRawPath([]); setPosition(null); setGpsReady(false);
      setSessionId(data.session_id);
      setTargetKm(km || 5);
      setRouteId(rid || null);
      setScheduleId(sid || null);
      setPlannedPath(pp || []);
      setActive(true);
      setRunning(true);
      beginWatch();
      return true;
    } catch {
      return false;
    }
  }, [beginWatch]);

  const pause  = useCallback(() => setRunning(false), []);
  const resume = useCallback(() => setRunning(true), []);

  // Finish: snap path, complete session, clear state. Returns sessionId.
  const finishRun = useCallback(async () => {
    setRunning(false);
    stopWatch();
    const sid = sessionId;
    const dist = distance, el = elapsed, path = rawPath, sp = splits.current;

    let finalPath = path;
    try {
      if (path.length >= 5) {
        const { data } = await runningService.matchPath(path);
        if (data?.matched?.length) finalPath = data.matched;
      }
    } catch (_) { /* keep raw */ }

    try {
      const res = await runningService.completeSession(sid, {
        distance_km: dist, duration_min: el / 60, path: finalPath, splits: sp,
      });
      reset();
      return { ok: true, sessionId: sid, result: res.data };
    } catch {
      return { ok: false, sessionId: sid };
    }
  }, [sessionId, distance, elapsed, rawPath, stopWatch, reset]);

  const discardRun = useCallback(() => { reset(); }, [reset]);

  const value = {
    active, running, sessionId, targetKm, routeId, scheduleId, plannedPath,
    elapsed, distance, rawPath, position, heading, gpsReady,
    startRun, pause, resume, finishRun, discardRun,
  };
  return <RunContext.Provider value={value}>{children}</RunContext.Provider>;
}
