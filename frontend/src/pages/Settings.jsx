import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User, Dumbbell, Lock, Bell, Trash2, Camera,
  Save, Loader2, Check, AlertTriangle, RefreshCw,
  Shield, ChevronRight, LogOut,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useTransition } from '../context/TransitionContext';
import { userService } from '../api/userApi';
import authApi from '../api/authApi';
import mlApi from '../api/mlApi';

const TABS = [
  { id: 'profile',       label: 'Profile',       icon: User    },
  { id: 'fitness',       label: 'Fitness',       icon: Dumbbell },
  { id: 'account',       label: 'Account',       icon: Shield  },
  { id: 'notifications', label: 'Notifications', icon: Bell    },
];

const glowLabel = {
  color:      '#FF8A1F',
  textShadow: '0 0 12px rgba(255,138,31,0.70), 0 0 24px rgba(255,138,31,0.40)',
  fontWeight: 600,
};

const inputStyle = {
  background: 'rgba(10,9,8,0.85)',
  border:     '1.5px solid rgba(255,138,31,0.30)',
  color:      '#fff',
  boxShadow:  '0 0 10px rgba(255,138,31,0.08)',
};

function SaveBtn({ loading, saved }) {
  return (
    <button
      type="submit" disabled={loading}
      className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm text-white transition-all"
      style={{
        background: saved ? 'linear-gradient(135deg, #22c55e, #4ade80)' : 'linear-gradient(135deg, #FF8A1F, #FFB347)',
        boxShadow: '0 4px 16px rgba(255,138,31,0.25)',
        opacity: loading ? 0.7 : 1,
      }}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" />
        : saved  ? <Check  className="w-4 h-4" />
        :          <Save   className="w-4 h-4" />}
      {loading ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
    </button>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs uppercase tracking-wider" style={glowLabel}>
        {label}
      </label>
      {children}
      {hint && <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.30)' }}>{hint}</p>}
    </div>
  );
}

// ── Profile tab ───────────────────────────────────────────────────────────────
function ProfileTab({ profile, onSaved, fileRef, handleAvatar }) {
  const [form, setForm] = useState({
    fullName:     profile.fullName            || '',
    age:          profile.age                 || '',
    gender:       profile.gender              || 'male',
    height:       profile.height?.value       || '',
    heightUnit:   profile.height?.unit        || 'cm',
    weight:       profile.weight?.value       || '',
    weightUnit:   profile.weight?.unit        || 'kg',
    targetWeight: profile.targetWeight?.value || '',
  });
  const [loading, setLoading] = useState(false);
  const [saved,   setSaved]   = useState(false);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await mlApi.patch('/users/profile', {
        fullName:     form.fullName,
        age:          parseInt(form.age) || undefined,
        gender:       form.gender,
        height:       { value: parseFloat(form.height)       || 0, unit: form.heightUnit },
        weight:       { value: parseFloat(form.weight)       || 0, unit: form.weightUnit },
        targetWeight: { value: parseFloat(form.targetWeight) || 0, unit: form.weightUnit },
      });
      toast.success('Profile updated');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch {
      toast.error('Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Hidden file input */}
      <input ref={fileRef} type="file" accept="image/*"
             onChange={handleAvatar} className="hidden" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Full Name">
          <input type="text" value={form.fullName}
            onChange={(e) => set('fullName', e.target.value)}
            className="input-field" style={inputStyle} />
        </Field>

        <Field label="Age">
          <input type="number" value={form.age}
            onChange={(e) => set('age', e.target.value)}
            min={10} max={100}
            className="input-field" style={inputStyle} />
        </Field>

        <Field label="Gender">
          <select value={form.gender}
            onChange={(e) => set('gender', e.target.value)}
            className="input-field" style={inputStyle}>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </Field>

        <Field label="Height">
          <div className="flex gap-2">
            <input type="number" value={form.height}
              onChange={(e) => set('height', e.target.value)}
              className="input-field flex-1" style={inputStyle} />
            <select value={form.heightUnit}
              onChange={(e) => set('heightUnit', e.target.value)}
              className="input-field w-20" style={inputStyle}>
              <option value="cm">cm</option>
              <option value="ft">ft</option>
            </select>
          </div>
        </Field>

        <Field label="Current Weight">
          <div className="flex gap-2">
            <input type="number" value={form.weight}
              onChange={(e) => set('weight', e.target.value)}
              className="input-field flex-1" style={inputStyle} />
            <select value={form.weightUnit}
              onChange={(e) => set('weightUnit', e.target.value)}
              className="input-field w-20" style={inputStyle}>
              <option value="kg">kg</option>
              <option value="lbs">lbs</option>
            </select>
          </div>
        </Field>

        <Field label="Target Weight">
          <div className="flex gap-2">
            <input type="number" value={form.targetWeight}
              onChange={(e) => set('targetWeight', e.target.value)}
              className="input-field flex-1" style={inputStyle} />
            <span className="flex items-center px-3 rounded-xl text-sm"
                  style={{ background: 'rgba(10,9,8,0.85)', border: '1.5px solid rgba(255,138,31,0.30)', color: 'rgba(255,255,255,0.50)' }}>
              {form.weightUnit}
            </span>
          </div>
        </Field>
      </div>

      <div className="flex justify-end">
        <SaveBtn loading={loading} saved={saved} />
      </div>
    </form>
  );
}

// ── Fitness tab ───────────────────────────────────────────────────────────────
function FitnessTab({ profile, onSaved }) {
  const GOALS = [
    { id: 'weight_loss',    label: 'Weight Loss',     icon: '🔥' },
    { id: 'muscle_gain',    label: 'Muscle Gain',     icon: '💪' },
    { id: 'flexibility',    label: 'Flexibility',     icon: '🧘' },
    { id: 'endurance',      label: 'Endurance',       icon: '🏃' },
    { id: 'stress_relief',  label: 'Stress Relief',   icon: '😌' },
    { id: 'general_fitness',label: 'General Fitness', icon: '⚡' },
    { id: 'posture',        label: 'Posture',         icon: '🎯' },
    { id: 'core_strength',  label: 'Core Strength',   icon: '🏋️' },
  ];

  const EQUIPMENT = [
    { id: 'none',        label: 'No Equipment' },
    { id: 'dumbbells',   label: 'Dumbbells'    },
    { id: 'bands',       label: 'Bands'        },
    { id: 'kettlebells', label: 'Kettlebells'  },
    { id: 'pullup_bar',  label: 'Pull-up Bar'  },
    { id: 'barbell',     label: 'Barbell'      },
    { id: 'machine',     label: 'Machines'     },
  ];

  const [form, setForm] = useState({
    fitnessLevel:         profile.fitnessLevel         || 'beginner',
    fitnessGoals:         profile.fitnessGoals         || [],
    availableEquipment:   profile.availableEquipment   || [],
    sessionDuration:      profile.sessionDuration      || 30,
    preferredWorkoutTime: profile.preferredWorkoutTime || 'morning',
    exerciseFrequency:    profile.exerciseFrequency    || 3,
    medicalConditions:    profile.medicalConditions    || '',
  });
  const [loading, setLoading] = useState(false);
  const [saved,   setSaved]   = useState(false);

  const toggleGoal = (id) => setForm((f) => ({
    ...f,
    fitnessGoals: f.fitnessGoals.includes(id)
      ? f.fitnessGoals.filter((g) => g !== id)
      : [...f.fitnessGoals, id],
  }));

  const toggleEquipment = (id) => setForm((f) => ({
    ...f,
    availableEquipment: f.availableEquipment.includes(id)
      ? f.availableEquipment.filter((e) => e !== id)
      : [...f.availableEquipment, id],
  }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await mlApi.patch('/users/profile', {
        fitnessLevel:         form.fitnessLevel,
        fitnessGoals:         form.fitnessGoals,
        availableEquipment:   form.availableEquipment,
        sessionDuration:      form.sessionDuration,
        preferredWorkoutTime: form.preferredWorkoutTime,
        exerciseFrequency:    form.exerciseFrequency,
        medicalConditions:    form.medicalConditions,
      });
      toast.success('Fitness preferences updated');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch {
      toast.error('Failed to update preferences');
    } finally {
      setLoading(false);
    }
  };

  const chipStyle = (active, color = '#FF8A1F') => ({
    background: active ? `${color}18` : 'rgba(10,9,8,0.85)',
    border:     active ? `1.5px solid ${color}60` : '1.5px solid rgba(255,138,31,0.20)',
    color:      active ? color : 'rgba(255,255,255,0.65)',
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Field label="Fitness Level">
        <div className="flex gap-2">
          {['beginner', 'intermediate', 'advanced'].map((l) => (
            <button key={l} type="button"
              onClick={() => setForm((f) => ({ ...f, fitnessLevel: l }))}
              className="flex-1 py-2 rounded-xl text-sm font-semibold capitalize transition-all"
              style={chipStyle(form.fitnessLevel === l)}>
              {l}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Fitness Goals" hint="Select all that apply">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {GOALS.map((g) => (
            <button key={g.id} type="button"
              onClick={() => toggleGoal(g.id)}
              className="py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5"
              style={chipStyle(form.fitnessGoals.includes(g.id))}>
              <span>{g.icon}</span>{g.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Available Equipment">
        <div className="flex flex-wrap gap-2">
          {EQUIPMENT.map((eq) => (
            <button key={eq.id} type="button"
              onClick={() => toggleEquipment(eq.id)}
              className="py-1.5 px-3 rounded-lg text-xs font-semibold transition-all"
              style={chipStyle(form.availableEquipment.includes(eq.id))}>
              {eq.label}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label={`Session Duration — ${form.sessionDuration} min`}>
          <input type="range" min={15} max={120} step={15}
            value={form.sessionDuration}
            onChange={(e) => setForm((f) => ({ ...f, sessionDuration: parseInt(e.target.value) }))}
            className="w-full accent-amber-500" />
          <div className="flex justify-between text-2xs mt-1"
               style={{ color: 'rgba(255,255,255,0.30)' }}>
            <span>15 min</span><span>120 min</span>
          </div>
        </Field>

        <Field label="Preferred Workout Time">
          <select value={form.preferredWorkoutTime}
            onChange={(e) => setForm((f) => ({ ...f, preferredWorkoutTime: e.target.value }))}
            className="input-field" style={inputStyle}>
            <option value="morning">Morning (5am–12pm)</option>
            <option value="afternoon">Afternoon (12pm–5pm)</option>
            <option value="evening">Evening (5pm–10pm)</option>
            <option value="night">Night (10pm–5am)</option>
          </select>
        </Field>

        <Field label="Weekly Workout Target">
          <select value={form.exerciseFrequency}
            onChange={(e) => setForm((f) => ({ ...f, exerciseFrequency: parseInt(e.target.value) }))}
            className="input-field" style={inputStyle}>
            {[1,2,3,4,5,6,7].map((n) => (
              <option key={n} value={n}>{n} day{n !== 1 ? 's' : ''} / week</option>
            ))}
          </select>
        </Field>

        <Field label="Medical Conditions / Notes"
               hint="Optional. Helps the AI give safer advice.">
          <textarea value={form.medicalConditions}
            onChange={(e) => setForm((f) => ({ ...f, medicalConditions: e.target.value }))}
            rows={3} placeholder="e.g. lower back pain, knee injury"
            className="input-field resize-none" style={inputStyle} />
        </Field>
      </div>

      <div className="flex justify-end">
        <SaveBtn loading={loading} saved={saved} />
      </div>
    </form>
  );
}

// ── Account tab ───────────────────────────────────────────────────────────────
function AccountTab({ profile }) {
  const { logout } = useAuth();
  const { triggerTransition } = useTransition();
  const [pwForm,         setPwForm]         = useState({ current: '', newPw: '', confirm: '' });
  const [pwLoading,      setPwLoading]      = useState(false);
  const [pwSaved,        setPwSaved]        = useState(false);
  const [delConfirm,     setDelConfirm]     = useState('');
  const [delLoading,     setDelLoading]     = useState(false);
  const [resetLoading,   setResetLoading]   = useState(false);
  const [showDeleteModal,setShowDeleteModal] = useState(false);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (pwForm.newPw !== pwForm.confirm) { toast.error('New passwords do not match'); return; }
    if (pwForm.newPw.length < 8)         { toast.error('Password must be at least 8 characters'); return; }
    setPwLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res   = await fetch('http://localhost:3001/api/auth/change-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.newPw }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      toast.success('Password changed successfully');
      setPwSaved(true);
      setPwForm({ current: '', newPw: '', confirm: '' });
      setTimeout(() => setPwSaved(false), 2000);
    } catch (err) {
      toast.error(err.message || 'Failed to change password');
    } finally {
      setPwLoading(false);
    }
  };

  const handleResetOnboarding = async () => {
    if (!window.confirm('This will redirect you to the onboarding wizard next visit. Continue?')) return;
    setResetLoading(true);
    try {
      await mlApi.post('/users/reset-onboarding');
      toast.success('Onboarding reset. Refresh to go through it again.');
    } catch { toast.error('Failed to reset onboarding'); }
    finally   { setResetLoading(false); }
  };

  const handleDeleteAccount = async () => {
    setDelLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res   = await fetch('http://localhost:3001/api/auth/account', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ password: delConfirm }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      toast.success('Account deleted');
      triggerTransition(() => logout());
    } catch (err) {
      toast.error(err.message || 'Failed to delete account');
    } finally {
      setDelLoading(false);
      setShowDeleteModal(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card-glass">
        <h3 className="text-sm font-bold text-white mb-3">Account Info</h3>
        <div className="space-y-2">
          {[
            { label: 'Name',         value: profile.fullName },
            { label: 'Email',        value: profile.email },
            { label: 'Auth method',  value: 'Email & Password' },
            { label: 'Member since', value: new Date(profile.createdAt || Date.now())
                .toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) },
          ].map((r) => (
            <div key={r.label} className="flex justify-between items-center py-2"
                 style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <span className="text-xs" style={{ color: 'rgba(255,255,255,0.50)' }}>{r.label}</span>
              <span className="text-xs font-semibold text-white">{r.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card-glass">
        <h3 className="text-sm font-bold text-white mb-4">Change Password</h3>
        <form onSubmit={handlePasswordChange} className="space-y-3">
          {[
            { key: 'current', label: 'Current Password',     type: 'password' },
            { key: 'newPw',   label: 'New Password',         type: 'password' },
            { key: 'confirm', label: 'Confirm New Password', type: 'password' },
          ].map((f) => (
            <Field key={f.key} label={f.label}>
              <input type={f.type} value={pwForm[f.key]}
                onChange={(e) => setPwForm((p) => ({ ...p, [f.key]: e.target.value }))}
                className="input-field" style={inputStyle} placeholder="••••••••" />
            </Field>
          ))}
          <div className="flex justify-end pt-2">
            <SaveBtn loading={pwLoading} saved={pwSaved} />
          </div>
        </form>
      </div>

      <div className="rounded-2xl p-4 space-y-3"
           style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.15)' }}>
        <h3 className="text-sm font-bold" style={{ color: '#f87171' }}>Danger Zone</h3>
        <div className="flex items-center justify-between py-2"
             style={{ borderBottom: '1px solid rgba(239,68,68,0.08)' }}>
          <div>
            <p className="text-sm font-semibold text-white">Reset Onboarding</p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Re-run the setup wizard to update your goals and measurements
            </p>
          </div>
          <button type="button" onClick={handleResetOnboarding} disabled={resetLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{ background: 'rgba(255,138,31,0.10)', border: '1px solid rgba(255,138,31,0.25)', color: '#FF8A1F' }}>
            {resetLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Reset
          </button>
        </div>
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm font-semibold" style={{ color: '#f87171' }}>Delete Account</p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Permanently delete your account and all data
            </p>
          </div>
          <button type="button" onClick={() => setShowDeleteModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showDeleteModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowDeleteModal(false)}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
          >
            <motion.div
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-3xl p-6"
              style={{ background: '#121110', border: '1px solid rgba(239,68,68,0.20)' }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                     style={{ background: 'rgba(239,68,68,0.12)' }}>
                  <AlertTriangle className="w-5 h-5" style={{ color: '#f87171' }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">Delete Account</p>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.50)' }}>This cannot be undone</p>
                </div>
              </div>
              <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.65)' }}>
                All your workouts, nutrition logs, badges, and progress will be permanently deleted.
                Enter your password to confirm.
              </p>
              <Field label="Your Password">
                <input type="password" value={delConfirm}
                  onChange={(e) => setDelConfirm(e.target.value)}
                  placeholder="••••••••" className="input-field" style={inputStyle} />
              </Field>
              <div className="flex gap-3 mt-5">
                <button type="button" onClick={() => setShowDeleteModal(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.70)' }}>
                  Cancel
                </button>
                <button type="button" onClick={handleDeleteAccount}
                  disabled={delLoading || !delConfirm}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
                  style={{
                    background: delConfirm ? 'rgba(239,68,68,0.80)' : 'rgba(239,68,68,0.20)',
                    color:      delConfirm ? '#fff' : '#f87171',
                    opacity:    delLoading ? 0.7 : 1,
                  }}>
                  {delLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Delete Forever
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Notifications tab ─────────────────────────────────────────────────────────
function NotificationsTab() {
  const [prefs, setPrefs] = useState({
    workout_reminders:   true,
    badge_unlocks:       true,
    challenge_updates:   true,
    weekly_summary:      true,
    nutrition_reminders: false,
    streak_warnings:     true,
  });
  const [saved, setSaved] = useState(false);
  const toggle = (key) => setPrefs((p) => ({ ...p, [key]: !p[key] }));

  const ITEMS = [
    { key: 'workout_reminders',   label: 'Workout Reminders',   desc: 'Daily reminders to stick to your schedule'  },
    { key: 'badge_unlocks',       label: 'Badge Unlocks',        desc: 'Notify when you earn a new achievement'     },
    { key: 'challenge_updates',   label: 'Challenge Updates',    desc: 'Progress updates on weekly challenges'      },
    { key: 'weekly_summary',      label: 'Weekly Summary',       desc: 'Your stats and highlights every Sunday'     },
    { key: 'nutrition_reminders', label: 'Nutrition Reminders',  desc: 'Remind to log meals throughout the day'    },
    { key: 'streak_warnings',     label: 'Streak Warnings',      desc: "Alert if you're about to lose your streak" },
  ];

  const handleSave = () => {
    setSaved(true);
    toast.success('Notification preferences saved');
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="card-glass">
        <p className="text-xs mb-4" style={{ color: 'rgba(255,255,255,0.50)' }}>
          Notification preferences are saved locally. Push notifications
          will be available in the mobile app (Phase 16).
        </p>
        {ITEMS.map((item, i) => (
          <div key={item.key} className="flex items-center justify-between py-3"
               style={{ borderBottom: i < ITEMS.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
            <div>
              <p className="text-sm font-semibold text-white">{item.label}</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>{item.desc}</p>
            </div>
            <button type="button" onClick={() => toggle(item.key)}
              className="w-12 h-6 rounded-full transition-all relative flex-shrink-0"
              style={{ background: prefs[item.key] ? 'linear-gradient(135deg, #FF8A1F, #FFB347)' : 'rgba(255,255,255,0.08)' }}>
              <motion.div
                animate={{ x: prefs[item.key] ? 24 : 2 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="absolute top-1 w-4 h-4 rounded-full bg-white"
                style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}
              />
            </button>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={handleSave}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm text-white"
          style={{
            background: saved ? 'linear-gradient(135deg, #22c55e, #4ade80)' : 'linear-gradient(135deg, #FF8A1F, #FFB347)',
            boxShadow: '0 4px 16px rgba(255,138,31,0.25)',
          }}>
          {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saved ? 'Saved!' : 'Save Preferences'}
        </button>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Settings() {
  const { logout } = useAuth();
  const { triggerTransition } = useTransition();
  const [tab,     setTab]     = useState('profile');
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [avatar,  setAvatar]  = useState('');
  const fileRef = useRef(null);

  const loadProfile = async () => {
    try {
      const res = await mlApi.get('/users/profile');
      setProfile(res.data.user);
      setAvatar(res.data.user?.profilePicture || '');
    } catch (err) {
      console.error('Failed to load profile:', err);
      toast.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProfile(); }, []);

  const handleAvatar = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Image must be under 2MB'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = reader.result;
      setAvatar(b64);
      try {
        await mlApi.patch('/users/profile', { profilePicture: b64 });
        toast.success('Profile picture updated');
        loadProfile();
      } catch { toast.error('Failed to upload picture'); }
    };
    reader.readAsDataURL(file);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0A0908' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#FF8A1F' }} />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen p-6" style={{ background: '#0A0908' }}>
        <p className="text-white">Failed to load settings</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 relative">

      {/* Fixed background */}
      <div style={{
        position:           'fixed',
        inset:               0,
        zIndex:              0,
        background:         '#0A0908',
        backgroundImage:    'url(/images/dashboard/setting.png)',
        backgroundSize:     'contain',
        backgroundPosition: 'center bottom',
        backgroundRepeat:   'no-repeat',
      }} />

      {/* Dark overlay */}
      <div style={{
        position:   'fixed',
        inset:       0,
        zIndex:      1,
        background: 'linear-gradient(135deg, rgba(10,9,8,0.88) 0%, rgba(10,9,8,0.60) 50%, rgba(10,9,8,0.30) 100%)',
      }} />

      {/* Hidden file input — accessible globally */}
      <input ref={fileRef} type="file" accept="image/*"
             onChange={handleAvatar} className="hidden" />

      {/* Content */}
      <div className="relative settings-page" style={{ zIndex: 2 }}>
        <div className="fixed pointer-events-none" style={{
          top: -200, right: -200, width: 600, height: 600,
          background: 'radial-gradient(ellipse, rgba(255,138,31,0.05) 0%, transparent 70%)',
          zIndex: 0,
        }} />

        <div className="max-w-4xl mx-auto relative z-10">

          {/* ── Header ────────────────────────────────────────────────────── */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tighter text-white"
                  style={{ textShadow: '0 0 20px rgba(255,138,31,0.80), 0 0 40px rgba(255,138,31,0.40)' }}>
                Settings
              </h1>
              <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
                Manage your profile and preferences
              </p>
            </div>

            {/* Right side: Sign Out on top, profile info + avatar below */}
            <div className="flex flex-col items-end gap-3">
              {/* Sign Out button */}
              <button
                onClick={() => { if (window.confirm('Are you sure you want to sign out?')) triggerTransition(() => logout()); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border:     '1px solid rgba(255,255,255,0.12)',
                  color:      'rgba(255,255,255,0.75)',
                }}
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>

              {/* Profile info + avatar below Sign Out */}
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-bold text-white leading-tight"
                     style={{ textShadow: '0 0 12px rgba(255,138,31,0.60)' }}>
                    {profile?.fullName}
                  </p>
                  <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    {profile?.email}
                  </p>
                  <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    Member since {new Date(profile?.createdAt || Date.now()).toLocaleDateString()}
                  </p>
                </div>

                {/* Avatar with camera button */}
                <div className="relative flex-shrink-0">
                  <div
                    className="w-14 h-14 rounded-xl overflow-hidden flex items-center
                               justify-center text-lg font-bold"
                    style={{
                      background: avatar ? 'transparent' : 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                      color: '#fff',
                      boxShadow: '0 0 16px rgba(255,138,31,0.40)',
                    }}
                  >
                    {avatar
                      ? <img src={avatar} alt="avatar" className="w-full h-full object-cover" />
                      : (profile?.fullName?.[0] || 'U').toUpperCase()
                    }
                  </div>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg
                               flex items-center justify-center"
                    style={{ background: '#FF8A1F', boxShadow: '0 2px 8px rgba(255,138,31,0.5)' }}
                  >
                    <Camera className="w-3 h-3 text-white" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Body ──────────────────────────────────────────────────────── */}
          <div className="flex flex-col md:flex-row gap-6">

            {/* Sidebar tabs */}
            <div className="flex md:flex-col gap-2 md:w-48 flex-shrink-0">
              {TABS.map((t) => {
                const Icon   = t.icon;
                const active = tab === t.id;
                return (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all text-left"
                    style={{
                      background: active
                        ? 'linear-gradient(135deg, rgba(255,138,31,0.15), rgba(255,138,31,0.05))'
                        : 'rgba(10,9,8,0.60)',
                      border: active
                        ? '1px solid rgba(255,138,31,0.40)'
                        : '1px solid rgba(255,255,255,0.08)',
                      color:     active ? '#FF8A1F' : 'rgba(255,255,255,0.60)',
                      boxShadow: active ? '0 0 12px rgba(255,138,31,0.20)' : 'none',
                    }}
                  >
                    <Icon className="w-4 h-4" />
                    {t.label}
                    {active && (
                      <ChevronRight className="w-3.5 h-3.5 ml-auto hidden md:block"
                                    style={{ color: '#FF8A1F' }} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div className="flex-1">
              <AnimatePresence mode="wait">
                <motion.div key={tab}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{    opacity: 0, y: 8 }}
                  transition={{ duration: 0.2 }}
                >
                  {tab === 'profile'       && (
                    <ProfileTab
                      profile={profile}
                      onSaved={loadProfile}
                      fileRef={fileRef}
                      handleAvatar={handleAvatar}
                    />
                  )}
                  {tab === 'fitness'       && <FitnessTab       profile={profile} onSaved={loadProfile} />}
                  {tab === 'account'       && <AccountTab       profile={profile} />}
                  {tab === 'notifications' && <NotificationsTab />}
                </motion.div>
              </AnimatePresence>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}