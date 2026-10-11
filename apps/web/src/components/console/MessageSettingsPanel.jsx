import { useCallback, useEffect, useId, useState } from 'react';
import { GYM_MESSAGE_MILESTONE_CHOICES, GYM_MESSAGE_MISS_YOU_CHOICES, GYM_MESSAGE_OWN_LINE_MAX } from '@app/shared';
import { Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import { placeFor } from '../../pages/console/consolePlaces';
import { viewerPrivileges } from '../../pages/console/consoleView';
import {
  MESSAGE_KINDS,
  NO_CHECK_IN_ASK,
  lineCount,
  messageDraft,
  messageDraftChanged,
  messageDraftFine,
  messageName,
  messagePreview,
  messageProblem,
  messageSettingsBody,
  messageSettingsNote,
  messageSettingsSummary,
  messageWhen,
  needsCheckIn,
  noCheckInNote,
  toggleMilestone,
} from '../../pages/console/messageSettingsView';
import { ConsoleFailed, ConsoleLoading, ConsoleSection } from './ConsoleStates';
import PlaceLink from './PlaceLink';

// AUTOMATIC MESSAGES (ROADMAP 20b-i; spec Part 3 §16.2): the messages the app sends a
// gym's members by itself. Each has a switch, the words a member will read, and one line
// of the gym's own; two have a number the gym picks. Everything waits for one Save.

const inputStyle = {
  background: '#0A0908',
  border: '1px solid rgba(255,255,255,0.10)',
  color: '#fff',
};
const MUTED = 'rgba(255,255,255,0.45)';
const cardStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' };

function Switch({ on, onPress, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      className="min-h-11 min-w-11 flex items-center justify-end flex-shrink-0"
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <span
        aria-hidden="true"
        className="w-12 h-6 rounded-full relative transition-all"
        style={{ background: on ? 'linear-gradient(135deg, #FF8A1F, #FFB347)' : 'rgba(255,255,255,0.14)' }}
      >
        <span className="absolute top-1 w-4 h-4 rounded-full bg-white transition-all" style={{ left: on ? 28 : 4, boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
      </span>
    </button>
  );
}

function Message({ kind, org, draft, edit, locked, checkIn, attendanceTo }) {
  const lineId = useId();
  const on = draft.on[kind];
  const problem = messageProblem(kind, draft);
  return (
    <fieldset className="rounded-xl p-4 m-0 min-w-0 flex flex-col gap-3" style={cardStyle} aria-label={messageName(kind)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-bold m-0" style={{ color: '#fff' }}>
            {messageName(kind)}
            <span className="text-xs font-semibold ml-2" style={{ color: on ? '#FF8A1F' : MUTED }}>
              {on ? 'On' : 'Off'}
            </span>
          </p>
          <p className="text-sm mt-1 m-0" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {messageWhen(kind, org.orgType)}
          </p>
        </div>
        <Switch on={on} disabled={locked} label={`Send the ${messageName(kind)} message`} onPress={() => edit((was) => ({ ...was, on: { ...was.on, [kind]: !on } }))} />
      </div>

      {kind === 'milestone' ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Visits to mark">
          {GYM_MESSAGE_MILESTONE_CHOICES.map((visits) => (
            <label
              key={visits}
              className="rounded-xl px-3 min-h-11 inline-flex items-center gap-2 text-sm cursor-pointer"
              style={{ ...cardStyle, color: '#fff' }}
            >
              <input
                type="checkbox"
                checked={draft.milestones.includes(visits)}
                disabled={locked}
                onChange={() => edit((was) => ({ ...was, milestones: toggleMilestone(was.milestones, visits) }))}
              />
              {visits.toLocaleString('en')} visits
            </label>
          ))}
        </div>
      ) : null}

      {kind === 'miss_you' ? (
        <label className="flex flex-wrap items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
          No check-in for
          <select
            aria-label="Days without a check-in"
            value={draft.missYouDays}
            disabled={locked}
            onChange={(e) => edit((was) => ({ ...was, missYouDays: Number(e.target.value) }))}
            className="rounded-xl px-3 py-3 text-base sm:text-sm"
            style={inputStyle}
          >
            {GYM_MESSAGE_MISS_YOU_CHOICES.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {needsCheckIn(kind) && !checkIn ? (
        <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: 'rgba(255,138,31,0.08)', border: '1px solid rgba(255,138,31,0.25)' }}>
          <p className="text-sm m-0" style={{ color: 'rgba(255,255,255,0.85)' }}>
            {noCheckInNote(org.orgType)}
          </p>
          {attendanceTo === null ? (
            <p className="text-sm m-0" style={{ color: 'rgba(255,255,255,0.55)' }}>
              {NO_CHECK_IN_ASK}
            </p>
          ) : (
            <PlaceLink to={attendanceTo} guard>
              Open Attendance
            </PlaceLink>
          )}
        </div>
      ) : null}

      <div>
        <p className="text-xs font-semibold m-0" style={{ color: MUTED }}>
          What they&apos;ll read
        </p>
        <p
          className="text-sm mt-1 m-0 rounded-xl p-3"
          data-testid={`preview-${kind}`}
          style={{ background: '#0A0908', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}
        >
          {messagePreview(kind, org.name, draft)}
        </p>
      </div>

      <div>
        <label htmlFor={lineId} className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
          Add a line of your own (optional)
        </label>
        <input
          id={lineId}
          type="text"
          autoComplete="off"
          value={draft.lines[kind]}
          disabled={locked}
          maxLength={GYM_MESSAGE_OWN_LINE_MAX * 2}
          onChange={(e) => edit((was) => ({ ...was, lines: { ...was.lines, [kind]: e.target.value } }))}
          className="mt-2 w-full rounded-xl px-4 py-3 text-base sm:text-sm"
          style={inputStyle}
        />
        <p className="text-xs mt-1 m-0" style={{ color: MUTED }}>
          {lineCount(draft, kind)} characters. No web addresses and no @.
        </p>
      </div>

      {problem !== null ? (
        <p className="text-sm m-0" role="alert" style={{ color: '#ef4444' }}>
          {problem}
        </p>
      ) : null}
    </fieldset>
  );
}

// `startOpen`: the page was opened by a link to this section.
export default function MessageSettingsPanel({ org, readOnly, startOpen = false }) {
  const gymId = org.id;
  const [kept, setKept] = useState(null);
  const [draft, setDraft] = useState(null);
  const [checkIn, setCheckIn] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const take = useCallback((data) => {
    const now = messageDraft(data);
    setKept(now);
    setDraft(now);
    setCheckIn(data.checkIn === true);
  }, []);

  const load = useCallback(
    (isLive = () => true) =>
      orgService
        .getMessageSettings(gymId)
        .then((res) => {
          if (!isLive()) return;
          take(res.data);
          setLoadError(null);
        })
        .catch((err) => {
          if (isLive()) setLoadError(errorText(err, "We couldn't load your automatic messages."));
        }),
    [gymId, take],
  );

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, [load]);

  const edit = (change) => {
    setDraft(change);
    setSaved(false);
    setSaveError(null);
  };

  const changed = kept !== null && draft !== null && messageDraftChanged(draft, kept);
  const canSave = changed && messageDraftFine(draft) && !saving && !readOnly;

  const save = async (event) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await orgService.updateMessageSettings(gymId, messageSettingsBody(draft));
      take(res.data);
      setSaved(true);
    } catch (err) {
      setSaveError(errorText(err, "We couldn't save that. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  const attendanceTo = placeFor(org.slug, viewerPrivileges(org), 'attendance');

  return (
    <ConsoleSection title="Automatic messages" summary={messageSettingsSummary(kept)} defaultOpen={startOpen} forceOpen={loadError !== null}>
      {loadError !== null ? (
        <ConsoleFailed message={loadError} onRetry={() => void load()} />
      ) : draft === null ? (
        <ConsoleLoading label="Loading your automatic messages…" />
      ) : (
        <form onSubmit={save} className="flex flex-col gap-4">
          {readOnly ? (
            <p className="text-xs" style={{ color: MUTED }}>
              {readOnlyNote(org.orgType)}
            </p>
          ) : null}
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {messageSettingsNote(org.orgType)}
          </p>

          {MESSAGE_KINDS.map((kind) => (
            <Message key={kind} kind={kind} org={org} draft={draft} edit={edit} locked={readOnly || saving} checkIn={checkIn} attendanceTo={attendanceTo} />
          ))}

          {saveError !== null ? <ConsoleFailed message={saveError} /> : null}

          <div className="flex items-center gap-3">
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
            {saved ? (
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Saved. It holds from the next message sent.
              </span>
            ) : changed ? (
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Not saved yet.
              </span>
            ) : null}
          </div>
        </form>
      )}
    </ConsoleSection>
  );
}
