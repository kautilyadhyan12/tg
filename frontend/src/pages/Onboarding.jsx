import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { userService } from '../api/userApi';
import toast from 'react-hot-toast';
import {
  User, Ruler, Target, Dumbbell,
  Clock, ChevronRight, ChevronLeft,
  Check, Zap,
} from 'lucide-react';

const STEPS = [
  { id: 1, title: 'Basic Info',    icon: User,     desc: 'Tell us about yourself'      },
  { id: 2, title: 'Fitness Level', icon: Zap,      desc: 'Your current fitness status' },
  { id: 3, title: 'Your Goals',    icon: Target,   desc: 'What do you want to achieve' },
  { id: 4, title: 'Equipment',     icon: Dumbbell, desc: 'What you have available'     },
  { id: 5, title: 'Preferences',   icon: Clock,    desc: 'When and how long you train' },
];

const FITNESS_GOALS = [
  { value: 'weight_loss',     label: 'Weight Loss',        emoji: '🔥' },
  { value: 'muscle_gain',     label: 'Muscle Gain',        emoji: '💪' },
  { value: 'general_fitness', label: 'General Fitness',    emoji: '⚡' },
  { value: 'flexibility',     label: 'Flexibility',        emoji: '🧘' },
  { value: 'endurance',       label: 'Endurance',          emoji: '🏃' },
  { value: 'posture',         label: 'Posture Correction', emoji: '🎯' },
  { value: 'stress_relief',   label: 'Stress Relief',      emoji: '😌' },
];

const EQUIPMENT_OPTIONS = [
  { value: 'none',             label: 'No Equipment',     emoji: '🏠' },
  { value: 'dumbbells',        label: 'Dumbbells',        emoji: '🏋️' },
  { value: 'resistance_bands', label: 'Resistance Bands', emoji: '🎽' },
  { value: 'kettlebells',      label: 'Kettlebells',      emoji: '⚫' },
  { value: 'pull_up_bar',      label: 'Pull-up Bar',      emoji: '🔩' },
];

const FITNESS_LEVELS = [
  { value: 'beginner',     label: 'Beginner',     desc: 'New to exercise or returning after a long break',  emoji: '🌱' },
  { value: 'intermediate', label: 'Intermediate', desc: 'Exercise regularly, familiar with most movements', emoji: '⚡' },
  { value: 'advanced',     label: 'Advanced',     desc: 'Train consistently and looking to push limits',    emoji: '🔥' },
];

const SESSION_DURATIONS = [
  { value: 15, label: '15 min', desc: 'Quick session' },
  { value: 30, label: '30 min', desc: 'Standard'      },
  { value: 45, label: '45 min', desc: 'Extended'      },
  { value: 60, label: '60 min', desc: 'Full workout'  },
  { value: 90, label: '90 min', desc: 'Intensive'     },
];

const WORKOUT_TIMES = [
  { value: 'morning',   label: 'Morning',   emoji: '🌅', desc: '5am – 12pm' },
  { value: 'afternoon', label: 'Afternoon', emoji: '☀️', desc: '12pm – 5pm' },
  { value: 'evening',   label: 'Evening',   emoji: '🌙', desc: '5pm – 10pm' },
];

function MultiSelectCard({ item, selected, onToggle }) {
  const isSelected = selected.includes(item.value);
  return (
    <button
      onClick={() => onToggle(item.value)}
      className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all duration-200 text-left w-full
                 ${isSelected
                   ? 'border-primary-500 bg-primary-500/10'
                   : 'border-white/10 bg-dark-100 hover:border-white/20'
                 }`}
    >
      <span className="text-2xl">{item.emoji}</span>
      <div className="flex-1 min-w-0">
        <p className={`font-medium text-sm ${isSelected ? 'text-white' : 'text-gray-300'}`}>
          {item.label}
        </p>
        {item.desc && (
          <p className="text-gray-500 text-xs mt-0.5 truncate">{item.desc}</p>
        )}
      </div>
      {isSelected && (
        <div className="w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center flex-shrink-0">
          <Check className="w-3 h-3 text-white" />
        </div>
      )}
    </button>
  );
}

function SingleSelectCard({ item, selected, onSelect }) {
  const isSelected = selected === item.value;
  return (
    <button
      onClick={() => onSelect(item.value)}
      className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all duration-200 text-left w-full
                 ${isSelected
                   ? 'border-primary-500 bg-primary-500/10'
                   : 'border-white/10 bg-dark-100 hover:border-white/20'
                 }`}
    >
      <span className="text-2xl">{item.emoji}</span>
      <div className="flex-1">
        <p className={`font-medium text-sm ${isSelected ? 'text-white' : 'text-gray-300'}`}>
          {item.label}
        </p>
        {item.desc && (
          <p className="text-gray-500 text-xs mt-0.5">{item.desc}</p>
        )}
      </div>
      {isSelected && (
        <div className="w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center flex-shrink-0">
          <Check className="w-3 h-3 text-white" />
        </div>
      )}
    </button>
  );
}

function NumberInput({ label, value, onChange, min, max, unit, placeholder }) {
  return (
    <div>
      <label className="block text-sm mb-2">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          min={min}
          max={max}
          placeholder={placeholder}
          className="input-field flex-1"
        />
        {unit && (
          <div className="bg-dark-100 border border-white/10 rounded-xl px-4 flex items-center text-gray-400 text-sm flex-shrink-0">
            {unit}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Onboarding() {
  const navigate       = useNavigate();
  const { updateUser } = useAuth();

  const [step,    setStep]    = useState(1);
  const [loading, setLoading] = useState(false);
  const [direction, setDirection] = useState(1);

  const [formData, setFormData] = useState({
    age:                  '',
    gender:               '',
    heightValue:          '',
    heightUnit:           'cm',
    weightValue:          '',
    weightUnit:           'kg',
    targetWeightValue:    '',
    fitnessLevel:         '',
    exerciseFrequency:    3,
    medicalConditions:    '',
    fitnessGoals:         [],
    availableEquipment:   [],
    sessionDuration:      30,
    preferredWorkoutTime: 'morning',
  });

  const update = (field, value) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const toggleMulti = (field, value) => {
    setFormData((prev) => {
      const arr = prev[field];
      return {
        ...prev,
        [field]: arr.includes(value)
          ? arr.filter((v) => v !== value)
          : [...arr, value],
      };
    });
  };

  const goNext = () => {
    if (!validateStep()) return;
    setDirection(1);
    setStep((s) => Math.min(s + 1, STEPS.length));
  };

  const goBack = () => {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 1));
  };

  const validateStep = () => {
    switch (step) {
      case 1:
        if (!formData.age || !formData.gender ||
            !formData.heightValue || !formData.weightValue) {
          toast.error('Please fill in all required fields');
          return false;
        }
        if (formData.age < 13 || formData.age > 100) {
          toast.error('Please enter a valid age (13-100)');
          return false;
        }
        return true;
      case 2:
        if (!formData.fitnessLevel) {
          toast.error('Please select your fitness level');
          return false;
        }
        return true;
      case 3:
        if (formData.fitnessGoals.length === 0) {
          toast.error('Please select at least one goal');
          return false;
        }
        return true;
      default:
        return true;
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const payload = {
        age:    parseInt(formData.age),
        gender: formData.gender,
        height: { value: parseFloat(formData.heightValue), unit: formData.heightUnit },
        weight: { value: parseFloat(formData.weightValue), unit: formData.weightUnit },
        ...(formData.targetWeightValue && {
          targetWeight: { value: parseFloat(formData.targetWeightValue), unit: formData.weightUnit },
        }),
        fitnessLevel:         formData.fitnessLevel,
        exerciseFrequency:    formData.exerciseFrequency,
        medicalConditions:    formData.medicalConditions,
        fitnessGoals:         formData.fitnessGoals,
        availableEquipment:   formData.availableEquipment,
        sessionDuration:      formData.sessionDuration,
        preferredWorkoutTime: formData.preferredWorkoutTime,
      };

      const res = await userService.completeOnboarding(payload);
      updateUser({ onboardingCompleted: true, ...res.data.user });
      toast.success('Profile set up! Let\'s get started 💪');
      navigate('/dashboard');
    } catch (err) {
      console.error(err);
      toast.error('Failed to save profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderStep = () => {
    switch (step) {

      case 1:
        return (
          <div className="space-y-5">
            <NumberInput
              label="Age *"
              value={formData.age}
              onChange={(v) => update('age', v)}
              min={13} max={100}
              placeholder="25"
              unit="years"
            />

            <div>
              <label className="block text-sm mb-3">Gender *</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'male',              label: 'Male',              emoji: '♂️' },
                  { value: 'female',            label: 'Female',            emoji: '♀️' },
                  { value: 'other',             label: 'Other',             emoji: '⚧️' },
                  { value: 'prefer_not_to_say', label: 'Prefer not to say', emoji: '🔒' },
                ].map((g) => (
                  <button
                    key={g.value}
                    onClick={() => update('gender', g.value)}
                    className={`flex items-center gap-2 p-3 rounded-xl border-2 transition-all text-sm font-medium
                               ${formData.gender === g.value
                                 ? 'border-primary-500 bg-primary-500/10 text-white'
                                 : 'border-white/10 bg-dark-100 text-gray-300 hover:border-white/20'
                               }`}
                  >
                    <span>{g.emoji}</span> {g.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm mb-2">Height *</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={formData.heightValue}
                  onChange={(e) => update('heightValue', e.target.value)}
                  placeholder={formData.heightUnit === 'cm' ? '175' : '5.9'}
                  className="input-field flex-1"
                />
                <select
                  value={formData.heightUnit}
                  onChange={(e) => update('heightUnit', e.target.value)}
                  className="bg-dark-100 border border-white/10 rounded-xl px-3 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="cm">cm</option>
                  <option value="ft">ft</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm mb-2">Current Weight *</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={formData.weightValue}
                  onChange={(e) => update('weightValue', e.target.value)}
                  placeholder={formData.weightUnit === 'kg' ? '70' : '154'}
                  className="input-field flex-1"
                />
                <select
                  value={formData.weightUnit}
                  onChange={(e) => update('weightUnit', e.target.value)}
                  className="bg-dark-100 border border-white/10 rounded-xl px-3 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="kg">kg</option>
                  <option value="lbs">lbs</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm mb-2">
                Target Weight
                <span className="text-gray-500 font-normal ml-1">(optional)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={formData.targetWeightValue}
                  onChange={(e) => update('targetWeightValue', e.target.value)}
                  placeholder={formData.weightUnit === 'kg' ? '65' : '143'}
                  className="input-field flex-1"
                />
                <div className="bg-dark-100 border border-white/10 rounded-xl px-4 flex items-center text-gray-400 text-sm">
                  {formData.weightUnit}
                </div>
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <div>
              <p className="text-gray-400 text-sm mb-3">
                Select the option that best describes you:
              </p>
              <div className="space-y-3">
                {FITNESS_LEVELS.map((level) => (
                  <SingleSelectCard
                    key={level.value}
                    item={level}
                    selected={formData.fitnessLevel}
                    onSelect={(v) => update('fitnessLevel', v)}
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm mb-3">
                How often do you exercise per week?
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <button
                    key={n}
                    onClick={() => update('exerciseFrequency', n)}
                    className={`flex-1 py-3 rounded-xl border-2 font-bold transition-all text-sm
                               ${formData.exerciseFrequency === n
                                 ? 'border-primary-500 bg-primary-500/10 text-white'
                                 : 'border-white/10 bg-dark-100 text-gray-400 hover:border-white/20'
                               }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-gray-500 text-xs mt-2 text-center">
                {formData.exerciseFrequency} day{formData.exerciseFrequency !== 1 ? 's' : ''} per week
              </p>
            </div>

            <div>
              <label className="block text-sm mb-2">
                Any injuries or medical conditions?
                <span className="text-gray-500 font-normal ml-1">(optional)</span>
              </label>
              <textarea
                value={formData.medicalConditions}
                onChange={(e) => update('medicalConditions', e.target.value)}
                placeholder="e.g. Lower back pain, knee injury, asthma..."
                rows={3}
                className="input-field resize-none"
              />
              <p className="text-gray-500 text-xs mt-1">
                This helps us avoid exercises that may aggravate your condition
              </p>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-3">
            <p className="text-gray-400 text-sm">
              Select all that apply — you can have multiple goals:
            </p>
            {FITNESS_GOALS.map((goal) => (
              <MultiSelectCard
                key={goal.value}
                item={goal}
                selected={formData.fitnessGoals}
                onToggle={(v) => toggleMulti('fitnessGoals', v)}
              />
            ))}
          </div>
        );

      case 4:
        return (
          <div className="space-y-3">
            <p className="text-gray-400 text-sm">
              Select all equipment you have access to:
            </p>
            {EQUIPMENT_OPTIONS.map((eq) => (
              <MultiSelectCard
                key={eq.value}
                item={eq}
                selected={formData.availableEquipment}
                onToggle={(v) => toggleMulti('availableEquipment', v)}
              />
            ))}
            <div className="bg-dark-100 border border-white/5 rounded-2xl p-4 mt-2">
              <p className="text-gray-400 text-xs leading-relaxed">
                💡 Don't worry if you don't have equipment — our bodyweight exercises are just as effective and all 58 exercises work without any equipment.
              </p>
            </div>
          </div>
        );

      case 5:
        return (
          <div className="space-y-6">
            <div>
              <label className="block text-sm mb-3">
                How long can you train per session?
              </label>
              <div className="grid grid-cols-3 gap-2">
                {SESSION_DURATIONS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => update('sessionDuration', d.value)}
                    className={`p-3 rounded-xl border-2 transition-all text-center
                               ${formData.sessionDuration === d.value
                                 ? 'border-primary-500 bg-primary-500/10'
                                 : 'border-white/10 bg-dark-100 hover:border-white/20'
                               }`}
                  >
                    <p className={`font-bold text-sm ${formData.sessionDuration === d.value ? 'text-white' : 'text-gray-300'}`}>
                      {d.label}
                    </p>
                    <p className="text-gray-500 text-xs mt-0.5">{d.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm mb-3">
                When do you prefer to workout?
              </label>
              <div className="space-y-2">
                {WORKOUT_TIMES.map((t) => (
                  <SingleSelectCard
                    key={t.value}
                    item={t}
                    selected={formData.preferredWorkoutTime}
                    onSelect={(v) => update('preferredWorkoutTime', v)}
                  />
                ))}
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const currentStepInfo = STEPS[step - 1];
  const StepIcon        = currentStepInfo.icon;
  const progress        = ((step - 1) / (STEPS.length - 1)) * 100;

  return (
    <div className="onboarding-page min-h-screen flex flex-col relative" style={{ background: '#0A0908' }}>

      {/* ── Vitruvian Man watermark ────────────────────────────────────────── */}
      <div className="fixed inset-0 z-0 pointer-events-none flex items-center justify-center">
        <div
          style={{
            width:           700,
            height:          700,
            backgroundImage:    "url('/images/exercises/exercisebackground2.jpg')",
            backgroundSize:     'contain',
            backgroundRepeat:   'no-repeat',
            backgroundPosition: 'center center',
            opacity:         0.52,
            maskImage:       'radial-gradient(ellipse 45% 60% at 50% 50%, black 30%, transparent 78%)',
            WebkitMaskImage: 'radial-gradient(ellipse 45% 60% at 50% 50%, black 30%, transparent 78%)',
            filter:          'drop-shadow(0 0 60px rgba(255,180,80,0.45)) drop-shadow(0 0 120px rgba(255,138,31,0.25))',
          }}
        />
      </div>

      <div className="relative z-10 flex flex-col flex-1">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div
          className="border-b border-white/5 px-6 py-3"
          style={{
            background:           'rgba(13,12,11,0.55)',
            backdropFilter:       'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
          }}
        >
          <div className="max-w-lg mx-auto">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-gray-500 text-xs whitespace-nowrap">
                Step {step} of {STEPS.length}
              </span>
              <div className="flex-1 h-1.5 bg-dark-300 rounded-full overflow-hidden">
                <motion.div
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.4 }}
                  className="h-full bg-primary-600 rounded-full"
                />
              </div>
              <span className="text-primary-400 text-xs font-medium whitespace-nowrap">
                {Math.round(progress)}%
              </span>
            </div>

            <div className="flex justify-between">
              {STEPS.map((s) => (
                <div key={s.id} className="flex flex-col items-center gap-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all
                                  ${s.id < step
                                    ? 'bg-green-500'
                                    : s.id === step
                                      ? 'bg-primary-600'
                                      : 'bg-dark-300'
                                  }`}>
                    {s.id < step
                      ? <Check className="w-4 h-4 text-white" />
                      : <s.icon className="w-4 h-4 text-white/60" />
                    }
                  </div>
                  <span className={`text-xs hidden sm:block ${s.id === step ? 'text-primary-400' : 'text-gray-600'}`}>
                    {s.title}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-lg mx-auto px-6 py-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-primary-500/20 rounded-2xl flex items-center justify-center flex-shrink-0">
                <StepIcon className="w-6 h-6 text-primary-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">
                  {currentStepInfo.title}
                </h2>
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)', textShadow: '0 1px 6px rgba(0,0,0,0.8)' }}>
                  {currentStepInfo.desc}
                </p>
              </div>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: direction * 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -40 }}
                transition={{ duration: 0.25 }}
              >
                {renderStep()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div
          className="border-t border-white/5 px-6 py-3 flex-shrink-0"
          style={{
            background:           'rgba(13,12,11,0.55)',
            backdropFilter:       'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
          }}
        >
          <div className="max-w-lg mx-auto flex gap-3">
            {step > 1 && (
              <button
                onClick={goBack}
                className="btn-secondary flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
            )}

            {step < STEPS.length ? (
              <button
                onClick={goNext}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                Continue
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Check className="w-5 h-5" />
                    Complete Setup
                  </>
                )}
              </button>
            )}
          </div>

          {step === 1 && (
            <div className="max-w-lg mx-auto text-center mt-2">
              <button
                onClick={() => navigate('/dashboard')}
                className="text-gray-500 text-sm hover:text-gray-400 transition-colors"
              >
                Skip for now
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
