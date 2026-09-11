// Onboarding v2, screens 1–7 (ROADMAP Stage 1 item 4a-ii; RULINGS 2026-09-07
// and 2026-09-09): goal · about you · target · your day · your training ·
// your week · equipment. Every answer is saved the moment it is given, and the
// server's plan number sits on every screen from the moment it exists.
// Screens 8–12 (health, food, running, code, your plan) follow in 4b and 4c.
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Clock, Dumbbell, LogOut, Sun, Target, TrendingDown, User, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import PlanPanel from './onboarding/PlanPanel';
import {
  AboutScreen,
  DayScreen,
  EquipmentScreen,
  GoalScreen,
  TargetScreen,
  TrainingScreen,
  WeekScreen,
} from './onboarding/OnboardingScreens';
import { useOnboardingAnswers } from './onboarding/useOnboardingAnswers';
import {
  SCREENS,
  SCREEN_OF_MISSING,
  cleanEquipment,
  defaultUnits,
  directionOf,
  firstOpenScreen,
  missingText,
  reachableScreens,
  screenAnswered,
  visibleScreens,
} from './onboarding/onboardingModel';

const ICONS = { goal: Target, about: User, target: TrendingDown, day: Sun, training: Zap, week: Clock, equipment: Dumbbell };

const SCREEN_VIEWS = {
  goal: GoalScreen,
  about: AboutScreen,
  target: TargetScreen,
  day: DayScreen,
  training: TrainingScreen,
  week: WeekScreen,
  equipment: EquipmentScreen,
};

const NAME_NEEDED = 'Type the name we should call you.';

/** Where a person sent here from elsewhere in the app goes back to (the macro
 *  rings' "Answer now", ROADMAP 4a-iii). Anything else is the dashboard: a
 *  value in the page's state is never followed as an address. */
const RETURN_TO = new Set(['/nutrition']);

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div
        className="w-8 h-8 border-2 rounded-full animate-spin"
        style={{ borderColor: 'rgba(255,138,31,0.2)', borderTopColor: '#FF8A1F' }}
      />
    </div>
  );
}

export default function Onboarding() {
  const navigate                     = useNavigate();
  const location                     = useLocation();
  const { user, updateUser, logout } = useAuth();

  // Someone who already finished setup, sent back here to answer a question
  // the plan still needs, is not locked in until they finish again: "Back to
  // the app" sits beside Sign out for them.
  const finished = user?.onboardingCompleted === true;
  const returnTo = RETURN_TO.has(location.state?.returnTo) ? location.state.returnTo : '/dashboard';

  // Sign out, for everyone, and THE ONLY WAY OUT OF THIS SCREEN WITHOUT
  // FINISHING IT for someone who has not (Kd, 2026-08-19). `ProtectedRoute`
  // sends every un-onboarded account here and the wizard has no sidebar, so a
  // person who picked the wrong door, or wants to stop, needs this. It is NOT
  // a skip: it ends the session and returns to the login page, so the gate is
  // untouched. A separate flag from the wizard's own `busy`,
  // because the two waits mean opposite things: one is saving the answers,
  // the other is leaving them.
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await logout();
    navigate('/login');
  };

  const ob = useOnboardingAnswers();
  const [picked, setPicked] = useState(null); // null: where the person landed
  const [nameDraft, setNameDraft] = useState(null); // the name box's text while it differs from the saved name
  const [nameError, setNameError] = useState(null);
  const [units, setUnits] = useState(() => defaultUnits(typeof navigator === 'undefined' ? undefined : navigator.language));
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(null); // the questions a refused finish named

  const answers = ob.answers;

  /** The name box saves when the person leaves it. A name is never blank: an
   *  empty box says so and saves nothing. */
  const commitName = () => {
    if (nameDraft === null) return true;
    const trimmed = nameDraft.trim();
    if (trimmed === '') {
      setNameError(NAME_NEEDED);
      return false;
    }
    setNameDraft(null);
    if (trimmed !== answers.displayName) ob.save({ displayName: trimmed });
    return true;
  };

  const name = {
    text: nameDraft ?? answers.displayName ?? '',
    error: nameError,
    change: (text) => {
      setNameDraft(text);
      setNameError(null);
    },
    commit: commitName,
  };

  const loaded = ob.first !== null;
  const screens = visibleScreens(answers);
  const current = picked ?? (loaded ? firstOpenScreen(ob.first) : SCREENS[0].id);
  const index = Math.max(0, screens.findIndex((s) => s.id === current));
  const screen = screens[index];
  const isLast = index === screens.length - 1;
  const direction = directionOf(answers.mainGoal);
  const answered = screenAnswered(screen.id, answers);
  const reachable = reachableScreens(answers);

  /** Leaving a screen forward first saves its typed box, if it has one. */
  const leave = () => (screen.id === 'about' ? commitName() : true);

  const goTo = (id) => {
    setPicked(id);
    setRefused(null);
  };

  const goNext = async () => {
    if (!leave()) return;
    setBusy(true);
    const saved = await ob.settled();
    setBusy(false);
    if (saved) goTo(screens[index + 1].id);
  };

  const goBack = () => {
    if (index > 0) goTo(screens[index - 1].id);
  };

  /** Back to the app for someone who already finished: the name box is saved
   *  as leaving a screen saves it, then every save is waited for. A blank name
   *  or a save that failed keeps them here, where its message is. */
  const backToApp = async () => {
    if (!leave()) return;
    setBusy(true);
    const saved = await ob.settled();
    setBusy(false);
    if (saved) navigate(returnTo);
  };

  /** The step bar (Kd, 2026-09-10): straight back to any screen, or forward to
   *  one already reached. Going forward saves the screen being left and waits
   *  for its saves, exactly as Continue does. */
  const jumpTo = async (id, target) => {
    if (target > index) {
      if (!leave()) return;
      setBusy(true);
      const saved = await ob.settled();
      setBusy(false);
      if (!saved) return;
    }
    goTo(id);
  };

  const finish = async () => {
    setBusy(true);
    const result = await ob.finish({ availableEquipment: cleanEquipment(answers.availableEquipment) });
    setBusy(false);
    if (result.ok) {
      // The name the rest of the app greets the person by is the one saved here.
      updateUser({ onboardingCompleted: true, displayName: result.answers.displayName });
      toast.success("You're all set. Let's train.");
      // Everyone here came through the member door, heading for the member
      // app — or back to the screen in it that sent them here.
      navigate(returnTo);
      return;
    }
    if (result.missing) setRefused(result.missing);
  };

  // What still stands between the person and Finish, in the server's words.
  const open = refused ?? (ob.plan === null ? ob.missing : []);
  const openScreens = [...new Set(open.map((k) => SCREEN_OF_MISSING[k]).filter(Boolean))];
  const canFinish = answered && open.length === 0 && !busy;

  const View = SCREEN_VIEWS[screen.id];
  const StepIcon = ICONS[screen.id];
  const progress = screens.length > 1 ? (index / (screens.length - 1)) * 100 : 100;

  return (
    <div className="onboarding-page min-h-screen flex flex-col relative" style={{ background: '#0A0908' }}>
      {/* ── Vitruvian Man watermark ────────────────────────────────────────── */}
      <div className="fixed inset-0 z-0 pointer-events-none flex items-center justify-center">
        <div
          style={{
            width: 700,
            height: 700,
            backgroundImage: "url('/images/exercises/exercisebackground2.jpg')",
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center center',
            opacity: 0.52,
            maskImage: 'radial-gradient(ellipse 45% 60% at 50% 50%, black 30%, transparent 78%)',
            WebkitMaskImage: 'radial-gradient(ellipse 45% 60% at 50% 50%, black 30%, transparent 78%)',
            filter: 'drop-shadow(0 0 60px rgba(255,180,80,0.45)) drop-shadow(0 0 120px rgba(255,138,31,0.25))',
          }}
        />
      </div>

      <div className="relative z-10 flex flex-col flex-1">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div
          className="border-b border-white/5 px-6 py-3"
          style={{ background: 'rgba(13,12,11,0.55)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}
        >
          <div className="max-w-lg mx-auto">
            <div className="flex justify-end gap-4 mb-2">
              {finished && (
                <button
                  type="button"
                  onClick={backToApp}
                  disabled={busy}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to the app
                </button>
              )}
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
            {loaded && (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-gray-500 text-xs whitespace-nowrap">
                    Step {index + 1} of {screens.length}
                  </span>
                  <div className="flex-1 h-1.5 bg-dark-300 rounded-full overflow-hidden">
                    <motion.div
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.4 }}
                      className="h-full bg-primary-600 rounded-full"
                    />
                  </div>
                </div>
                <nav aria-label="Steps" className="flex justify-between">
                  {screens.map((s, i) => {
                    const Icon = ICONS[s.id];
                    const here = i === index;
                    const done = !here && screenAnswered(s.id, answers);
                    const open = reachable.has(s.id);
                    return (
                      <button
                        key={`step-${s.id}`}
                        type="button"
                        aria-label={s.title}
                        title={s.title}
                        aria-current={here ? 'step' : undefined}
                        disabled={here || busy || !open}
                        onClick={() => jumpTo(s.id, i)}
                        className={`flex flex-col items-center gap-1 disabled:cursor-default enabled:hover:opacity-80 ${
                          open || here ? '' : 'opacity-40'
                        }`}
                      >
                        <span
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                            here ? 'bg-primary-600' : done ? 'bg-green-500' : 'bg-dark-300'
                          }`}
                        >
                          {done ? <Check className="w-4 h-4 text-white" /> : <Icon className="w-4 h-4 text-white/60" />}
                        </span>
                        <span className={`text-xs hidden sm:block ${here ? 'text-primary-400' : 'text-gray-600'}`}>
                          {s.title}
                        </span>
                      </button>
                    );
                  })}
                </nav>
              </>
            )}
          </div>
        </div>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-lg mx-auto px-6 py-8">
            {!loaded && ob.status === 'failed' && (
              <div className="card-glass text-center space-y-4">
                <p className="text-sm">{ob.error}</p>
                <button type="button" onClick={ob.retry} className="btn-primary">
                  Try again
                </button>
              </div>
            )}
            {!loaded && ob.status !== 'failed' && <Spinner />}
            {loaded && (
              <>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 bg-primary-500/20 rounded-2xl flex items-center justify-center flex-shrink-0">
                    <StepIcon className="w-6 h-6 text-primary-400" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">{screen.title}</h2>
                    <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)', textShadow: '0 1px 6px rgba(0,0,0,0.8)' }}>
                      {screen.desc}
                    </p>
                  </div>
                </div>

                <PlanPanel plan={ob.plan} direction={direction} units={units} />

                <motion.div
                  key={`screen-${screen.id}`}
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <View
                    answers={answers}
                    save={ob.save}
                    units={units}
                    setUnits={setUnits}
                    name={name}
                    direction={direction}
                  />
                </motion.div>

                {isLast && open.length > 0 && (
                  <div role="status" className="card-glass mt-6 space-y-3">
                    <p className="text-sm">Before you finish, answer {missingText(open)}.</p>
                    <div className="flex flex-wrap gap-2">
                      {openScreens.map((id) => (
                        <button key={`go-${id}`} type="button" onClick={() => goTo(id)} className="btn-secondary">
                          Go to {SCREENS.find((s) => s.id === id)?.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        {loaded && (
          <div
            className="border-t border-white/5 px-6 py-3 flex-shrink-0"
            style={{ background: 'rgba(13,12,11,0.55)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}
          >
            <div className="max-w-lg mx-auto flex gap-3">
              {index > 0 && (
                <button type="button" onClick={goBack} className="btn-secondary flex items-center gap-2">
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>
              )}
              {isLast ? (
                <button
                  type="button"
                  onClick={finish}
                  disabled={!canFinish}
                  className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check className="w-5 h-5" />
                  Finish setup
                </button>
              ) : (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!answered || busy}
                  className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
