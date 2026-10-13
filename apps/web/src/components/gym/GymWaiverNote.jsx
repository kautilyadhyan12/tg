import { useCallback, useEffect, useState } from 'react';
import { FileSignature, Loader2 } from 'lucide-react';
import { errorCode, errorText, orgService } from '../../api/orgsApi';
import { noteDay } from '../../pages/console/memberListPeople';
import { waiverReadyToSign } from '@app/shared';
import WaiverSign from './WaiverSign';

// A member's own gym asks them to sign its waiver (ROADMAP 3e-i): somebody who joined
// before the gym wrote one, or whose gym has changed its words since. Drawn on the gym's
// card in My Gyms. Nothing at all where the gym asks for no waiver.

const soft = { color: 'rgba(255,255,255,0.55)' };
const strong = { color: 'rgba(255,255,255,0.85)' };

export default function GymWaiverNote({ gym }) {
  const gymId = gym.id;
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [justSigned, setJustSigned] = useState(false);

  const read = useCallback(
    (isLive = () => true) =>
      orgService.getMyWaiver(gymId).then(
        (res) => {
          if (!isLive()) return;
          setFailed(false);
          setData(res.data);
        },
        () => {
          if (isLive()) setFailed(true);
        },
      ),
    [gymId],
  );

  useEffect(() => {
    let live = true;
    void read(() => live);
    return () => {
      live = false;
    };
  }, [read]);

  if (failed) {
    return (
      <p className="text-sm mt-2 flex flex-wrap items-center gap-2" style={soft}>
        We couldn&apos;t check whether {gym.name} has a waiver for you to sign.
        <button type="button" onClick={() => void read()} className="font-semibold underline" style={{ color: '#FF8A1F', minHeight: 44 }}>
          Try again
        </button>
      </p>
    );
  }
  if (data === null) return null;
  if (data.waiver === null) {
    // The gym stopped its waiver while this was open: say so where Sign was pressed.
    return error === null ? null : (
      <p role="alert" className="text-sm mt-2" style={soft}>
        {error}
      </p>
    );
  }
  const { waiver, signed } = data;
  // The day is the gym's own.
  const day = signed === null ? '' : noteDay(signed.at, data.timezone ?? null);

  const sign = async () => {
    if (!waiverReadyToSign(name, agreed) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await orgService.signMyWaiver(gymId, waiver.id, name);
      setData({ ...data, signed: res.data.signed });
      setJustSigned(true);
      setOpen(false);
    } catch (err) {
      setError(errorText(err, "We couldn't save your signature. Please try again."));
      // The gym changed or stopped its waiver while this was open: show what it asks now.
      if (['waiver_changed', 'waiver_not_in_use'].includes(errorCode(err))) {
        setAgreed(false);
        void read();
      }
    } finally {
      setBusy(false);
    }
  };

  if (signed !== null) {
    return (
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-sm m-0 flex flex-wrap items-center gap-x-2" style={soft}>
          <span role={justSigned ? 'status' : undefined}>
            {justSigned ? `Thank you. You signed ${gym.name}'s waiver` : 'Waiver signed'} on {day} as {signed.name}.
          </span>
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="font-semibold underline" style={{ ...strong, minHeight: 44 }}>
            {open ? 'Hide the waiver' : 'Read the waiver'}
          </button>
        </p>
        {open ? (
          <div
            role="region"
            aria-label={`${gym.name}'s waiver`}
            tabIndex={0}
            className="rounded-xl px-4 py-3 text-sm leading-relaxed max-h-72 overflow-y-auto"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', ...strong, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
            {waiver.text}
          </div>
        ) : null}
      </div>
    );
  }

  const ready = waiverReadyToSign(name, agreed);
  return (
    <div className="mt-3 rounded-xl p-4 flex flex-col gap-3" style={{ background: 'rgba(255,138,31,0.06)', border: '1px solid rgba(255,138,31,0.25)' }}>
      <div className="flex items-start gap-3">
        <FileSignature aria-hidden="true" className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#FF8A1F' }} />
        <p className="text-sm m-0" style={strong}>
          {gym.name} asks you to read and sign its waiver.
        </p>
      </div>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="self-start rounded-xl px-5 py-3 text-sm font-semibold"
          style={{ background: '#FF8A1F', color: '#0A0908', minHeight: 44 }}
        >
          Read and sign
        </button>
      ) : (
        <>
          <WaiverSign gymName={gym.name} waiver={waiver} name={name} onName={setName} agreed={agreed} onAgreed={setAgreed} disabled={busy} />
          {error !== null ? (
            <p role="alert" className="text-sm m-0" style={{ color: '#f87171' }}>
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void sign()}
              disabled={!ready || busy}
              className="rounded-xl px-6 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
              style={{ background: '#FF8A1F', color: '#0A0908', minHeight: 44 }}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {busy ? 'Signing…' : 'Sign'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="rounded-xl px-5 py-3 text-sm font-medium"
              style={{ border: '1px solid rgba(255,255,255,0.15)', ...strong, minHeight: 44 }}
            >
              Not now
            </button>
            {!ready ? (
              <span className="text-sm" style={soft}>
                Type your full name and tick the box to sign.
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
