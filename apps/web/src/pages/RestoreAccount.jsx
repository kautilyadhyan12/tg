import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Dumbbell, ArrowLeft, Check, Undo2 } from 'lucide-react';
import { authService } from '../api/authApi';

// THE UNDO PAGE for account deletion (Part 4 §5.2's 14-day undo). The email
// sent at Day 0 carries one link here with a one-time token in the query.
// There is NO session on this page — the account is deleted, so nobody is
// signed in — and the token alone is the proof. Pressing the button is what
// restores; landing on the page does nothing, so a mail client that prefetches
// links cannot undo a deletion by accident.
export default function RestoreAccount() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [state, setState] = useState('ready'); // ready | working | done | failed
  const [problem, setProblem] = useState('');

  const restore = async () => {
    setState('working');
    setProblem('');
    try {
      await authService.restoreAccount(token);
      setState('done');
    } catch (err) {
      setProblem(err?.response?.data?.message || 'This link did not work. It may have expired.');
      setState('failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#0A0908' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{ background: 'linear-gradient(135deg, #FF8A1F, #FFB347)', boxShadow: '0 0 30px rgba(255,138,31,0.35)' }}
          >
            <Dumbbell className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">
            {state === 'done' ? 'Your account is back' : 'Keep your account?'}
          </h1>
        </div>

        <div className="card space-y-5">
          {state === 'done' ? (
            <>
              <p className="text-gray-300 flex items-start gap-2">
                <Check className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: '#4ade80' }} />
                Your account and everything in it are exactly as you left them. Sign in to continue.
              </p>
              <Link to="/login" className="btn-primary w-full inline-block text-center">
                Sign in
              </Link>
            </>
          ) : (
            <>
              <p className="text-gray-300">
                You asked us to delete your account. If you have changed your mind, press the button
                and it will be restored with everything in it.
              </p>
              {!token && (
                <p role="alert" className="text-sm" style={{ color: '#f87171' }}>
                  This link is missing its token. Open the link from the email again.
                </p>
              )}
              {problem && (
                <p role="alert" className="text-sm" style={{ color: '#f87171' }}>{problem}</p>
              )}
              <button
                type="button"
                onClick={restore}
                disabled={!token || state === 'working'}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                <Undo2 className="w-4 h-4" />
                {state === 'working' ? 'Restoring…' : 'Restore my account'}
              </button>
              <p className="text-xs text-center" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Nothing happens until you press the button. If you do want the account deleted, just
                close this page.
              </p>
            </>
          )}

          <div className="text-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
            >
              <ArrowLeft size={16} /> Back to Get started
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
