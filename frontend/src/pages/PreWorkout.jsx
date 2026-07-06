import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTransition } from '../context/TransitionContext';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera, Smartphone, CheckCircle, AlertCircle,
  RefreshCw, Play, ArrowLeft, Sun,
} from 'lucide-react';
import toast from 'react-hot-toast';
import useCamera from '../hooks/useCamera';
import { workoutService } from '../api/workoutApi';
import { getItem, setItem } from '../utils/storage';

const CHECKLIST_ITEMS = [
  { key: 'camera',   icon: Camera,       label: 'Camera is working', desc: 'Camera feed is live',    auto: true,  color: '#FF8A1F' },
  { key: 'lighting', icon: Sun,          label: 'Room is well lit',  desc: 'Face a light source',    auto: false, color: '#FFD66B' },
  { key: 'distance', icon: RefreshCw,    label: '2m from camera',    desc: 'Full body in frame',     auto: false, color: '#60a5fa' },
  { key: 'fullbody', icon: CheckCircle,  label: 'Full body visible', desc: 'Head to toe in frame',   auto: false, color: '#4ade80' },
];

const TIPS = [
  { emoji: '📏', text: 'Stand 2–2.5 metres from camera' },
  { emoji: '📐', text: 'Camera at chest/waist height'   },
  { emoji: '🔄', text: 'Phone in landscape mode'         },
  { emoji: '💡', text: 'Face a light source'             },
  { emoji: '👕', text: 'Wear fitted clothes'             },
  { emoji: '🧹', text: 'Clear space behind you'          },
];

export default function PreWorkout() {
  const navigate    = useNavigate();
  const { triggerTransition } = useTransition();
  const builderData = getItem('workout_builder', []);

  const [selectedCam, setSelectedCam] = useState(null);
  const [checklist,   setChecklist]   = useState({
    camera: false, lighting: false, distance: false, fullbody: false,
  });
  const [starting, setStarting] = useState(false);

  const {
    videoRef, error: cameraError, ready: cameraReady,
    deviceLabel, availableCams,
    startCamera, stopCamera, switchCamera, getAvailableCameras,
  } = useCamera();

  useEffect(() => {
    if (builderData.length === 0) {
      navigate('/exercises');
      return;
    }
    getAvailableCameras().then((cams) => {
      const droid     = cams.find((c) =>
        c.label.toLowerCase().includes('droidcam') ||
        c.label.toLowerCase().includes('obs')
      );
      const preferred = droid || cams[0];
      if (preferred) {
        setSelectedCam(preferred.deviceId);
        startCamera(preferred.deviceId).then((stream) => {
          if (stream) setChecklist((p) => ({ ...p, camera: true }));
        });
      }
    });
    return () => stopCamera();
  }, []);

  const handleCameraSwitch = async (deviceId) => {
    setSelectedCam(deviceId);
    setChecklist((p) => ({ ...p, camera: false, fullbody: false }));
    const stream = await switchCamera(deviceId);
    if (stream) setChecklist((p) => ({ ...p, camera: true }));
  };

  const toggleCheck = (key) =>
    setChecklist((p) => ({ ...p, [key]: !p[key] }));

  const allChecked = Object.values(checklist).every(Boolean);
  const doneCount  = Object.values(checklist).filter(Boolean).length;

  const handleStart = async () => {
    if (!allChecked) {
      toast.error('Complete all checklist items first');
      return;
    }
    setStarting(true);
    try {
      const res = await workoutService.createSession({
        exercises: builderData,
        name:      'My Workout',
      });
      setItem('active_session', {
        sessionId:      res.data.session.id,
        exercises:      builderData,
        name:           'My Workout',
        cameraDeviceId: selectedCam,
      });
      stopCamera();
      triggerTransition(() => navigate('/workout/active'));
    } catch (err) {
      toast.error('Failed to start workout');
      console.error(err);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: '#0A0908' }}>

      {/* Background */}
      <div className="fixed inset-0 pointer-events-none">
        <img
          src="/images/wellness/regularexercise.jpg"
          alt=""
          className="w-full h-full object-cover"
          style={{ objectPosition: 'center 20%' }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(135deg, rgba(10,9,8,0.97) 0%, rgba(10,9,8,0.85) 50%, rgba(10,9,8,0.75) 100%)',
          }}
        />
      </div>

      <div className="relative z-10 min-h-screen flex flex-col">

        {/* Header */}
        <div
          className="flex items-center gap-4 px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
        >
          <button onClick={() => navigate('/workout/builder')} className="btn-icon">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest"
               style={{ color: '#FF8A1F' }}>
              Camera Setup
            </p>
            <h1 className="text-xl font-bold tracking-tight"
                style={{ color: 'rgba(255,255,255,0.95)' }}>
              Set up before you train
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm font-bold tabular-nums"
                  style={{ color: '#FF8A1F' }}>
              {doneCount}/4
            </span>
            <div
              className="w-24 h-1.5 rounded-full overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.08)' }}
            >
              <motion.div
                animate={{ width: `${(doneCount / 4) * 100}%` }}
                transition={{ duration: 0.4 }}
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #FF8A1F, #FFB347)' }}
              />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">

          {/* Left: Camera */}
          <div className="space-y-4">
            <div
              className="relative overflow-hidden rounded-3xl"
              style={{
                aspectRatio: '16/10',
                background:  '#0D0C0B',
                border:      '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <video
                ref={videoRef}
                autoPlay playsInline muted
                className="w-full h-full object-cover"
              />

              {cameraReady && (
                <>
                  <div
                    className="absolute top-4 left-4 flex items-center gap-1.5
                               px-3 py-1.5 rounded-full text-xs font-bold"
                    style={{
                      background:    'rgba(10,9,8,0.75)',
                      backdropFilter:'blur(12px)',
                      border:        '1px solid rgba(34,197,94,0.25)',
                      color:         '#4ade80',
                    }}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: '#4ade80', boxShadow: '0 0 6px #4ade80' }}
                    />
                    LIVE
                  </div>
                  <div
                    className="absolute bottom-4 left-4 px-3 py-1.5
                               rounded-xl text-xs font-medium"
                    style={{
                      background:    'rgba(10,9,8,0.75)',
                      backdropFilter:'blur(12px)',
                      color:         'rgba(255,255,255,0.70)',
                    }}
                  >
                    {deviceLabel}
                  </div>
                </>
              )}

              {cameraError && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center p-6">
                    <AlertCircle className="w-10 h-10 mx-auto mb-3"
                                 style={{ color: '#f87171' }} />
                    <p className="text-white font-semibold mb-1 text-sm">
                      Camera Error
                    </p>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
                      {cameraError}
                    </p>
                  </div>
                </div>
              )}

              {!cameraReady && !cameraError && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div
                      className="w-10 h-10 border-2 rounded-full animate-spin mx-auto mb-3"
                      style={{
                        borderColor:    'rgba(255,138,31,0.2)',
                        borderTopColor: '#FF8A1F',
                      }}
                    />
                    <p className="text-sm" style={{ color: 'rgba(255,255,255,0.40)' }}>
                      Starting camera...
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Camera selector */}
            {availableCams.length > 1 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wider mb-2"
                   style={{ color: 'rgba(255,255,255,0.30)' }}>
                  Select Camera
                </p>
                <div className="space-y-2">
                  {availableCams.map((cam) => {
                    const isDroid    = cam.label.toLowerCase().includes('droidcam')
                                    || cam.label.toLowerCase().includes('obs');
                    const isSelected = selectedCam === cam.deviceId;
                    return (
                      <button
                        key={cam.deviceId}
                        onClick={() => handleCameraSwitch(cam.deviceId)}
                        className="w-full flex items-center gap-3 p-3
                                   rounded-2xl transition-all duration-200 text-left"
                        style={{
                          background: isSelected ? 'rgba(255,138,31,0.08)' : 'rgba(255,255,255,0.03)',
                          border:     isSelected ? '1px solid rgba(255,138,31,0.25)' : '1px solid rgba(255,255,255,0.06)',
                        }}
                      >
                        {isDroid
                          ? <Smartphone className="w-4 h-4 flex-shrink-0" style={{ color: '#4ade80' }} />
                          : <Camera    className="w-4 h-4 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.40)' }} />
                        }
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate"
                             style={{ color: isSelected ? 'rgba(255,255,255,0.90)' : 'rgba(255,255,255,0.60)' }}>
                            {cam.label || `Camera ${cam.deviceId.slice(0, 8)}`}
                          </p>
                          {isDroid && (
                            <p className="text-2xs" style={{ color: '#4ade80' }}>
                              Recommended — phone camera
                            </p>
                          )}
                        </div>
                        {isSelected && (
                          <div
                            className="w-5 h-5 rounded-full flex items-center
                                       justify-center flex-shrink-0"
                            style={{ background: 'rgba(255,138,31,0.2)' }}
                          >
                            <CheckCircle className="w-3 h-3" style={{ color: '#FF8A1F' }} />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tips */}
            <div
              className="rounded-2xl p-4"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border:     '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <p className="text-xs font-semibold uppercase tracking-wider mb-3"
                 style={{ color: 'rgba(255,255,255,0.30)' }}>
                Positioning Guide
              </p>
              <div className="grid grid-cols-2 gap-2">
                {TIPS.map(({ emoji, text }) => (
                  <div key={text} className="flex items-center gap-2">
                    <span className="text-sm">{emoji}</span>
                    <span className="text-xs" style={{ color: 'rgba(255,255,255,0.50)' }}>
                      {text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Checklist */}
          <div className="flex flex-col gap-4">

            {/* DroidCam tip */}
            <div
              className="rounded-2xl p-4"
              style={{
                background: 'linear-gradient(135deg, rgba(96,165,250,0.06) 0%, rgba(96,165,250,0.02) 100%)',
                border:     '1px solid rgba(96,165,250,0.12)',
              }}
            >
              <div className="flex items-start gap-3">
                <Smartphone className="w-5 h-5 flex-shrink-0 mt-0.5"
                            style={{ color: '#60a5fa' }} />
                <div>
                  <p className="text-sm font-semibold mb-1"
                     style={{ color: 'rgba(255,255,255,0.90)' }}>
                    Use your phone for best results
                  </p>
                  <p className="text-xs leading-relaxed"
                     style={{ color: 'rgba(255,255,255,0.45)' }}>
                    Install any phone webcam app (DroidCam, Iriun, EpocCam).
                    Position 2m back in landscape mode for full body capture.
                  </p>
                </div>
              </div>
            </div>

            {/* Checklist items */}
            <div
              className="rounded-2xl p-4 flex-1"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border:     '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <p className="text-xs font-semibold uppercase tracking-wider mb-4"
                 style={{ color: 'rgba(255,255,255,0.30)' }}>
                Pre-Workout Checklist
              </p>
              <div className="space-y-2">
                {CHECKLIST_ITEMS.map(({ key, icon: Icon, label, desc, auto, color }) => {
                  const done = checklist[key];
                  return (
                    <motion.button
                      key={key}
                      onClick={() => !auto && toggleCheck(key)}
                      disabled={auto}
                      whileTap={auto ? {} : { scale: 0.98 }}
                      className="w-full flex items-center gap-3 p-4
                                 rounded-2xl transition-all duration-200 text-left"
                      style={{
                        background: done ? `${color}0D` : 'rgba(255,255,255,0.03)',
                        border:     done ? `1px solid ${color}25` : '1px solid rgba(255,255,255,0.06)',
                        cursor:     auto ? 'default' : 'pointer',
                      }}
                    >
                      <div
                        className="w-9 h-9 rounded-xl flex items-center
                                   justify-center flex-shrink-0 transition-all"
                        style={{
                          background: done ? `${color}18` : 'rgba(255,255,255,0.05)',
                          border:     done ? `1px solid ${color}30` : '1px solid rgba(255,255,255,0.08)',
                        }}
                      >
                        <Icon className="w-4 h-4"
                              style={{ color: done ? color : 'rgba(255,255,255,0.30)' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium"
                           style={{ color: done ? 'rgba(255,255,255,0.90)' : 'rgba(255,255,255,0.55)' }}>
                          {label}
                        </p>
                        <p className="text-2xs mt-0.5"
                           style={{ color: 'rgba(255,255,255,0.30)' }}>
                          {desc}
                        </p>
                      </div>
                      <AnimatePresence>
                        {done ? (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                            className="w-6 h-6 rounded-full flex items-center
                                       justify-center flex-shrink-0"
                            style={{ background: color }}
                          >
                            <CheckCircle className="w-3.5 h-3.5 text-white" />
                          </motion.div>
                        ) : (
                          <div
                            className="w-6 h-6 rounded-full border-2 flex-shrink-0"
                            style={{ borderColor: 'rgba(255,255,255,0.15)' }}
                          />
                        )}
                      </AnimatePresence>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Start button */}
            <motion.button
              onClick={handleStart}
              disabled={!allChecked || starting}
              whileHover={allChecked ? { scale: 1.01 } : {}}
              whileTap={allChecked ? { scale: 0.99 } : {}}
              className="w-full py-4 rounded-2xl font-bold text-base
                         flex items-center justify-center gap-3
                         transition-all duration-300"
              style={{
                background: allChecked
                  ? 'linear-gradient(135deg, #FF8A1F, #FFB347)'
                  : 'rgba(255,255,255,0.04)',
                color:     allChecked ? '#fff' : 'rgba(255,255,255,0.25)',
                border:    allChecked ? 'none' : '1px solid rgba(255,255,255,0.06)',
                boxShadow: allChecked ? '0 8px 32px rgba(255,138,31,0.35)' : 'none',
                cursor:    allChecked ? 'pointer' : 'not-allowed',
              }}
            >
              {starting ? (
                <div className="w-5 h-5 border-2 border-white
                               border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  {allChecked ? 'Start Workout' : `Complete checklist (${doneCount}/4)`}
                </>
              )}
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}