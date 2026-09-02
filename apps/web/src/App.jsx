import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster }     from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import { TransitionProvider } from './context/TransitionContext';
import { RunProvider } from './context/RunContext';
import RunMiniBar from './components/running/RunMiniBar';
import { ProtectedRoute, PublicRoute } from './components/common/ProtectedRoute';
import AppLayout from './components/common/AppLayout';

// Pages
import Login           from './pages/Login';
import Register        from './pages/Register';
import GoogleAuthSuccess from './pages/GoogleAuthSuccess';
import ForgotPassword  from './pages/ForgotPassword';
import Onboarding      from './pages/Onboarding';
import Dashboard       from './pages/Dashboard';
import ExerciseLibrary from './pages/ExerciseLibrary';
import WorkoutBuilder  from './pages/WorkoutBuilder';
import PreWorkout      from './pages/PreWorkout';
import ActiveWorkout   from './pages/ActiveWorkout';
import PostWorkout     from './pages/PostWorkout';
import Progress        from './pages/Progress';
import Coach           from './pages/Coach';
import Nutrition       from './pages/Nutrition';
import Achievements    from './pages/Achievements';
import Settings        from './pages/Settings';
import JoinGym         from './pages/JoinGym';
import MyGyms          from './pages/MyGyms';
import Running         from './pages/Running';
import RunPlanner      from './pages/RunPlanner';
import ActiveRun       from './pages/ActiveRun';
import RunSummary      from './pages/RunSummary';

// Gym console — its own route group (Part 3 §3.1: `/console/:orgSlug/...`, and
// v1 §4's separate `apps/dashboard` folded into `apps/web` as a route group —
// one deploy, shared auth). It uses ConsoleLayout, NOT AppLayout: the console
// is the surface that has to work on a phone, and AppLayout has no breakpoint.
import ConsoleLayout   from './components/console/ConsoleLayout';
import ConsoleHome     from './pages/console/ConsoleHome';
import NewGym          from './pages/console/NewGym';
import ConsoleOverview from './pages/console/Overview';
import ConsoleMembers  from './pages/console/Members';
import ConsoleSettings from './pages/console/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TransitionProvider>
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: '#1e1e2e',
                color:      '#fff',
                border:     '1px solid rgba(255,255,255,0.1)',
              },
              success: { iconTheme: { primary: '#6366f1', secondary: '#fff' } },
            }}
          />

          <RunProvider>
          <Routes>
            {/* ── Public routes ─────────────────────────────────────────── */}
            <Route path="/login" element={
              <PublicRoute><Login /></PublicRoute>
            } />
            <Route path="/register" element={
              <PublicRoute><Register /></PublicRoute>
            } />
            <Route path="/forgot-password" element={
              <PublicRoute><ForgotPassword /></PublicRoute>
            } />
            {/* Google OAuth landing. Bare route (NOT PublicRoute): the callback
                set the session cookies, so this page reads the restored session
                and routes to onboarding/dashboard itself (web-repoint Google half). */}
            <Route path="/auth/google/success" element={<GoogleAuthSuccess />} />

            {/* ── Onboarding ────────────────────────────────────────────── */}
            <Route path="/onboarding" element={
              <ProtectedRoute requireOnboarding={false}><Onboarding /></ProtectedRoute>
            } />

            {/* ── Workout flow (fullscreen) ─────────────────────────────── */}
            <Route path="/workout/pre" element={
              <ProtectedRoute><PreWorkout /></ProtectedRoute>
            } />
            <Route path="/workout/active" element={
              <ProtectedRoute><ActiveWorkout /></ProtectedRoute>
            } />

            {/* ── Protected routes with sidebar ────────────────────────── */}
            <Route path="/dashboard" element={
              <ProtectedRoute>
                <AppLayout><Dashboard /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/exercises" element={
              <ProtectedRoute>
                <AppLayout><ExerciseLibrary /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/workout/builder" element={
              <ProtectedRoute>
                <AppLayout><WorkoutBuilder /></AppLayout>
              </ProtectedRoute>
            } />
            {/* :workoutId is the CLIENT-generated workout id (the sync key), not
                the old backend's session id — repointed 2026-08-06 with the
                summary itself. The param NAME matters: `useParams` keys by it. */}
            <Route path="/workout/summary/:workoutId" element={
              <ProtectedRoute>
                <AppLayout><PostWorkout /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/progress" element={
              <ProtectedRoute>
                <AppLayout><Progress /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/coach" element={
              <ProtectedRoute>
                <AppLayout><Coach /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/nutrition" element={
              <ProtectedRoute>
                <AppLayout><Nutrition /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/achievements" element={
              <ProtectedRoute>
                <AppLayout><Achievements /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/settings" element={
              <ProtectedRoute>
                <AppLayout><Settings /></AppLayout>
              </ProtectedRoute>
            } />
            {/* MY GYMS — Kd's ruling of 2026-09-02: the section appears in the
                member's own left nav once a gym has APPROVED them, and holds
                the gym-member features (opening times today, attendance).
                A MEMBER SCREEN, not a way into the console: `/console` is
                behind the other door and the 2026-08-19 crossing ruling
                (:11616) is untouched — see the note in `Sidebar.jsx`.
                Reachable by address for anyone signed in, which is why the
                screen has its own "you're not in a gym yet" state rather than
                relying on the nav item being hidden (R3.3's habit: hiding is
                never the enforcement, and here the server refuses the reads). */}
            <Route path="/my-gyms" element={
              <ProtectedRoute>
                <AppLayout><MyGyms /></AppLayout>
              </ProtectedRoute>
            } />
            {/* The address a gym's poster points at — the web twin of Part 6
                §2's `aihg://org/join?code=` deep link, so a QR works in a
                browser and on a phone without two entry paths existing. The
                same panel is inside Settings → Gym, which is where v1 §8 puts
                it ("member enters code at registration or in Settings").
                NOTHING is added to the sidebar: this is a member joining a gym,
                not a way into the gym console (Kd ruling 2026-08-19 shut that
                crossing in both directions). */}
            <Route path="/org/join" element={
              <ProtectedRoute>
                <AppLayout><JoinGym /></AppLayout>
              </ProtectedRoute>
            } />

            {/* ── Running ───────────────────────────────────────────────── */}
            <Route path="/running" element={
              <ProtectedRoute>
                <AppLayout><Running /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/running/plan" element={
              <ProtectedRoute>
                <AppLayout><RunPlanner /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/running/summary/:sessionId" element={
              <ProtectedRoute>
                <AppLayout><RunSummary /></AppLayout>
              </ProtectedRoute>
            } />
            <Route path="/running/active" element={
              <ProtectedRoute><ActiveRun /></ProtectedRoute>
            } />

            {/* ── Gym console ───────────────────────────────────────────── */}
            {/* `/console/new` is declared BEFORE `/console/:orgSlug` so "new"
                is read as the create screen and not as a gym slug.
                Every console route opts OUT of the onboarding requirement (Kd
                amendment, 2026-08-19): the questionnaire collects fitness data
                the console never uses, so a gym owner reaches their business
                screens without it and meets the wizard only on crossing into
                the member app — which ProtectedRoute's default still walls. */}
            <Route path="/console" element={
              <ProtectedRoute requireOnboarding={false}>
                <ConsoleLayout><ConsoleHome /></ConsoleLayout>
              </ProtectedRoute>
            } />
            <Route path="/console/new" element={
              <ProtectedRoute requireOnboarding={false}>
                <ConsoleLayout><NewGym /></ConsoleLayout>
              </ProtectedRoute>
            } />
            <Route path="/console/:orgSlug" element={
              <ProtectedRoute requireOnboarding={false}>
                <ConsoleLayout><ConsoleOverview /></ConsoleLayout>
              </ProtectedRoute>
            } />
            <Route path="/console/:orgSlug/members" element={
              <ProtectedRoute requireOnboarding={false}>
                <ConsoleLayout><ConsoleMembers /></ConsoleLayout>
              </ProtectedRoute>
            } />
            <Route path="/console/:orgSlug/settings" element={
              <ProtectedRoute requireOnboarding={false}>
                <ConsoleLayout><ConsoleSettings /></ConsoleLayout>
              </ProtectedRoute>
            } />

            {/* ── Fallback ──────────────────────────────────────────────── */}
            <Route path="/"  element={<Navigate to="/login" replace />} />
            <Route path="*"  element={<Navigate to="/login" replace />} />
          </Routes>
          <RunMiniBar />
          </RunProvider>
        </TransitionProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}