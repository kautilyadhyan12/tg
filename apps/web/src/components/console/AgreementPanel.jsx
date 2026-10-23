import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { WAIVER_MAX_CHARS } from '@app/shared';
import { orgService, errorText } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import { agreementAsksLine, agreementDraftState, agreementSaveLabel, agreementSavedLine, agreementStopWords, agreementSummary } from '../../pages/console/agreementView';
import { ConsoleFailed, ConsoleLoading, ConsoleSection } from './ConsoleStates';

// MEMBERSHIP AGREEMENT (ROADMAP 18u-i), on `org.manage` as the server gates it. The business
// writes its own agreement; each membership it gives is signed on staff's screen, with that
// membership's details filled in above these words, and the person gets a copy by email.
// Changing the words keeps what was already signed, and the box says so before Save.

const labelStyle = { color: 'rgba(255,255,255,0.85)' };
const softStyle = { color: 'rgba(255,255,255,0.55)' };
const hintStyle = { color: 'rgba(255,255,255,0.45)' };
const boxStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' };

/** What the app writes above the business's words for each membership. */
const FILLED_IN = [
  'Your business name, address and phone',
  "The member's name",
  'The membership and its price, with any discount and tax',
  'The first payment, with any joining fee',
  'The start date, and when it ends or that it renews until cancelled',
];

// `membersName`: what this person's menu calls the Members page (`membersPageName`).
export default function AgreementPanel({ org, readOnly, startOpen = false, membersTo = '../members', membersName = 'Members' }) {
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

  const fetchAgreement = useCallback(
    (isLive = () => true) =>
      orgService
        .getGymAgreement(gymId)
        .then((res) => {
          if (!isLive()) return;
          setData(res.data);
          setDraft(res.data.agreement?.text ?? '');
        })
        .catch((err) => {
          if (isLive()) setLoadError(errorText(err, "We couldn't load your membership agreement."));
        }),
    [gymId],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchAgreement(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [fetchAgreement]);

  const retry = () => {
    setLoadError(null);
    void fetchAgreement();
  };

  const state = data === null ? { canSave: false, problem: null } : agreementDraftState(data, draft);
  const canSave = state.canSave && busy === null && !readOnly;
  const off = readOnly || busy !== null;
  const asks = data === null || !state.canSave ? null : agreementAsksLine(data, draft);

  const save = async (event) => {
    event.preventDefault();
    if (!canSave) return;
    setBusy('save');
    setSaveError(null);
    try {
      const res = await orgService.saveGymAgreement(gymId, draft);
      setDoneLine(agreementSavedLine(data, res.data));
      setData(res.data);
      setDraft(res.data.agreement?.text ?? '');
    } catch (err) {
      setSaveError(errorText(err, "We couldn't save your membership agreement."));
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    setBusy('stop');
    setSaveError(null);
    try {
      const res = await orgService.stopGymAgreement(gymId);
      setData(res.data);
      setDraft(res.data.agreement?.text ?? '');
      setAsking(false);
      setDoneLine('You have stopped using this agreement. Nobody is asked to sign it.');
    } catch (err) {
      setSaveError(errorText(err, "We couldn't stop your membership agreement."));
    } finally {
      setBusy(null);
    }
  };

  const stopWords = data === null ? null : agreementStopWords(data);

  return (
    <ConsoleSection title="Membership agreement" summary={agreementSummary(data)} forceOpen={loadError !== null} defaultOpen={startOpen}>
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
          {data.agreement === null ? (
            // Only until the business has written its agreement: after that the box holds its own words.
            <div role="note" className="rounded-xl px-4 py-3 flex flex-col gap-1.5" style={{ background: 'rgba(255,138,31,0.08)', border: '1px solid rgba(255,138,31,0.35)' }}>
              <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
                You can write your membership agreement here.
              </p>
              <p className="text-sm m-0" style={labelStyle}>
                Type or paste your terms: how members cancel, notice periods, refunds, freezes, fees and your house rules. The words are yours: this app
                does not write or check them. When you give someone a membership, they read it on your screen with that membership&apos;s details and sign it,
                and they get a copy by email.
              </p>
            </div>
          ) : null}

          {data.agreement !== null && !data.inUse ? (
            <p className="text-sm m-0 rounded-xl px-4 py-3" style={{ ...boxStyle, ...labelStyle }}>
              This agreement is not in use, so nobody is asked to sign it. Press Use this agreement to start again.
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <label htmlFor={fieldId} className="text-base font-bold" style={{ color: '#fff' }}>
              Your terms
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
              placeholder="Paste your membership terms here."
              className="w-full rounded-xl px-4 py-3 text-sm leading-relaxed"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', resize: 'vertical' }}
            />
            {state.problem !== null ? (
              <p role="alert" className="text-sm m-0" style={{ color: '#f87171' }}>
                {state.problem}
              </p>
            ) : null}
          </div>

          <div role="group" aria-label="Filled in for each membership" className="rounded-xl px-4 py-3 flex flex-col gap-1.5" style={boxStyle}>
            <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
              Filled in for each membership, above your terms
            </p>
            <ul className="m-0 pl-5 flex flex-col gap-1 text-sm" style={labelStyle}>
              {FILLED_IN.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          {data.inUse ? (
            <div role="group" aria-label="Who has signed" className="rounded-xl px-4 py-3 flex flex-col gap-2" style={boxStyle}>
              <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
                Signed for {data.signed === 1 ? '1 membership' : `${String(data.signed)} memberships`}.
              </p>
              <p className="text-sm m-0" style={softStyle}>
                To see one person&apos;s, open them on the {membersName} page and look under Memberships.
              </p>
              <Link
                to={membersTo}
                className="self-start rounded-xl px-3.5 text-sm font-semibold inline-flex items-center min-h-11"
                style={{ background: 'rgba(255,255,255,0.07)', color: '#fff' }}
              >
                Open {membersName}
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
              {busy === 'save' ? 'Saving…' : agreementSaveLabel(data)}
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
                Stop using this agreement
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
