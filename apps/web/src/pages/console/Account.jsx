import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { ACCOUNT_UNDO_DAYS, ownedGymLine } from '@app/shared';
import { authService } from '../../api/authApi';
import { errorCode, errorText } from '../../api/orgsApi';
import { useAuth } from '../../context/AuthContext';
import { consoleOrgsSnapshot, ensureConsoleOrgs, refreshConsoleOrgsAfterChange, subscribeConsoleOrgs } from './consoleOrgs';
import { handOverPath, leavesOnDelete, namesText, ownedForDelete } from '../deleteOwnerView';

// Your account in the console (19b-ii; Kd, 2026-11-04): where a gym's owner deletes their account,
// signed in as the person who manages the gym; the phone's Delete account sends an owner here. The
// same emailed code and the same server routes as the training side's Settings. A gym's own owner
// is told to make someone else the owner first, with the button to the gym's Staff tab: the server
// refuses to delete an owner, so no gym is left with nobody to run it (Kd's "A", 2026-11-04).

export default function Account() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // The console's one read of the person's places, every one: those they run and those they train at.
  const kept = useSyncExternalStore(subscribeConsoleOrgs, consoleOrgsSnapshot);
  useEffect(() => {
    ensureConsoleOrgs();
  }, []);
  const all = kept.status === 'ready' ? kept.orgs : [];
  const [step, setStep] = useState('closed');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [resent, setResent] = useState(false);

  const owned = ownedForDelete(all);
  const leaves = leavesOnDelete(all);
  const name = user?.displayName || '';
  const email = user?.email || '';

  const open = () => {
    setStep('ask');
    setCode('');
    setProblem(null);
    setResent(false);
    // What the person owns now, as a hand-over may have landed since the console read it.
    refreshConsoleOrgsAfterChange();
  };
  const close = () => {
    setStep('closed');
    setProblem(null);
  };
  const refused = (err) => {
    // A gym the console did not know they own: read again, and the box turns to its owner, which
    // says the server's sentence itself.
    if (errorCode(err) === 'owns_gym') {
      refreshConsoleOrgsAfterChange();
      setStep('ask');
      return;
    }
    setProblem(errorText(err, 'Something went wrong. Please try again.'));
  };
  const sendCode = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setResent(false);
    try {
      await authService.requestDeleteCode();
      setResent(step === 'code');
      setCode('');
      setStep('code');
    } catch (err) {
      refused(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await authService.deleteAccount(code);
      // The server's own words: when it is removed, and whether the undo link was emailed.
      toast.success(res.data?.message ?? 'Account scheduled for deletion.');
      await logout();
      navigate('/login');
    } catch (err) {
      setCode('');
      refused(err);
      setBusy(false);
    }
  };

  return (
    <div className="c-page c-narrow">
      <h1 className="c-h1">Your account</h1>
      {name || email ? (
        <p className="c-s15 c-t2 m-0">
          {name}
          {name && email ? ' · ' : ''}
          {email}
        </p>
      ) : null}

      <section className="c-card" aria-label="Delete account" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 className="c-h2 m-0">Delete account</h2>
        {step === 'closed' ? (
          <>
            <p className="c-s14 c-t2 m-0">
              Deletes your account, your workouts, meals, goals and progress. You have {String(ACCOUNT_UNDO_DAYS)} days to change your mind.
            </p>
            <div>
              <button type="button" onClick={open} className="c-btn c-btn-danger c-btn-lg">
                <Trash2 size={18} aria-hidden="true" />
                Delete account
              </button>
            </div>
          </>
        ) : step === 'ask' && owned.length > 0 ? (
          <div data-testid="owner-first" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {owned.map((gym) => (
              <p key={gym.id} className="c-s15 m-0">
                {ownedGymLine(gym)}
              </p>
            ))}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {owned.map((gym) => (
                <Link key={gym.id} to={handOverPath(gym.slug)} className="c-btn c-btn-p c-btn-lg">
                  {owned.length === 1 ? 'Choose a new owner' : `Choose a new owner for ${gym.name}`}
                </Link>
              ))}
              <button type="button" onClick={close} className="c-btn c-btn-s c-btn-lg">
                Cancel
              </button>
            </div>
          </div>
        ) : step === 'ask' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="c-s15 m-0">
              Your workouts, meals, goals and progress are deleted for good after {String(ACCOUNT_UNDO_DAYS)} days. Until then, the link we email you brings them back.
            </p>
            {leaves.length > 0 ? <p className="c-s15 m-0">You leave {namesText(leaves)} today. To come back later, ask them to add you again.</p> : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button type="button" onClick={() => void sendCode()} disabled={busy} className="c-btn c-btn-danger c-btn-lg">
                {busy ? 'Sending…' : 'Email me a code'}
              </button>
              <button type="button" onClick={close} className="c-btn c-btn-s c-btn-lg">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="c-s15 m-0">We emailed a 6-digit code to {email}.</p>
            <div className="c-field">
              <label className="c-label" htmlFor="delete-code">
                6-digit code
              </label>
              <input
                id="delete-code"
                className="c-input"
                style={{ maxWidth: 240 }}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setProblem(null);
                }}
              />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button type="button" onClick={() => void remove()} disabled={busy || code.length !== 6} className="c-btn c-btn-danger c-btn-lg">
                <Trash2 size={18} aria-hidden="true" />
                {busy ? 'Deleting…' : 'Delete my account'}
              </button>
              <button type="button" onClick={close} className="c-btn c-btn-s c-btn-lg">
                Cancel
              </button>
            </div>
            <div>
              <button type="button" onClick={() => void sendCode()} disabled={busy} className="c-btn c-btn-link">
                Email me a new code
              </button>
            </div>
            {resent ? (
              <p className="c-s14 m-0" style={{ color: 'var(--good)' }} role="status">
                We emailed you a new code.
              </p>
            ) : null}
          </div>
        )}
        {problem !== null ? (
          <p className="c-banner-danger rounded-xl px-3 py-2 c-s14 m-0" role="alert">
            {problem}
          </p>
        ) : null}
      </section>
    </div>
  );
}
