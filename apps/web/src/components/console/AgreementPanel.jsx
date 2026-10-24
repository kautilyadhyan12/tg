import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Loader2, Plus } from 'lucide-react';
import { MAIN_AGREEMENT_NAME, WAIVER_MAX_CHARS } from '@app/shared';
import { orgService, errorText } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import {
  AGREEMENTS_ABOUT,
  agreementAsksLine,
  agreementDraftState,
  agreementSaveLabel,
  agreementSavedLine,
  agreementStopWords,
  agreementSummary,
  mainAgreementLine,
  otherAgreementLine,
  usedForNames,
  withLists,
} from '../../pages/console/agreementView';
import { ConsoleFailed, ConsoleLoading, ConsoleSection } from './ConsoleStates';
import OtherAgreementForm from './OtherAgreementForm';

// MEMBERSHIP AGREEMENT (ROADMAP 18u-i), on `org.manage` as the server gates it. The business
// writes its own agreement; each membership it gives is signed on staff's screen, with that
// membership's details filled in above these words, and the person gets a copy by email.
// Changing the words keeps what was already signed, and the box says so before Save.
//
// Each line of the price list may have its own (18u-ii-a): Add agreement opens a form under it,
// and each other agreement's Edit opens its form under its row. The main one is used for every
// line not ticked on another; a business with only the main one sees only it.

const labelStyle = { color: 'rgba(255,255,255,0.85)' };
const softStyle = { color: 'rgba(255,255,255,0.55)' };
const hintStyle = { color: 'rgba(255,255,255,0.45)' };
const boxStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' };

// `membersName`: what this person's menu calls the Members page (`membersPageName`).
// `openAgreementId`: another agreement shown open at once (the price list's Open agreement).
export default function AgreementPanel({ org, readOnly, startOpen = false, openAgreementId = null, membersTo = '../members', membersName = 'Members' }) {
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
  // Whether Add agreement's form is open ('new'), and what the last save of another agreement said.
  const [editing, setEditing] = useState(null);
  const [otherLine, setOtherLine] = useState(null);
  // The other agreements shown open: each is a row that opens and closes when pressed.
  const [openOthers, setOpenOthers] = useState(() => new Set(openAgreementId === null ? [] : [openAgreementId]));
  const toggleOther = (id) =>
    setOpenOthers((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const otherDone = (next, line, id) => {
    setData(withLists(next));
    setEditing(null);
    setOtherLine({ at: id, text: line });
    // A new agreement is shown open where it was saved.
    if (id !== null) setOpenOthers((now) => new Set(now).add(id));
  };

  const fetchAgreement = useCallback(
    (isLive = () => true) =>
      orgService
        .getGymAgreement(gymId)
        .then((res) => {
          if (!isLive()) return;
          setData(withLists(res.data));
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
      setData(withLists(res.data));
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
      setData(withLists(res.data));
      setDraft(res.data.agreement?.text ?? '');
      setAsking(false);
      setDoneLine('Agreement turned off. Members are not asked to sign it.');
    } catch (err) {
      setSaveError(errorText(err, "We couldn't stop your membership agreement."));
    } finally {
      setBusy(null);
    }
  };

  const stopWords = data === null ? null : agreementStopWords(data);

  return (
    <ConsoleSection title="Membership agreements" summary={agreementSummary(data)} forceOpen={loadError !== null} defaultOpen={startOpen}>
      <p className="text-sm m-0 mb-3" style={labelStyle}>
        {AGREEMENTS_ABOUT}
      </p>
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
        <div className="flex flex-col gap-6">
        <form onSubmit={save} className="flex flex-col gap-4">
          {data.agreement === null ? (
            // Only until the business has written its agreement: after that the box holds its own words.
            <div role="note" className="rounded-xl px-4 py-3 flex flex-col gap-1.5" style={{ background: 'rgba(255,138,31,0.08)', border: '1px solid rgba(255,138,31,0.35)' }}>
              <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
                {data.others.length > 0 ? 'No default agreement yet.' : 'No membership agreement yet.'}
              </p>
              <p className="text-sm m-0" style={labelStyle}>
                Write or paste your terms below: cancellation, refunds, freezes, fees and house rules. When you add a membership for a member, they
                sign the agreement on your screen and receive a copy by email.
              </p>
            </div>
          ) : null}

          {data.agreement !== null && !data.inUse ? (
            <p className="text-sm m-0 rounded-xl px-4 py-3" style={{ ...boxStyle, ...labelStyle }}>
              This agreement is turned off. Members are not asked to sign it. To turn it back on, select Use this agreement.
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <label htmlFor={fieldId} className="text-base font-bold" style={{ color: '#fff' }}>
              {MAIN_AGREEMENT_NAME}
            </label>
            {mainAgreementLine(data) !== null ? (
              <p className="text-sm m-0" style={softStyle}>
                {mainAgreementLine(data)}
              </p>
            ) : null}
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
              placeholder="Write or paste your membership terms."
              className="w-full rounded-xl px-4 py-3 text-sm leading-relaxed"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', resize: 'vertical' }}
            />
            <p className="text-sm m-0" style={softStyle}>
              We do not write or review your terms. Each member&apos;s price and dates are added above your terms automatically.
            </p>
            {state.problem !== null ? (
              <p role="alert" className="text-sm m-0" style={{ color: '#f87171' }}>
                {state.problem}
              </p>
            ) : null}
          </div>

          {data.inUse ? (
            <div role="group" aria-label="Who has signed" className="rounded-xl px-4 py-3 flex flex-col gap-2" style={boxStyle}>
              <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
                {data.signed === 1 ? '1 signed' : `${String(data.signed)} signed`}
              </p>
              <p className="text-sm m-0" style={softStyle}>
                To view a member&apos;s signed agreement, open the member on {membersName} and go to Memberships.
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
                Turn off
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
                  Turn off
                </button>
                <button
                  type="button"
                  onClick={() => setAsking(false)}
                  disabled={busy !== null}
                  className="rounded-xl px-4 py-3 text-sm font-semibold min-h-11"
                  style={{ background: 'rgba(255,255,255,0.07)', color: '#fff' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </form>

        <div role="group" aria-label="Other agreements" className="flex flex-col gap-3">
          {data.others.length > 0 ? (
            <p className="text-base font-bold m-0" style={{ color: '#fff' }}>
              Other agreements
            </p>
          ) : null}
          {data.others.map((other) => (
            <div key={other.id} id={`agreement-${other.id}`} className="flex flex-col gap-2" style={{ scrollMarginTop: 16 }}>
              <button
                type="button"
                aria-expanded={openOthers.has(other.id)}
                onClick={() => toggleOther(other.id)}
                className="w-full rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-left min-h-11"
                style={boxStyle}
              >
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-sm font-semibold break-words" style={{ color: '#fff' }}>
                    {other.name}
                  </span>
                  <span className="text-sm" style={softStyle}>
                    {otherAgreementLine(data, other)}
                  </span>
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="w-5 h-5 flex-shrink-0 transition-transform"
                  style={{ color: 'rgba(255,255,255,0.6)', transform: openOthers.has(other.id) ? 'rotate(180deg)' : 'none' }}
                />
              </button>
              {/* Drawn again from what was saved whenever this agreement or its memberships change. */}
              {openOthers.has(other.id) ? (
                <OtherAgreementForm
                  key={`${other.id}:${String(other.agreement.version)}:${other.name}:${String(other.inUse)}:${usedForNames(data, other.id).join('|')}`}
                  gymId={gymId}
                  data={data}
                  other={other}
                  readOnly={readOnly}
                  membersTo={membersTo}
                  membersName={membersName}
                  onDone={otherDone}
                  onStale={(said) => {
                    // Its form is drawn again from what is saved now, so what was refused is said under its row.
                    setOtherLine({ at: other.id, text: said });
                    void fetchAgreement();
                  }}
                  onCancel={null}
                />
              ) : null}
              {otherLine !== null && otherLine.at === other.id ? (
                <p role="status" className="text-sm m-0" style={softStyle}>
                  {otherLine.text}
                </p>
              ) : null}
            </div>
          ))}
          {editing === 'new' ? (
            <OtherAgreementForm
              key="new"
              gymId={gymId}
              data={data}
              other={null}
              readOnly={readOnly}
              onDone={otherDone}
              onStale={() => void fetchAgreement()}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setEditing('new');
                  setOtherLine(null);
                }}
                disabled={readOnly || busy !== null}
                className="self-start rounded-xl px-4 text-sm font-semibold inline-flex items-center gap-2 min-h-11 disabled:opacity-40"
                style={{ border: '1px solid rgba(255,255,255,0.2)', color: '#fff' }}
              >
                <Plus aria-hidden="true" className="w-4 h-4" />
                Add agreement
              </button>
              {data.others.length === 0 ? (
                <p className="text-sm m-0" style={softStyle}>
                  Add a separate agreement for memberships with different terms, for example class packs.
                </p>
              ) : null}
            </div>
          )}
        </div>
        </div>
      )}
    </ConsoleSection>
  );
}
