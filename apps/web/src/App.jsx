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
import Running         from './pages/Running';
import RunPlanner      from './pages/RunPlanner';
import ActiveRun       from './pages/ActiveRun';
import RunSummary      from './pages/RunSummary';

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
            {/* Google OAuth (/auth/google/success) deferred to its own web-repoint
                card — the new API has no /v1/auth/google yet (v1 §6.1). */}

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
            <Route path="/workout/summary/:sessionId" element={
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