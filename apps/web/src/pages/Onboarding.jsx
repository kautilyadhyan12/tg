// Onboarding v2, screens 1–9 and 11 (ROADMAP Stage 1 items 4a-ii, 4b-i and
// 4b-ii; RULINGS 2026-09-07, 2026-09-09 and 2026-09-10): goal · about you ·
// target · your day · your training · your week · equipment · health · food ·
// your code. Every answer is saved the moment it is given, and the server's
// plan number sits on every screen from the moment it exists. Screen 10
// (running) and screen 12 (your plan) follow.
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Clock, Dumbbell, HeartPulse, LogOut, Sun, Target, Ticket, TrendingDown, User, Utensils, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { consentService } from '../api/healthApi';
import { errorText } from '../api/orgsApi';
import PlanPanel from './onboarding/PlanPanel';
import { forgetJoinCode, readJoinCode } from './landingRoute';
import {
  AboutScreen,
  CodeScreen,
  DayScreen,
  EquipmentScreen,
  FoodScreen,
  GoalScreen,
  HealthScreen,
  TargetScreen,
  TrainingScreen,
  WeekScreen,
} from './onboarding/OnboardingScreens';
import { useHealthScreening } from './onboarding/useHealthScreening';
import { useOnboardingAnswers } from './onboarding/useOnboardingAnswers';
import {
  SCREENS,
  SCREEN_OF_MISSING,
  cleanEquipment,
  defaultUnits,
  directionOf,
  firstOpenScreen,
  missingText,
  openSetupAnswers,
  reachableScreens,
  screenAnswered,
  visibleScreens,
} from './onboarding/onboardingModel';

const ICONS = {
  goal: Target,
  about: User,
  target: TrendingDown,
  day: Sun,
  training: Zap,
  week: Clock,
  equipment: Dumbbell,
  health: HeartPulse,
  food: Utensils,
  code: Ticket,
};

const SCREEN_VIEWS = {
  goal: GoalScreen,
  about: AboutScreen,
  target: TargetScreen,
  day: DayScreen,
  training: TrainingScreen,
  week: WeekScreen,
  equipment: EquipmentScreen,
  health: HealthScreen,
  food: FoodScreen,
  code: CodeScreen,
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

  // A code from a poster link (ROADMAP 4b-ii-b; Kd, 2026-09-13): someone not yet
  // set up meets "Your code" FIRST, the code in its box, and asks to join before
  // the questions. The order is fixed for this visit, so sending the code never
  // moves the screen they are on; once sent, the code is forgotten and a return
  // to that screen finds the box empty.
  const [posterCode, setPosterCode] = useState(() => (finished ? null : readJoinCode()));
  const [codeFirst] = useState(() => posterCode !== null);
  const order = { codeFirst };
  const poster = {
    code: posterCode,
    sent: () => {
      forgetJoinCode();
      setPosterCode(null);
    },
  };

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

  // The rest of the app (the sidebar, the dashboard's greeting) calls the
  // person by the name the server holds, so a name saved here reaches it the
  // moment its save lands, whichever way they then leave this page.
  const ob = useOnboardingAnswers({
    onSaved: (saved) => {
      if (typeof saved.displayName === 'string' && saved.displayName !== user?.displayName) {
        updateUser({ displayName: saved.displayName });
      }
    },
  });
  const [picked, setPicked] = useState(null); // null: where the person landed
  const [nameDraft, setNameDraft] = useState(null); // the name box's text while it differs from the saved name
  const [nameError, setNameError] = useState(null);
  const [units, setUnits] = useState(() => defaultUnits(typeof navigator === 'undefined' ? undefined : navigator.language));
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(null); // the questions a refused finish named

  // Screen 8's answer, on its own route (4b-i), and the disclaimer tap that
  // goes with it. The tap is recorded the moment it is made, so the consent log
  // holds it whether or not the person goes on to finish.
  const hs = useHealthScreening();
  const [agreed, setAgreed] = useState(false);
  const [agreeing, setAgreeing] = useState(false);

  const health = {
    screening: hs.screening,
    // No health answer while one is already on its way — AND none while the
    // page is waiting (`busy`). A finish is the wait that matters: one the
    // server refuses over this question forgets what the screen holds, so an
    // answer given in that window would be saved and then forgotten. Since
    // Finish moved to the last screen the question is never on show during a
    // finish (the way back is held too); it is during a Continue or a jump
    // waiting on the saves, where a Yes tapped would be left half-given as the
    // page moves on.
    saving: hs.saving || busy,
    agreed,
    agreeing,
    /** A health answer moves the daily number (any yes stops the calorie cut),
     *  so the plan is re-read the moment one lands — through the same save
     *  queue the taps use, whose empty body simply re-reads it. A refusal that
     *  named this question has just been answered, so its name goes with the
     *  answer; anything else that refusal named still stands. */
    answer: async (body) => {
      if (!(await hs.save(body))) return;
      setRefused((named) => (named === null ? null : named.filter((k) => k !== 'health')));
      ob.save({});
    },
    agree: async () => {
      setAgreeing(true);
      try {
        await consentService.record('health_step');
        setAgreed(true);
      } catch (err) {
        toast.error(errorText(err, "Couldn't record that just now. Please try again."));
      } finally {
        setAgreeing(false);
      }
    },
  };

  // The wizard's answers with the health one laid beside them: screen 8 is a
  // step like any other to the step bar, the landing rule and the finish rule,
  // and only this page knows the two come from two routes.
  const answers = { ...ob.answers, health: hs.screening };

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

  // Both loads have to land before the person is put on a screen: landing on
  // the first open one means nothing while half the answers are still unknown.
  // Either one failing is the same to the person — the page cannot be shown,
  // and "Try again" retries the one that failed.
  const loaded = ob.first !== null && hs.first !== null;
  const failure =
    ob.status === 'failed'
      ? { text: ob.error, retry: ob.retry }
      : hs.status === 'failed'
        ? { text: hs.error, retry: hs.retry }
        : null;
  const screens = visibleScreens(answers, order);
  const landing = () => (codeFirst ? 'code' : firstOpenScreen({ ...ob.first, health: hs.first }));
  const current = picked ?? (loaded ? landing() : SCREENS[0].id);
  const index = Math.max(0, screens.findIndex((s) => s.id === current));
  const screen = screens[index];
  const isLast = index === screens.length - 1;
  const direction = directionOf(answers.weightGoal);
  const answered = screenAnswered(screen.id, answers);
  const reachable = reachableScreens(answers, order);

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
    if (!saved) return;
    // From "Your code" at the front, on to the first question still open: where
    // this person would have landed without a poster.
    goTo(codeFirst && screen.id === 'code' ? firstOpenScreen(answers, order) : screens[index + 1].id);
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
      // A poster's code still unsent at the finish was left unsent on purpose.
      forgetJoinCode();
      // The name the rest of the app greets the person by is the one saved here.
      updateUser({ onboardingCompleted: true, displayName: result.answers.displayName });
      toast.success("You're all set. Let's train.");
      // Everyone here came through the member door, heading for the member
      // app — or back to the screen in it that sent them here.
      navigate(returnTo);
      return;
    }
    if (result.missing) {
      setRefused(result.missing);
      // The server holds no health answer, whatever this screen believes it
      // holds: the screen's copy is stale (a reset on another device), so it
      // goes with the refusal. Without this the question shows the old answer
      // as chosen and tapping it again saves nothing — the screen would ask
      // for something it will not let the person give.
      if (result.missing.includes('health')) hs.forget();
    }
  };

  // What still stands between the person and Finish, in the server's words.
  // The plan's own list never names the health question or screen 9's two food
  // answers — a plan is a number and is worked out without all three — so the
  // ones this screen can see are still open are added here, in the words the
  // server's own refusal would use.
  const serverOpen = refused ?? (ob.plan === null ? ob.missing : []);
  const open = openSetupAnswers(serverOpen, answers);
  const openScreens = [...new Set(open.map((k) => SCREEN_OF_MISSING[k]).filter(Boolean))];
  // The disclaimer tap is made on screen 8 and Finish is on the last screen
  // (screen 11 since 4b-ii), so the one thing holding Finish can now be two
  // screens back. It is named where Finish is, with the way to it, exactly as
  // an unanswered question is — otherwise the button is simply dead and the
  // reason is somewhere the person is not looking.
  const toAnswer = [...new Set([...openScreens, ...(agreed ? [] : ['health'])])].filter((id) => id !== screen.id);
  // The disclaimer tap is the person's own act on this screen, not an answer
  // the server holds, so it gates Finish here. `hs.saving` is waited for as
  // `busy` waits for the answers' queue: a health answer shows the moment it is
  // tapped, so without it a Finish pressed straight after the tap can reach the
  // server before the answer does and come back "answer the health question"
  // to somebody who just did.
  const canFinish = answered && open.length === 0 && agreed && !busy && !hs.saving;

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
            {!loaded && failure !== null && (
              <div className="card-glass text-center space-y-4">
                <p className="text-sm">{failure.text}</p>
                <button type="button" onClick={failure.retry} className="btn-primary">
                  Try again
                </button>
              </div>
            )}
            {!loaded && failure === null && <Spinner />}
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
                    health={health}
                    poster={poster}
                  />
                </motion.div>

                {isLast && (open.length > 0 || !agreed) && (
                  <div role="status" className="card-glass mt-6 space-y-3">
                    {open.length > 0 && <p className="text-sm">Before you finish, answer {missingText(open)}.</p>}
                    {!agreed && <p className="text-sm">Read the note on the Health screen and tick it.</p>}
                    <div className="flex flex-wrap gap-2">
                      {toAnswer.map((id) => (
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
                <button
                  type="button"
                  onClick={goBack}
                  // Held while a finish is out, as the step bar and Continue
                  // are. A finish the server refuses over the health question
                  // forgets the answer this wizard holds, so walking back to
                  // that question mid-finish is a way to give an answer the
                  // refusal would then forget (4b-i's window, reopened when
                  // 4b-ii moved Finish two screens on from the question).
                  disabled={busy}
                  className="btn-secondary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
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
