import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { WAIVER_MAX_CHARS } from '@app/shared';
import { orgService, errorText } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import { signedCount, waiverAsksLine, waiverDraftState, waiverSaveLabel, waiverSavedLine, waiverStopWords, waiverSummary } from '../../pages/console/waiverView';
import { ConsoleFailed, ConsoleLoading, ConsoleSection } from './ConsoleStates';

// WAIVER (ROADMAP 3e-i), on `org.manage` as the server gates it. The gym writes its own
// waiver; people read it and sign by typing their name when they join in the app, and
// people already in the app are asked on their gym's page. Changing the words asks
// everybody again, and the box says so before Save.

const labelStyle = { color: 'rgba(255,255,255,0.85)' };
const hintStyle = { color: 'rgba(255,255,255,0.45)' };
const softStyle = { color: 'rgba(255,255,255,0.55)' };
const boxStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' };

export default function WaiverPanel({ org, readOnly, startOpen = false, membersTo = '../members' }) {
  const gymId = org.id;
  const fieldId = useId();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState('');
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [busy, setBusy] = useState(null);
  // What the last save or stop said, until the words are typed in again.
  const [doneLine, setDoneLine] = useState(null);
  const [asking, setAsking] = useState(false);

  const fetchWaiver = useCallback(
    (isLive = () => true) =>
      orgService
        .getGymWaiver(gymId)
        .then((res) => {
          if (!isLive()) return;
          setData(res.data);
          setDraft(res.data.waiver?.text ?? '');
        })
        .catch((err) => {
          if (isLive()) setLoadError(errorText(err, "We couldn't load your waiver."));
        }),
    [gymId],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchWaiver(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [fetchWaiver]);

  const retry = () => {
    setLoadError(null);
    void fetchWaiver();
  };

  const state = data === null ? { canSave: false, problem: null } : waiverDraftState(data, draft);
  const canSave = state.canSave && busy === null && !readOnly;
  const off = readOnly || busy !== null;
  const asks = data === null || !state.canSave ? null : waiverAsksLine(data, draft);

  const save = async (event) => {
    event.preventDefault();
    if (!canSave) return;
    setBusy('save');
    setSaveError(null);
    try {
      const res = await orgService.saveGymWaiver(gymId, draft);
      setData(res.data);
      setDraft(res.data.waiver?.text ?? '');
      setDoneLine(waiverSavedLine(res.data));
    } catch (err) {
      setSaveError(errorText(err, "We couldn't save your waiver."));
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    setBusy('stop');
    setSaveError(null);
    try {
      const res = await orgService.stopGymWaiver(gymId);
      setData(res.data);
      setDraft(res.data.waiver?.text ?? '');
      setAsking(false);
      setDoneLine('You have stopped using this waiver. Nobody is asked to sign it.');
    } catch (err) {
      setSaveError(errorText(err, "We couldn't stop your waiver."));
    } finally {
      setBusy(null);
    }
  };

  const stopWords = data === null ? null : waiverStopWords(data);

  return (
    <ConsoleSection title="Waiver" summary={waiverSummary(data)} forceOpen={loadError !== null} defaultOpen={startOpen}>
      {readOnly ? (
        <p className="text-xs mb-3" style={hintStyle}>
          {readOnlyNote(org.orgType)}
        </p>
      ) : null}
      {loadError !== null ? (
        <ConsoleFailed message={loadError} onRetry={retry} />
      ) : data === null ? (
        <ConsoleLoading label="Loading…" />
      ) : (
        <form onSubmit={save} className="flex flex-col gap-4">
          <p className="text-sm m-0" style={softStyle}>
            Write or paste the waiver people agree to before they train with you. The words are yours: this app does not write or check them.
            People read it and sign by typing their full name when they join in the app. People already in the app see it on your page there,
            with a button to sign.
          </p>

          {data.waiver !== null && !data.inUse ? (
            <p className="text-sm m-0 rounded-xl px-4 py-3" style={{ ...boxStyle, ...labelStyle }}>
              This waiver is not in use, so nobody is asked to sign it. Press Use this waiver to start asking again.
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <label htmlFor={fieldId} className="text-base font-bold" style={{ color: '#fff' }}>
              Your waiver
            </label>
            <textarea
              id={fieldId}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setDoneLine(null);
                setSaveError(null);
              }}
              disabled={off}
              rows={14}
              maxLength={WAIVER_MAX_CHARS * 2}
              placeholder="Paste your waiver here."
              className="w-full rounded-xl px-4 py-3 text-sm leading-relaxed"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', resize: 'vertical' }}
            />
            {state.problem !== null ? (
              <p role="alert" className="text-sm m-0" style={{ color: '#f87171' }}>
                {state.problem}
              </p>
            ) : null}
          </div>

          {data.inUse ? (
            <div role="group" aria-label="Who has signed" className="rounded-xl px-4 py-3 flex flex-col gap-2" style={boxStyle}>
              <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
                {signedCount(data).replace(/^./, (first) => first.toUpperCase())}.
              </p>
              <p className="text-sm m-0" style={softStyle}>
                To see whether one person has signed, open them on the Members page and look under App.
              </p>
              <Link
                to={membersTo}
                className="self-start rounded-xl px-3.5 text-sm font-semibold inline-flex items-center min-h-11"
                style={{ background: 'rgba(255,255,255,0.07)', color: '#fff' }}
              >
                Open Members
              </Link>
            </div>
          ) : null}

          {asks !== null ? (
            <p className="text-sm m-0" style={labelStyle}>
              {asks}
            </p>
          ) : null}

          {saveError !== null ? <ConsoleFailed message={saveError} /> : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!canSave}
              className="rounded-xl px-5 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-40 min-h-11"
              style={{
                background: canSave ? 'linear-gradient(135deg,#FF8A1F,#FFB347)' : 'rgba(255,255,255,0.08)',
                color: canSave ? '#0A0908' : 'rgba(255,255,255,0.35)',
              }}
            >
              {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {busy === 'save' ? 'Saving…' : waiverSaveLabel(data)}
            </button>
            {data.inUse && !asking ? (
              <button
                type="button"
                onClick={() => {
                  setAsking(true);
                  setDoneLine(null);
                }}
                disabled={off}
                className="rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-40 min-h-11"
                style={{ border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.85)' }}
              >
                Stop using this waiver
              </button>
            ) : null}
            {doneLine !== null ? (
              <span role="status" className="text-sm" style={softStyle}>
                {doneLine}
              </span>
            ) : null}
          </div>

          {asking && data.inUse && stopWords !== null ? (
            <div role="group" aria-label={stopWords.question} className="rounded-xl px-4 py-3 flex flex-col gap-2" style={boxStyle}>
              <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
                {stopWords.question}
              </p>
              <p className="text-sm m-0" style={labelStyle}>
                {stopWords.changes}
              </p>
              <p className="text-sm m-0" style={softStyle}>
                {stopWords.kept}
              </p>
              <div className="flex flex-wrap gap-3 mt-1">
                <button
                  type="button"
                  onClick={() => void stop()}
                  disabled={off}
                  className="rounded-xl px-4 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-40 min-h-11"
                  style={{ background: 'rgba(239,68,68,0.18)', color: '#fca5a5' }}
                >
                  {busy === 'stop' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Stop using it
                </button>
                <button
                  type="button"
                  onClick={() => setAsking(false)}
                  disabled={busy !== null}
                  className="rounded-xl px-4 py-3 text-sm font-semibold min-h-11"
                  style={{ background: 'rgba(255,255,255,0.07)', color: '#fff' }}
                >
                  Keep using it
                </button>
              </div>
            </div>
          ) : null}
        </form>
      )}
    </ConsoleSection>
  );
}
