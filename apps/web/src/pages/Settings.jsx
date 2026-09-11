import { useState, useEffect, useRef } from 'react';
import { useMyGyms } from '../hooks/useMyGyms';
import { myOrgsWords } from '../components/gym/gymMembershipView';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User, Dumbbell, Lock, Bell, Trash2, Camera,
  Save, Loader2, Check, AlertTriangle, RefreshCw,
  Shield, ChevronRight, LogOut, Building2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useTransition } from '../context/TransitionContext';
import { userService, heightToCm, weightToKg, convertHeight, convertWeight, mergeFitnessProfile, profilePatchFor } from '../api/userApi';
import { onboardingService } from '../api/onboardingApi';
import {
  EQUIPMENT, GOALS, WEIGHT_GOALS, cleanEquipment, targetDirection, targetWrongSide, toggleEquipment, toggleGoal, wrongSideText,
} from './onboarding/onboardingModel';
import { EQUIPMENT_ICONS, GOAL_ICONS, WEIGHT_GOAL_ICONS } from './onboarding/onboardingIcons';
import { authService } from '../api/authApi';
import mlApi from '../api/mlApi'; // KEPT: avatar/profile-picture only — no new-API home (owed card)
import Select from '../components/common/Select';
import JoinGymPanel from '../components/gym/JoinGymPanel';
import GymMembershipCard from '../components/gym/GymMembershipCard';

// `gym` is where v1 §8 puts joining a gym — "member enters code at
// registration or in Settings" — and it is the MEMBER's side of that
// relationship only: the code box, and what the gym can see about them.
//
// IT IS NOT A DOOR INTO THE GYM CONSOLE, and it must never become one. Kd
// removed the `My Gym` sidebar entry on 2026-08-19 and ruled the login page's
// two doors the only crossing between the member app and the console, in both
// directions. A link to `/console` added here re-opens exactly that.
/** THE TAB THAT HOLDS THE JOIN CODE IS NAMED AFTER WHAT THE PERSON HAS JOINED
 *  (roadmap 2b): a studio's client taps Studio, a trainer's taps Trainer.
 *  Somebody in two types at once, or in none yet, gets the word `myOrgsWords`
 *  decides — which for an empty list is the gym's, exactly what this tab said
 *  before. */
function tabsFor(orgWord) {
  return [
    { id: 'profile',       label: 'Profile',       icon: User    },
    { id: 'fitness',       label: 'Fitness',       icon: Dumbbell },
    { id: 'gym',           label: orgWord,         icon: Building2 },
    { id: 'account',       label: 'Account',       icon: Shield  },
    { id: 'notifications', label: 'Notifications', icon: Bell    },
  ];
}

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
  // Keeps browser-drawn bits of native inputs dark (number spinners, autofill)
  // instead of light against this UI. The dropdowns themselves no longer rely
  // on it — they use the custom <Select>, because the OS paints a native
  // popup's hovered row with the system accent (blue) and CSS cannot override
  // that. (Kd smoke finding, Card 7.)
  colorScheme: 'dark',
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
  // Card 7: init from the new-API shape (metric; name is displayName).
  const [form, setForm] = useState({
    fullName:     profile.displayName    || '',
    age:          profile.age            || '',
    // T3 F2: NO fabricated default — the shared schema is explicit that an
    // unanswered field stays NULL ("unanswered is not 'beginner'", users.ts).
    gender:       profile.gender         || '',
    height:       profile.heightCm       || '',
    heightUnit:   'cm',
    weight:       profile.weightKg       || '',
    weightUnit:   'kg',
    targetWeight: profile.targetWeightKg || '',
  });
  const [loading, setLoading] = useState(false);
  const [saved,   setSaved]   = useState(false);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  // Converting unit switch (reuse Card 6) so a value in the box isn't silently
  // reinterpreted (175 cm → 175 ft = 5334 cm → the server's 300 cm cap 400s).
  const changeHeightUnit = (u) =>
    setForm((f) => (f.heightUnit === u ? f : { ...f, heightUnit: u, height: convertHeight(f.height, u) }));
  const changeWeightUnit = (u) =>
    setForm((f) => (f.weightUnit === u ? f
      : { ...f, weightUnit: u, weight: convertWeight(f.weight, u), targetWeight: convertWeight(f.targetWeight, u) }));

  const { updateUser } = useAuth();

  // A target on the wrong side of the weight for the weight choice cannot be
  // typed in, and is named in screen 3's own words (RULINGS 2026-09-11). The
  // weight is the one this save leaves: the box's, else the newest weigh-in.
  // A stored one is only named, so the rest still saves.
  const direction = targetDirection(profile.weightGoal);
  const weightKgNow = weightToKg(form.weight, form.weightUnit) ?? profile.weightKg ?? null;
  const targetKg = weightToKg(form.targetWeight, form.weightUnit);
  const wrongSide = direction !== null && targetWrongSide(direction, targetKg, weightKgNow)
    ? wrongSideText(direction, targetKg, weightKgNow, form.weightUnit === 'lbs' ? 'imperial' : 'metric')
    : null;
  const targetTyped = targetKg !== (profile.targetWeightKg ?? null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (wrongSide !== null && targetTyped) {
      toast.error(wrongSide);
      return;
    }
    setLoading(true);
    try {
      // name + weight → /v1/users/me, and ONLY when changed (profilePatchFor:
      // a weight echoed back unchanged would become a "typed by me" weigh-in
      // the person never typed); age/gender/height/target → the fitness
      // profile via a MERGE (preserve the fitness-prefs the other form owns +
      // keep onboardingCompleted true).
      // T3 F4: the PUT runs FIRST because it is the call that rejects
      // out-of-range user input — so a validation failure leaves NOTHING
      // committed, rather than half-saving name/weight and reporting failure.
      const age = parseInt(form.age, 10);
      await userService.putFitnessProfile(mergeFitnessProfile(profile, {
        age: Number.isFinite(age) ? age : null,
        gender: form.gender || null,
        heightCm: heightToCm(form.height, form.heightUnit),
        targetWeightKg: weightToKg(form.targetWeight, form.weightUnit),
      }));
      const patch = profilePatchFor(profile, form);
      if (Object.keys(patch).length) {
        const res = await userService.updateProfile(patch);
        // The rest of the app (the sidebar, the dashboard's greeting) calls
        // the person by the name the server now holds.
        const name = res?.data?.user?.displayName;
        if (typeof name === 'string') updateUser({ displayName: name });
      }

      toast.success('Profile updated');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (err) {
      toast.error(err?.response?.status === 400
        ? 'Some values look out of range — please check your age, height and weight.'
        : 'Failed to update profile');
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
            min={13} max={120}
            className="input-field" style={inputStyle} />
        </Field>

        <Field label="Gender">
          <Select
            value={form.gender}
            onChange={(v) => set('gender', v)}
            ariaLabel="Gender"
            style={inputStyle}
            options={[
              { value: '',                  label: 'Not set' },
              { value: 'male',              label: 'Male' },
              { value: 'female',            label: 'Female' },
              { value: 'other',             label: 'Other' },
              { value: 'prefer_not_to_say', label: 'Prefer not to say' },
            ]}
          />
        </Field>

        <Field label="Height">
          <div className="flex gap-2">
            <input type="number" value={form.height}
              onChange={(e) => set('height', e.target.value)}
              className="input-field flex-1" style={inputStyle} />
            <Select
              value={form.heightUnit}
              onChange={changeHeightUnit}
              ariaLabel="Height unit"
              className="w-24"
              style={inputStyle}
              options={[{ value: 'cm', label: 'cm' }, { value: 'ft', label: 'ft' }]}
            />
          </div>
        </Field>

        <Field label="Current Weight">
          <div className="flex gap-2">
            <input type="number" value={form.weight}
              onChange={(e) => set('weight', e.target.value)}
              className="input-field flex-1" style={inputStyle} />
            <Select
              value={form.weightUnit}
              onChange={changeWeightUnit}
              ariaLabel="Weight unit"
              className="w-24"
              style={inputStyle}
              options={[{ value: 'kg', label: 'kg' }, { value: 'lbs', label: 'lbs' }]}
            />
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
          {wrongSide && (
            <p role="alert" className="text-2xs" style={{ color: '#f87171' }}>{wrongSide}</p>
          )}
        </Field>
      </div>

      <div className="flex justify-end">
        <SaveBtn loading={loading} saved={saved} />
      </div>
    </form>
  );
}

// ── Fitness tab ───────────────────────────────────────────────────────────────
export function FitnessTab({ profile, onSaved }) {
  // Screen 1's two questions and screen 7's equipment, in the screens' own
  // words, line icons and tables (4a-iv), so the two can never offer
  // different answers: ONE weight choice, which alone sets the calories, and
  // any number of goals to work on beside it; "No equipment" stands alone. A
  // change takes effect on save, and nothing is asked again (RULINGS 2026-09-11).

  // Card 7: init from the new-API shape (sessionDurationMin).
  const [form, setForm] = useState({
    // T3 F2: NO fabricated defaults — the shared schema is explicit that an
    // unanswered field stays NULL ("unanswered is not 'beginner'", users.ts).
    // Empty/null here → the save sends null, not an invented answer.
    fitnessLevel:         profile.fitnessLevel         || '',
    weightGoal:           profile.weightGoal           ?? null,
    fitnessGoals:         profile.fitnessGoals         || [],
    // An old "none" beside equipment loads as the equipment, as screen 7 does.
    availableEquipment:   cleanEquipment(profile.availableEquipment),
    sessionDuration:      profile.sessionDurationMin   ?? null,
    preferredWorkoutTime: profile.preferredWorkoutTime || '',
    exerciseFrequency:    profile.exerciseFrequency    ?? null,
    medicalConditions:    profile.medicalConditions    || '',
  });
  const [loading, setLoading] = useState(false);
  const [saved,   setSaved]   = useState(false);

  const pickWeightGoal = (value) => setForm((f) => ({ ...f, weightGoal: value }));
  const tickGoal = (value) => setForm((f) => ({ ...f, fitnessGoals: toggleGoal(f.fitnessGoals, value) }));
  const tickEquipment = (value) => setForm((f) => ({ ...f, availableEquipment: toggleEquipment(f.availableEquipment, value) }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // MERGE: preserve the basic-info fields the other form owns (age/gender/
      // height/target) + keep onboardingCompleted true; override only the prefs.
      const med = (form.medicalConditions || '').trim();
      await userService.putFitnessProfile(mergeFitnessProfile(profile, {
        fitnessLevel:         form.fitnessLevel || null,
        weightGoal:           form.weightGoal,
        fitnessGoals:         form.fitnessGoals,
        availableEquipment:   form.availableEquipment,
        sessionDurationMin:   Number.isFinite(form.sessionDuration) ? form.sessionDuration : null,
        preferredWorkoutTime: form.preferredWorkoutTime || null,
        exerciseFrequency:    Number.isFinite(form.exerciseFrequency) ? form.exerciseFrequency : null,
        medicalConditions:    med === '' ? null : med,
      }));
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

      {/* Screen 1's one grid, three to a row: the weight choice is the top row
          (pick one), the goals below (any of them). */}
      <Field label="Your Goal" hint="Pick one from the top row, and any of the rest.">
        <div className="grid grid-cols-3 gap-2">
          {[
            ...WEIGHT_GOALS.map((g) => ({
              ...g, Icon: WEIGHT_GOAL_ICONS[g.value], on: form.weightGoal === g.value, tap: () => pickWeightGoal(g.value),
            })),
            ...GOALS.map((g) => ({
              ...g, Icon: GOAL_ICONS[g.value], on: form.fitnessGoals.includes(g.value), tap: () => tickGoal(g.value),
            })),
          ].map(({ value, label, Icon, on, tap }) => (
            <button key={value} type="button"
              aria-pressed={on}
              onClick={tap}
              className="py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 text-left"
              style={chipStyle(on)}>
              <Icon aria-hidden="true" className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />{label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Available Equipment" hint="Pick all that apply, or No equipment.">
        <div className="flex flex-wrap gap-2">
          {EQUIPMENT.map((eq) => {
            const Icon = EQUIPMENT_ICONS[eq.value];
            const on = form.availableEquipment.includes(eq.value);
            return (
              <button key={eq.value} type="button"
                aria-pressed={on}
                onClick={() => tickEquipment(eq.value)}
                className="py-1.5 px-3 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5"
                style={chipStyle(on)}>
                <Icon aria-hidden="true" className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} />{eq.label}
              </button>
            );
          })}
        </div>
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* T3 F2: the slider always has a position, so an UNSET duration keeps
            state null (saved as null) and is labelled "Not set" — the 30 below
            is display-only until the user actually moves it. */}
        <Field label={`Session Duration — ${form.sessionDuration === null ? 'Not set' : `${form.sessionDuration} min`}`}>
          <input type="range" min={15} max={120} step={15}
            value={form.sessionDuration ?? 30}
            onChange={(e) => setForm((f) => ({ ...f, sessionDuration: parseInt(e.target.value, 10) }))}
            className="w-full accent-amber-500" />
          <div className="flex justify-between text-2xs mt-1"
               style={{ color: 'rgba(255,255,255,0.30)' }}>
            <span>15 min</span><span>120 min</span>
          </div>
        </Field>

        <Field label="Preferred Workout Time">
          <Select
            value={form.preferredWorkoutTime}
            onChange={(v) => setForm((f) => ({ ...f, preferredWorkoutTime: v }))}
            ariaLabel="Preferred workout time"
            style={inputStyle}
            options={[
              { value: '',          label: 'Not set' },
              { value: 'morning',   label: 'Morning (5am–12pm)' },
              { value: 'afternoon', label: 'Afternoon (12pm–5pm)' },
              { value: 'evening',   label: 'Evening (5pm–10pm)' },
            ]}
          />
        </Field>

        <Field label="Weekly Workout Target">
          <Select
            value={form.exerciseFrequency ?? ''}
            onChange={(v) => setForm((f) => ({ ...f, exerciseFrequency: v === '' ? null : v }))}
            ariaLabel="Weekly workout target"
            style={inputStyle}
            options={[
              { value: '', label: 'Not set' },
              ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: `${n} day${n !== 1 ? 's' : ''} / week` })),
            ]}
          />
        </Field>

        <Field label="Medical Conditions / Notes"
               hint="Optional. Helps the AI give safer advice.">
          <textarea value={form.medicalConditions}
            onChange={(e) => setForm((f) => ({ ...f, medicalConditions: e.target.value }))}
            rows={3} placeholder="e.g. lower back pain, knee injury"
            maxLength={2000}
            className="input-field resize-none" style={inputStyle} />
        </Field>
      </div>

      <div className="flex justify-end">
        <SaveBtn loading={loading} saved={saved} />
      </div>
    </form>
  );
}

// ── Gym tab ───────────────────────────────────────────────────────────────────
//
// v1 §8: "Member enters code at registration or in Settings." This is the
// Settings half, and until it existed there was no half at all — the join
// endpoint had shipped and no screen in the app called it, so a gym could hand
// out a code nobody could redeem.
//
// The panel is shared with `/org/join`, the address a poster QR points at, so
// the two cannot answer differently. `GymMembershipCard` above it is the same
// component the dashboard draws: a person who is waiting, or was refused, or is
// already in, is told so HERE too, rather than having to remember what the
// dashboard said.
function GymTab() {
  // T3 r1 L-6: the card and the panel are two views of ONE fact and sat an inch
  // apart, so the panel could say "You've asked to join Iron House" over a card
  // that still said nothing until the page was reloaded. The counter re-reads
  // the card the moment the panel gets an answer.
  const [applied, setApplied] = useState(0);
  return (
    <div className="flex flex-col gap-5">
      <GymMembershipCard refreshToken={applied} />
      <JoinGymPanel onApplied={() => setApplied((n) => n + 1)} />
    </div>
  );
}

// ── Account tab ───────────────────────────────────────────────────────────────
// THERE IS NO PASSWORD (Kd, 2026-09-07): you sign in with an emailed code or
// with Google, so the "Change Password" card is SWITCHED OFF — the server
// routes stay, the screen no longer shows a form nobody can fill in. Deleting
// the account is confirmed with a code emailed to the account's own address,
// for the same reason.
function AccountTab({ profile, onSaved }) {
  const { logout, updateUser } = useAuth();
  const { triggerTransition } = useTransition();
  const [delCode,        setDelCode]        = useState('');
  const [delCodeSent,    setDelCodeSent]    = useState(false);
  const [delLoading,     setDelLoading]     = useState(false);
  const [resetLoading,   setResetLoading]   = useState(false);
  const [showDeleteModal,setShowDeleteModal] = useState(false);

  const openDeleteModal = () => {
    setDelCode('');
    setDelCodeSent(false);
    setShowDeleteModal(true);
  };

  const handleSendDeleteCode = async () => {
    setDelLoading(true);
    try {
      await authService.requestDeleteCode();
      setDelCodeSent(true);
      toast.success(`Code sent to ${profile.email}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'We could not send the code. Please try again.');
    } finally {
      setDelLoading(false);
    }
  };

  const handleResetOnboarding = async () => {
    if (!window.confirm('This clears your answers, including your medical notes, and takes you through setup again. Your name, your weigh-ins and any answer you gave to the health question are kept. Continue?')) return;
    setResetLoading(true);
    try {
      // Every answer goes, the medical notes and the ones only the setup
      // screens ask included (RULINGS 2026-07-20: reset wipes every answer),
      // and the gate shuts. The name and the weigh-in history are not answers
      // on that row, and stay; so does the answer to the health question,
      // until 4b asks it in setup.
      await onboardingService.reset();
      // T3 F1: the parent's cached `profile` is now STALE (the row is wiped).
      // Without this refresh, opening the Fitness tab and saving would merge
      // against the stale copy and silently re-write every wiped field —
      // including onboardingCompleted:true — undoing the reset. Flip the
      // context flag too so the gate (ProtectedRoute) sends the user to the
      // wizard immediately instead of waiting for a manual refresh.
      await onSaved();
      updateUser({ onboardingCompleted: false });
      toast.success('Onboarding reset — taking you through it again.');
    } catch { toast.error('Failed to reset onboarding'); }
    finally   { setResetLoading(false); }
  };

  const handleDeleteAccount = async () => {
    if (delCode.length !== 6) { toast.error('Type the 6 digits from the email.'); return; }
    setDelLoading(true);
    try {
      // The NEW API: cookie-authed DELETE /v1/users/me with the emailed code.
      // The server's message says what actually happens next (scheduled,
      // and whether an undo email went out) — shown as it is, never reworded.
      const res = await authService.deleteAccount(delCode);
      toast.success(res.data?.message || 'Account scheduled for deletion.');
      setShowDeleteModal(false);
      triggerTransition(() => logout());
    } catch (err) {
      // A wrong code keeps the modal open so the person can try again.
      toast.error(err.response?.data?.message || 'Failed to delete account');
      setDelCode('');
    } finally {
      setDelLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card-glass">
        <h3 className="text-sm font-bold text-white mb-3">Account Info</h3>
        <div className="space-y-2">
          {[
            { label: 'Name',         value: profile.displayName },
            { label: 'Email',        value: profile.email },
            { label: 'Sign-in',      value: 'Email code or Google' },
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
          <button type="button" onClick={openDeleteModal}
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
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.50)' }}>Confirmed with a code we email you</p>
                </div>
              </div>
              <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.65)' }}>
                Your workouts, nutrition logs, badges and progress will be deleted.
                {delCodeSent
                  ? ' Type the 6-digit code from the email to confirm.'
                  : ` To confirm it is you, we will email a 6-digit code to ${profile.email}.`}
              </p>
              {delCodeSent && (
                <Field label="6-digit code">
                  <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                    value={delCode} autoComplete="one-time-code"
                    onChange={(e) => setDelCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456" className="input-field" style={inputStyle} />
                </Field>
              )}
              <div className="flex gap-3 mt-5">
                <button type="button" onClick={() => setShowDeleteModal(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.70)' }}>
                  Cancel
                </button>
                {delCodeSent ? (
                  <button type="button" onClick={handleDeleteAccount}
                    disabled={delLoading || delCode.length !== 6}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
                    style={{
                      background: delCode.length === 6 ? 'rgba(239,68,68,0.80)' : 'rgba(239,68,68,0.20)',
                      color:      delCode.length === 6 ? '#fff' : '#f87171',
                      opacity:    delLoading ? 0.7 : 1,
                    }}>
                    {delLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Delete my account
                  </button>
                ) : (
                  <button type="button" onClick={handleSendDeleteCode}
                    disabled={delLoading}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
                    style={{ background: 'rgba(239,68,68,0.80)', color: '#fff', opacity: delLoading ? 0.7 : 1 }}>
                    {delLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Email me a code
                  </button>
                )}
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
  // Reads the kept `/v1/orgs/mine` answer the sidebar has already fetched — a
  // shared store, not a second request.
  const { gyms } = useMyGyms();
  const tabs = tabsFor(myOrgsWords(gyms).oneCap);
  const { triggerTransition } = useTransition();
  const [tab,     setTab]     = useState('profile');
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [avatar,  setAvatar]  = useState('');
  const fileRef = useRef(null);

  const loadProfile = async () => {
    // Card 7: profile now comes from the new API — /v1/users/me (name, weight,
    // onboardingCompleted) merged with /v1/users/me/fitness-profile (age, goals,
    // …). Flat merge; both carry onboardingCompleted (same value).
    try {
      const [meRes, fpRes] = await Promise.all([
        userService.getProfile(),
        userService.getFitnessProfile(),
      ]);
      setProfile({ ...fpRes.data.fitnessProfile, ...meRes.data.user });
    } catch (err) {
      console.error('Failed to load profile:', err?.message);
      toast.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
    // Avatar still lives on the OLD backend (no new-API home — owed card).
    // Isolated so its failure (old backend down on this branch) never blocks
    // the profile load above.
    try {
      const av = await mlApi.get('/users/profile');
      setAvatar(av.data.user?.profilePicture || '');
    } catch (err) {
      // Expected on this branch (old backend down); logged rather than
      // swallowed so a genuine fault is still visible (R2.5).
      console.debug('avatar unavailable:', err?.message);
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
                    {profile?.displayName}
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
                      : (profile?.displayName?.[0] || 'U').toUpperCase()
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
              {tabs.map((t) => {
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
                  {tab === 'gym'           && <GymTab />}
                  {tab === 'account'       && <AccountTab       profile={profile} onSaved={loadProfile} />}
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