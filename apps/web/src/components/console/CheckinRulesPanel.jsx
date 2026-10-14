import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import {
  OVERDUE_CHOICES,
  WAIVER_CHOICES,
  WHO_CHOICES,
  notListedLine,
  overdueHint,
  previewNames,
  previewWords,
  rulesChanged,
  rulesSavedLine,
  rulesSummary,
  waiverHint,
} from '../../pages/console/checkinRulesView';
import { ConsoleFailed, ConsoleLoading, ConsoleSection } from './ConsoleStates';

// WHO CAN CHECK IN (ROADMAP 16d; spec Part 3 §12.4), on `org.manage` as the server gates
// it. The gym picks whom its front desk checks in, what it does with an overdue payment
// and with somebody who has not signed its waiver (3e-ii); all three wait for one Save. Under the choices the box names who the desk would send
// to staff today and how many it would not, before anything is saved.

const labelStyle = { color: 'rgba(255,255,255,0.85)' };
const hintStyle = { color: 'rgba(255,255,255,0.45)' };
const softStyle = { color: 'rgba(255,255,255,0.55)' };
const boxStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' };

function Choices({ legend, name, choices, value, onPick, disabled, hint }) {
  return (
    <fieldset className="flex flex-col gap-2 m-0 p-0 border-0 min-w-0">
      <legend className="text-base font-bold p-0 mb-2" style={{ color: '#fff' }}>
        {legend}
      </legend>
      {choices.map((choice) => (
        <label key={choice.value} className="flex items-start gap-3 py-2 min-h-11 cursor-pointer">
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={value === choice.value}
            onChange={() => onPick(choice.value)}
            disabled={disabled}
            className="mt-1 w-4 h-4 flex-shrink-0"
            style={{ accentColor: '#FF8A1F' }}
          />
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm font-semibold" style={labelStyle}>
              {choice.label}
            </span>
            {choice.hint ? (
              <span className="text-xs" style={hintStyle}>
                {choice.hint}
              </span>
            ) : null}
          </span>
        </label>
      ))}
      {hint ? (
        <p className="text-xs m-0" style={hintStyle}>
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Who the desk sends to staff today under the choices picked, and who it does not. */
function Today({ preview, changed, attendanceTo }) {
  const [all, setAll] = useState(false);
  if (preview.status === 'loading') return <ConsoleLoading label="Working out who this stops…" />;
  if (preview.status === 'failed') return <ConsoleFailed message={preview.error} onRetry={preview.retry} />;
  const words = previewWords(preview.data, changed);
  if (words === null) return null;
  const names = previewNames(preview.data, all);
  const alsoStopped = notListedLine(preview.data, changed);
  return (
    <div role="group" aria-label="Who is sent to staff today" className="rounded-xl px-4 py-3 flex flex-col gap-2" style={boxStyle}>
      <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
        {words.title}
      </p>
      {names.shown.length > 0 ? (
        <ul className={`m-0 p-0 list-none flex flex-col gap-1 ${all ? 'max-h-64 overflow-y-auto' : ''}`}>
          {names.shown.map((person) => (
            <li key={person.entryId} className="text-sm" style={labelStyle}>
              {person.name} <span style={softStyle}>· {person.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {names.more > 0 ? (
        <p className="text-sm m-0 flex flex-wrap items-center gap-2" style={softStyle}>
          <span>
            {all ? `and ${String(names.notSent)} more, not listed here` : `and ${String(names.more)} more`}
          </span>
          {names.canSeeAll ? (
            <button type="button" onClick={() => setAll(true)} className="text-sm font-semibold underline min-h-11 sm:min-h-0" style={{ color: '#FFB347' }}>
              See all
            </button>
          ) : null}
        </p>
      ) : null}
      {words.rest !== null ? (
        <p className="text-sm m-0" style={softStyle}>
          {words.rest}
        </p>
      ) : null}
      {alsoStopped !== null ? (
        <p className="text-sm m-0" style={labelStyle}>
          {alsoStopped}
        </p>
      ) : null}
      {preview.data.stopped > 0 || alsoStopped !== null ? (
        <>
          <p className="text-sm m-0" style={softStyle}>
            At the desk they read &ldquo;Please see a member of staff&rdquo;, with no name and no reason. Your staff can still check them in on
            the Attendance page, which says why. Your own staff are always checked in when they scan their own pass.
          </p>
          <Link
            to={attendanceTo}
            className="self-start rounded-xl px-3.5 text-sm font-semibold inline-flex items-center min-h-11"
            style={{ background: 'rgba(255,255,255,0.07)', color: '#fff' }}
          >
            Open Attendance
          </Link>
        </>
      ) : null}
    </div>
  );
}

// `startOpen`: the page was opened by a link to the front desk's part of Settings.
// `waiverTo`: the Waiver box in Settings, for a gym with no waiver in use.
export default function CheckinRulesPanel({ org, readOnly, startOpen = false, attendanceTo = '../attendance', waiverTo = null }) {
  const gymId = org.id;
  const [saved, setSaved] = useState(null);
  const [overdueAfterDays, setOverdueAfterDays] = useState(0);
  const [waiverInUse, setWaiverInUse] = useState(false);
  const [draft, setDraft] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  // What the last save said, until a choice is picked again; null before one.
  const [savedLine, setSavedLine] = useState(null);
  // The last answer about who the choices stop, with the choices it was asked for.
  const [answer, setAnswer] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const fetchRules = useCallback(
    (isLive = () => true) =>
      orgService
        .getCheckinRules(gymId)
        .then((res) => {
          if (!isLive()) return;
          setSaved(res.data.rules);
          setOverdueAfterDays(res.data.overdueAfterDays);
          setWaiverInUse(res.data.waiverInUse);
          setDraft(res.data.rules);
        })
        .catch((err) => {
          if (isLive()) setLoadError(errorText(err, "We couldn't load who can check in."));
        }),
    [gymId],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchRules(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [fetchRules]);

  const who = draft?.who ?? null;
  const overdue = draft?.overdue ?? null;
  const waiver = draft?.waiver ?? null;
  // Who the choices on screen stop today: asked again each time one is picked. An answer
  // is drawn only for the choices on screen now, so an older one never stands under them.
  const askedFor = who === null || overdue === null || waiver === null ? null : `${who}|${overdue}|${waiver}|${String(attempt)}`;
  useEffect(() => {
    if (who === null || overdue === null || waiver === null) return undefined;
    let live = true;
    const key = `${who}|${overdue}|${waiver}|${String(attempt)}`;
    void orgService
      .previewCheckinRules(gymId, { who, overdue, waiver })
      .then((res) => {
        if (live) setAnswer({ key, data: res.data, error: null });
      })
      .catch((err) => {
        if (live) setAnswer({ key, data: null, error: errorText(err, "We couldn't work out who this stops.") });
      });
    return () => {
      live = false;
    };
  }, [gymId, who, overdue, waiver, attempt]);
  const preview =
    answer === null || answer.key !== askedFor
      ? { status: 'loading', data: null, error: null }
      : answer.error !== null
        ? { status: 'failed', data: null, error: answer.error }
        : { status: 'ready', data: answer.data, error: null };

  const retry = () => {
    setLoadError(null);
    void fetchRules();
  };

  const ready = saved !== null && draft !== null;
  const changed = ready && rulesChanged(draft, saved);
  // Save waits for the box that names who it stops: nothing is saved unseen.
  const canSave = changed && !saving && !readOnly && preview.status === 'ready';
  const off = readOnly || saving;

  const pick = (patch) => {
    setDraft({ ...draft, ...patch });
    setSavedLine(null);
    setSaveError(null);
  };

  const save = async (event) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await orgService.updateCheckinRules(gymId, draft);
      setSaved(res.data.rules);
      setOverdueAfterDays(res.data.overdueAfterDays);
      setWaiverInUse(res.data.waiverInUse);
      setDraft(res.data.rules);
      setSavedLine(rulesSavedLine(res.data.rules, preview.data));
    } catch (err) {
      setSaveError(errorText(err, "We couldn't save who can check in."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConsoleSection title="Who can check in" summary={rulesSummary(saved)} forceOpen={loadError !== null} defaultOpen={startOpen}>
      {readOnly ? (
        <p className="text-xs mb-3" style={hintStyle}>
          {readOnlyNote(org.orgType)}
        </p>
      ) : null}
      {loadError !== null ? (
        <ConsoleFailed message={loadError} onRetry={retry} />
      ) : !ready ? (
        <ConsoleLoading label="Loading…" />
      ) : (
        <form onSubmit={save} className="flex flex-col gap-6">
          <p className="text-sm m-0" style={softStyle}>
            Choose who your front desk checks in when they scan a pass or a key tag. This reads the memberships, payments and waiver signatures you keep in
            this app.
          </p>
          <Choices legend="Who the front desk checks in" name={`checkin-who-${gymId}`} choices={WHO_CHOICES} value={draft.who} onPick={(value) => pick({ who: value })} disabled={off} />
          <Choices
            legend="Someone with an overdue payment"
            name={`checkin-overdue-${gymId}`}
            choices={OVERDUE_CHOICES}
            value={draft.overdue}
            onPick={(value) => pick({ overdue: value })}
            disabled={off}
            hint={overdueHint(overdueAfterDays)}
          />
          <div className="flex flex-col gap-1">
            <Choices
              legend="Someone who has not signed your waiver"
              name={`checkin-waiver-${gymId}`}
              choices={WAIVER_CHOICES}
              value={draft.waiver}
              onPick={(value) => pick({ waiver: value })}
              disabled={off}
              hint={waiverHint(waiverInUse)}
            />
            {!waiverInUse && waiverTo !== null ? (
              <Link
                to={waiverTo}
                className="self-start rounded-xl px-3.5 text-sm font-semibold inline-flex items-center min-h-11"
                style={{ background: 'rgba(255,255,255,0.07)', color: '#fff' }}
              >
                Set up your waiver
              </Link>
            ) : null}
          </div>

          <Today
            key={`${draft.who}-${draft.overdue}-${draft.waiver}`}
            preview={{ ...preview, retry: () => setAttempt((n) => n + 1) }}
            changed={changed}
            attendanceTo={attendanceTo}
          />

          {saveError !== null ? <ConsoleFailed message={saveError} /> : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!canSave}
              className="rounded-xl px-5 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-40"
              style={{
                background: canSave ? 'linear-gradient(135deg,#FF8A1F,#FFB347)' : 'rgba(255,255,255,0.08)',
                color: canSave ? '#0A0908' : 'rgba(255,255,255,0.35)',
              }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            {savedLine !== null ? (
              <span role="status" className="text-sm" style={softStyle}>
                {savedLine}
              </span>
            ) : null}
          </div>
        </form>
      )}
    </ConsoleSection>
  );
}
