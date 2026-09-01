import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Copy, Loader2, Plus, X } from 'lucide-react';
import { ConsoleFailed, ConsoleSection } from './ConsoleStates';
import {
  WEEKDAYS,
  closureAbsentReason,
  copyDayToAll,
  daySummary,
  gymToday,
  hourChoices,
  joinClock,
  minuteChoices,
  hoursDraft,
  hoursProblem,
  hoursRequest,
  hoursSummary,
  sameHoursDraft,
  splitClock,
} from '../../pages/console/hoursView';
import { canManageOrg } from '../../pages/console/gymDetailsView';
import { READ_ONLY_NOTE } from '../../pages/console/billingView';
import { refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import { orgService, errorText } from '../../api/orgsApi';

// WHEN WE'RE OPEN — the web half of Kd's opening-hours rulings (:26624, :26684,
// :26736). The server half shipped 2026-09-01 with four routes and no caller;
// this is the caller.
//
// **THE `unset` STATE IS THE WHOLE PANEL'S SUBJECT, not a corner of it.** A gym
// that has never filled this in has no session rows — byte-identical to a gym
// that is genuinely shut every day — so every sentence on this screen and on the
// member's card branches on the MODE before drawing a word. Printing "Closed"
// for a gym that has simply not answered is :5807 and would have hit every
// existing gym on day one.
//
// IT READS ITS OWN DATA, unlike `GymDetailsPanel` next door, and that is
// deliberate: hours are not on the console's kept org answer (the server keeps
// them off `/v1/orgs/mine`, which is loaded on every dashboard paint and capped
// at 100 gyms). So this panel owns one read, and passes `forceOpen` when that
// read fails — a failure that arrives while the section is shut would otherwise
// be invisible, which is `StaffPanel`'s case and its reason for the same flag.
//
// WHO SEES IT: whoever holds `org.manage` — the owner by default, and a manager
// an owner has ticked it across to. It asks for the POWER, never the job title
// (:16095's Critical/High). Hiding is not the enforcement; the server refuses
// every request either way (R3.3).

const inputStyle = {
  background: '#0A0908',
  border: '1px solid rgba(255,255,255,0.10)',
  color: '#fff',
};

/** `_ _ : _ _` — HOUR, MINUTE, and AM/PM when the gym reads on a 12-hour clock.
 *
 *  Kd, 2026-09-01: *"in the time select this is what i meant _ _ : _ _ here when
 *  the gym clicks they can set the time theself by selecting number but you have
 *  give soem already set time"*. **The first version was ONE dropdown of 96
 *  pre-made times and he was right that it is the wrong shape** — a person
 *  setting a clock picks an hour and then a minute, and a 96-item list is a
 *  scroll where three short lists are three glances.
 *
 *  **Every box starts EMPTY and shows `--`.** Nothing is chosen on the gym's
 *  behalf, and `hoursProblem` refuses to save while any part is unfilled — a box
 *  sitting on the first option would be the screen answering a question nobody
 *  asked.
 *
 *  **24:00 lives in the HOUR list on the closing end only**, spelled out as
 *  midnight at the end of the day, and its minute is fixed at `00` because there
 *  is no 24:15. */
function TimePick({ label, kind, value, clockFormat, onChange, disabled }) {
  /** **THE THREE BOXES HOLD THEIR OWN HALF-FINISHED STATE, and they have to.**
   *
   *  The draft stores one string per end (`"06:30"`), which cannot express
   *  *"the hour is 6 and the minute is not chosen yet"*. Deriving all three
   *  boxes from that string meant picking the hour produced `''` — nothing is
   *  complete — and the hour box snapped straight back to `--`. **The first
   *  version did exactly that and the control was unusable: neither box would
   *  hold what you picked.** Caught by the render test that drives the two
   *  boxes separately, which is how a person uses them.
   *
   *  So the parts live here and the joined string goes OUT. `hoursProblem` is
   *  still what refuses to save a row that is half-filled — nothing here
   *  invents the missing half. */
  const [parts, setParts] = useState(() => splitClock(value, clockFormat));
  const [lastValue, setLastValue] = useState(value);
  const [lastFormat, setLastFormat] = useState(clockFormat);

  // The prop moved under us — a save came back, the week was copied across, or
  // the gym switched clock. React's own pattern for state derived from a prop,
  // so there is no frame in which the boxes and the row disagree.
  if (value !== lastValue || clockFormat !== lastFormat) {
    setLastValue(value);
    setLastFormat(clockFormat);
    setParts(splitClock(value, clockFormat));
  }

  const hours = hourChoices(kind, clockFormat);
  const minutes = minuteChoices();
  const endOfDay = parts.hour === 24;

  const emit = (next) => {
    const merged = { ...parts, ...next };
    setParts(merged);
    const joined = joinClock(merged, clockFormat);
    // `lastValue` is moved with it so the sync above does not immediately
    // overwrite a half-finished pick with the row's still-empty string.
    setLastValue(joined);
    onChange(joined);
  };

  const boxStyle = { ...inputStyle, opacity: disabled ? 0.5 : 1 };

  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={parts.hour === null ? '' : String(parts.hour)}
        onChange={(e) => {
          const hour = e.target.value === '' ? null : Number(e.target.value);
          // The end-of-day entry has no minutes to choose, and picking it must
          // not leave a stale `:45` behind it.
          emit(hour === 24 ? { hour, minute: 0 } : { hour });
        }}
        disabled={disabled}
        aria-label={`${label} hour`}
        className="rounded-lg px-2 py-1.5 text-sm"
        style={boxStyle}
      >
        <option value="">--</option>
        {hours.map((h) => (
          <option key={h.value} value={h.value}>
            {h.label}
          </option>
        ))}
      </select>

      <span className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
        :
      </span>

      <select
        value={parts.minute === null ? '' : String(parts.minute)}
        onChange={(e) => emit({ minute: e.target.value === '' ? null : Number(e.target.value) })}
        disabled={disabled || endOfDay}
        aria-label={`${label} minute`}
        className="rounded-lg px-2 py-1.5 text-sm"
        style={{ ...boxStyle, opacity: disabled || endOfDay ? 0.5 : 1 }}
      >
        <option value="">--</option>
        {minutes.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>

      {/* AM/PM ONLY ON THE 12-HOUR CLOCK — it is meaningless on the other one,
          and the end-of-day entry already says "midnight" in its own label. */}
      {clockFormat === '12h' && !endOfDay ? (
        <select
          value={parts.meridiem ?? ''}
          onChange={(e) => emit({ meridiem: e.target.value === '' ? null : e.target.value })}
          disabled={disabled}
          aria-label={`${label} AM or PM`}
          className="rounded-lg px-2 py-1.5 text-sm"
          style={boxStyle}
        >
          <option value="">--</option>
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      ) : null}
    </span>
  );
}

export default function OpeningHoursPanel({ org, privileges, readOnly = false }) {
  const allowed = canManageOrg(privileges);
  const gymId = org?.id;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [hours, setHours] = useState(null);

  const [lastSeen, setLastSeen] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  const [closureDay, setClosureDay] = useState('');
  const [closureNote, setClosureNote] = useState('');
  const [closureBusy, setClosureBusy] = useState(false);
  const [closureError, setClosureError] = useState(null);
  const [closureNotice, setClosureNotice] = useState(null);

  /** WHICH DAYS ARE UNFOLDED — Kd, 2026-09-01: *"if gym adds multiple times
   *  then a box becomes ttoo big there should be hide or drop button for the
   *  other day so when click it shows and if click again then only again undo
   *  the drop clicking other day should not undo the drop"*.
   *
   *  **A SET, NOT A SINGLE VALUE, AND THAT IS THE RULING RATHER THAN A
   *  DETAIL.** A single `openDay` would make this an accordion where opening
   *  Tuesday shuts Monday, which is exactly what he said must not happen. Each
   *  day is its own toggle and a day closes only when that same day is
   *  clicked again.
   *
   *  **Everything starts FOLDED**, because the folded row already shows the
   *  day's times — the point was a shorter screen, not a hidden one. */
  const [openDays, setOpenDays] = useState(() => new Set());
  const [clockSaving, setClockSaving] = useState(false);

  /** ONE FETCH, TWO CALLERS — the mount effect and the retry button. Written
   *  once rather than twice because the two differ only in cancellation, and a second
   *  copy is where the error arm and the success arm drift apart.
   *
   *  `isLive` lets the effect drop a late answer after unmount; the retry passes
   *  nothing, because a person pressed it and the panel is on screen. */
  const fetchHours = useCallback(
    (isLive = () => true) =>
      orgService
        .getHours(gymId)
        .then((res) => {
          if (!isLive()) return;
          const next = res.data?.hours ?? null;
          setHours(next);
          const fresh = hoursDraft(next);
          setLastSeen(fresh);
          setDraft(fresh);
          setLoading(false);
        })
        .catch((err) => {
          if (!isLive()) return;
          // NOT AN EMPTY STATE. A failed read must never be drawn as "this gym
          // has no opening times" — that is :8267's class, and here it would put
          // the very sentence :26736 forbids in front of an owner. The section
          // forces itself open so the failure is seen rather than hidden behind
          // a heading.
          setLoadError(errorText(err, "We couldn't load your opening times."));
          setLoading(false);
        }),
    // `useCallback` rather than an eslint exemption: the only thing this closes
    // over is `gymId` (the setters are stable), so the identity is honest and
    // the effect below can depend on it without re-reading on every keystroke.
    [gymId],
  );

  const retry = () => {
    setLoading(true);
    setLoadError(null);
    void fetchHours();
  };

  useEffect(() => {
    if (gymId === undefined) return undefined;
    let cancelled = false;
    void fetchHours(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [gymId, fetchHours]);

  const timezone = hours?.timezone ?? org?.timezone ?? 'UTC';
  const today = gymToday(timezone);
  /** THE GYM'S OWN CLOCK, from the hours read and falling back to the org
   *  row the console already holds — so the switch below shows the right
   *  state before the read lands, and a gym that has never set hours still
   *  has a clock to be asked about. */
  const clockFormat = hours?.clockFormat ?? org?.clockFormat ?? '24h';
  const problem = draft === null ? null : hoursProblem(draft, clockFormat);
  const request = draft === null ? null : hoursRequest(draft);
  const touched = draft !== null && lastSeen !== null && !sameHoursDraft(draft, lastSeen);
  const canSave = allowed && !readOnly && !saving && request !== null && problem === null && touched;

  const edit = (next) => {
    setDraft(next);
    // A confirmation about bytes that are no longer on screen is a false
    // sentence; a refusal left standing reads as a refusal of what is there now.
    setSaved(false);
    setSaveError(null);
  };

  const setMode = (mode) => {
    if (draft === null) return;
    edit({ ...draft, mode });
  };

  const editSession = (weekday, index, field, value) => {
    if (draft === null) return;
    edit({
      ...draft,
      days: draft.days.map((day) =>
        day.weekday !== weekday
          ? day
          : {
              ...day,
              sessions: day.sessions.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
            },
      ),
    });
  };

  const addSession = (weekday) => {
    if (draft === null) return;
    edit({
      ...draft,
      days: draft.days.map((day) =>
        day.weekday !== weekday
          ? day
          : { ...day, sessions: [...day.sessions, { opens: '', closes: '' }] },
      ),
    });
  };

  /** FOLD OR UNFOLD ONE DAY. Every other day is left exactly as it was — that is
   *  Kd's *"clicking other day should not undo the drop"*, and it is why this
   *  copies the Set instead of replacing it with one value. */
  const toggleDay = (weekday) => {
    setOpenDays((current) => {
      const next = new Set(current);
      if (next.has(weekday)) next.delete(weekday);
      else next.add(weekday);
      return next;
    });
  };

  /** "SAME EVERY DAY" — copy this day's times onto the other six. It overwrites,
   *  which is his own sentence: the button means *these are my hours*, and the
   *  way he described changing one afterwards only works if the copy landed
   *  everywhere first. */
  const applyToAll = (weekday) => {
    if (draft === null) return;
    edit(copyDayToAll(draft, weekday));
  };

  /** THE CLOCK SWITCH SAVES ON ITS OWN, and it does NOT go through the hours
   *  form.
   *
   *  It rides on `PATCH /v1/orgs/:gymId` rather than `PUT /hours` for a reason
   *  that is not tidiness: a gym which has never SET hours cannot send a `PUT`
   *  at all (`unset` is not a sendable mode), and that gym is precisely the one
   *  sitting on this screen about to type its first timetable — it must be able
   *  to pick its clock first. It also means flipping the display never touches
   *  the week, so it cannot fail for a reason about opening times.
   *
   *  **The console's kept org answer is refreshed quietly afterwards**, because
   *  the same row feeds this panel's fallback and every other screen. */
  const changeClock = async (next) => {
    if (!allowed || readOnly || clockSaving || next === clockFormat) return;
    setClockSaving(true);
    setSaveError(null);
    try {
      await orgService.updateOrg(gymId, { clockFormat: next });
      setHours((current) => (current === null ? current : { ...current, clockFormat: next }));
      refreshConsoleOrgsAfterChange();
    } catch (err) {
      setSaveError(errorText(err, "We couldn't change the clock. Please try again."));
    } finally {
      setClockSaving(false);
    }
  };

  const removeSession = (weekday, index) => {
    if (draft === null) return;
    edit({
      ...draft,
      days: draft.days.map((day) =>
        day.weekday !== weekday
          ? day
          : { ...day, sessions: day.sessions.filter((_, i) => i !== index) },
      ),
    });
  };

  const save = async (e) => {
    e.preventDefault();
    // THE SECOND DOOR. The button is disabled in every one of these states, but a
    // form submits on Enter too and browsers differ on whether a disabled default
    // button stops that — `GymDetailsPanel`'s recorded reason, and `readOnly` is
    // in here for exactly it: without this line a lapsed gym's owner would fire
    // the request from a time box and meet the server's 409.
    if (!canSave || request === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await orgService.setHours(gymId, request);
      const next = res.data?.hours ?? null;
      setHours(next);
      // THE SERVER'S OWN ANSWER GOES BACK INTO THE FORM, never the draft: it is
      // the normalised one (sessions sorted, empty days dropped), and it is what
      // makes Save go quiet afterwards, since the draft and the row now agree.
      const fresh = hoursDraft(next);
      setLastSeen(fresh);
      setDraft(fresh);
      setSaved(true);
    } catch (err) {
      setSaveError(errorText(err, "We couldn't save your opening times. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  const closeDay = async (e) => {
    e.preventDefault();
    if (!allowed || readOnly || closureBusy || closureDay === '') return;
    setClosureBusy(true);
    setClosureError(null);
    setClosureNotice(null);
    try {
      const body = closureNote.trim() === '' ? { day: closureDay } : { day: closureDay, note: closureNote.trim() };
      const res = await orgService.closeDay(gymId, body);
      setHours(res.data?.hours ?? null);
      // **THE SAVE CAN SUCCEED AND NOT APPEAR, and saying so is this card's
      // carry-forward from T3 round 1.** The write has no date window on purpose
      // (a gym typing last night's closure in at 1am is telling the truth late)
      // while the read is today-forward and capped at a year — so re-rendering
      // the reply and stopping there would look exactly like a silent failure.
      setClosureNotice(closureAbsentReason(closureDay, today));
      setClosureDay('');
      setClosureNote('');
    } catch (err) {
      setClosureError(errorText(err, "We couldn't save that. Please try again."));
    } finally {
      setClosureBusy(false);
    }
  };

  const undoClosure = async (day) => {
    if (!allowed || readOnly || closureBusy) return;
    setClosureBusy(true);
    setClosureError(null);
    setClosureNotice(null);
    try {
      const res = await orgService.removeClosure(gymId, day);
      setHours(res.data?.hours ?? null);
    } catch (err) {
      setClosureError(errorText(err, "We couldn't undo that. Please try again."));
    } finally {
      setClosureBusy(false);
    }
  };

  const controlsOff = !allowed || readOnly || saving;

  return (
    <ConsoleSection
      title="When we're open"
      summary={loading || loadError !== null ? 'Your opening times.' : hoursSummary(hours)}
      /* FORCED OPEN ON A FAILED READ — `StaffPanel`'s rule and its reason. This
         panel fetches, so it has a failure that can arrive while the section is
         shut, and a heading that says nothing about it is a failure nobody
         sees. */
      forceOpen={loadError !== null}
    >
      <div className="flex flex-col gap-5">
        {readOnly ? (
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {READ_ONLY_NOTE}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading your opening times…
          </p>
        ) : loadError !== null ? (
          <ConsoleFailed message={loadError} onRetry={retry} />
        ) : (
          <>
            <form onSubmit={save} className="flex flex-col gap-5">
              {/* THE THREE STATES, AND `unset` IS SHOWN BUT NOT SELECTABLE.
                  A gym that has answered cannot un-answer — the server's union
                  does not admit `unset` — so offering it as a choice would be a
                  control that always fails. It appears only while it is the
                  gym's current state, so an owner can see where they are. */}
              {/* THE CLOCK THIS GYM READS ITS OWN HOURS ON — Kd, 2026-09-01:
                  *"for time both format shpuld be ther gym can choose format
                  like it will be 4 or 16"*.

                  **IT SAVES ON ITS OWN, outside the form below**, and is a
                  `PATCH` on the gym rather than part of `PUT /hours` — a gym
                  that has never set hours cannot send that request at all, and
                  that gym is exactly the one about to type its first timetable.
                  So the clock has to be pickable first.

                  It changes every screen this gym owns, its MEMBERS' cards
                  included: one gym, one clock, or the two disagree about the
                  same Monday. */}
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  Which clock do you use?
                </legend>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm" style={{ color: '#fff' }}>
                    <input
                      type="radio"
                      name="clock-format"
                      checked={clockFormat === '12h'}
                      onChange={() => void changeClock('12h')}
                      disabled={!allowed || readOnly || clockSaving}
                    />
                    12-hour <span style={{ color: 'rgba(255,255,255,0.45)' }}>(4:00 PM)</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm" style={{ color: '#fff' }}>
                    <input
                      type="radio"
                      name="clock-format"
                      checked={clockFormat === '24h'}
                      onChange={() => void changeClock('24h')}
                      disabled={!allowed || readOnly || clockSaving}
                    />
                    24-hour <span style={{ color: 'rgba(255,255,255,0.45)' }}>(16:00)</span>
                  </label>
                </div>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  This is how times are shown to you and to your members.
                </p>
              </fieldset>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  When is your gym open?
                </legend>
                {draft?.mode === 'unset' ? (
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    You haven&apos;t said yet. Until you do, your members aren&apos;t shown
                    anything about your opening times.
                  </p>
                ) : null}
                <label className="flex items-center gap-2 text-sm" style={{ color: '#fff' }}>
                  <input
                    type="radio"
                    name="hours-mode"
                    checked={draft?.mode === 'open_24h'}
                    onChange={() => setMode('open_24h')}
                    disabled={controlsOff}
                  />
                  Open 24 hours
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: '#fff' }}>
                  <input
                    type="radio"
                    name="hours-mode"
                    checked={draft?.mode === 'scheduled'}
                    onChange={() => setMode('scheduled')}
                    disabled={controlsOff}
                  />
                  Set opening times
                </label>
              </fieldset>

              {draft?.mode === 'scheduled' ? (
                <div className="flex flex-col gap-2">
                  {/* SAID ONCE, HERE, INSTEAD OF EVERY EMPTY ROW CLAIMING IT.
                      Kd: *"if time is not chosen then beside day why closed is
                      showing?"* — a day nobody has filled in is not a day the gym
                      has said it is shut, and a row asserting that while somebody
                      is still typing is the screen answering for them. The rule
                      is true and belongs above the list, not on each line. */}
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    A day with no times is a day you are closed.
                  </p>
                  {WEEKDAYS.map((weekday) => {
                    const day = draft.days.find((d) => d.weekday === weekday.iso);
                    const sessions = day?.sessions ?? [];
                    const isOpen = openDays.has(weekday.iso);
                    return (
                      <div
                        key={weekday.iso}
                        className="rounded-xl"
                        style={{ background: 'rgba(255,255,255,0.03)' }}
                      >
                        {/* THE FOLDED ROW STILL SAYS WHAT THE DAY IS, which is
                            what makes folding an honest default: the point was a
                            shorter screen, not a hidden one, so a gym reads its
                            whole week here without opening anything. */}
                        <button
                          type="button"
                          onClick={() => toggleDay(weekday.iso)}
                          aria-expanded={isOpen}
                          className="w-full text-left flex items-center justify-between gap-3 p-3"
                        >
                          <span className="text-sm font-medium" style={{ color: '#fff' }}>
                            {weekday.label}
                          </span>
                          <span className="flex items-center gap-2 min-w-0">
                            <span
                              className="text-xs truncate"
                              style={{ color: 'rgba(255,255,255,0.45)' }}
                            >
                              {daySummary(sessions, clockFormat)}
                            </span>
                            <ChevronDown
                              className="w-4 h-4 flex-shrink-0 transition-transform"
                              style={{
                                color: 'rgba(255,255,255,0.45)',
                                transform: isOpen ? 'rotate(180deg)' : 'none',
                              }}
                            />
                          </span>
                        </button>

                        {isOpen ? (
                          <div className="px-3 pb-3">
                            {sessions.map((session, index) => (
                              <div key={index} className="flex items-center gap-2 mb-2">
                                {/* THE LABEL CARRIES THE SESSION NUMBER, and it
                                    is not cosmetic: a day can hold many, so
                                    without it three controls are indistinguishable
                                    to a screen reader and unaddressable to a
                                    test. */}
                                <TimePick
                                  label={`${weekday.label} session ${String(index + 1)} opens`}
                                  kind="opens"
                                  value={session.opens}
                                  clockFormat={clockFormat}
                                  onChange={(v) => editSession(weekday.iso, index, 'opens', v)}
                                  disabled={controlsOff}
                                />
                                <span className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
                                  to
                                </span>
                                <TimePick
                                  label={`${weekday.label} session ${String(index + 1)} closes`}
                                  kind="closes"
                                  value={session.closes}
                                  clockFormat={clockFormat}
                                  onChange={(v) => editSession(weekday.iso, index, 'closes', v)}
                                  disabled={controlsOff}
                                />
                                <button
                                  type="button"
                                  onClick={() => removeSession(weekday.iso, index)}
                                  disabled={controlsOff}
                                  aria-label={`Remove ${weekday.label} session ${String(index + 1)}`}
                                  className="p-1 rounded-lg"
                                  style={{
                                    color: 'rgba(255,255,255,0.55)',
                                    opacity: controlsOff ? 0.5 : 1,
                                  }}
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ))}

                            <div className="flex flex-wrap items-center gap-4">
                              <button
                                type="button"
                                onClick={() => addSession(weekday.iso)}
                                disabled={controlsOff}
                                className="text-xs inline-flex items-center gap-1"
                                style={{ color: '#FF8A1F', opacity: controlsOff ? 0.5 : 1 }}
                              >
                                <Plus className="w-3 h-3" />
                                Add a time
                              </button>

                              {/* ONLY ON A DAY THAT HAS SOMETHING TO COPY. The
                                  button on an empty day would clear the whole
                                  week in one click, which is a destructive act
                                  wearing a convenience's label. */}
                              {sessions.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => applyToAll(weekday.iso)}
                                  disabled={controlsOff}
                                  className="text-xs inline-flex items-center gap-1"
                                  style={{ color: '#FF8A1F', opacity: controlsOff ? 0.5 : 1 }}
                                >
                                  <Copy className="w-3 h-3" />
                                  Use these times every day
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {/* THE PROBLEM IS SHOWN BEFORE SAVE, not after a refusal. Every
                  sentence here mirrors a rule the SERVER enforces — this is the
                  courtesy, that is the enforcement (R3.3). */}
              {problem !== null ? (
                <p className="text-sm" style={{ color: '#ef4444' }}>
                  {problem}
                </p>
              ) : null}
              {saveError !== null ? (
                <p className="text-sm" style={{ color: '#ef4444' }}>
                  {saveError}
                </p>
              ) : null}
              {saved ? (
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  Saved.
                </p>
              ) : null}

              <div>
                <button
                  type="submit"
                  disabled={!canSave}
                  className="rounded-xl px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-2"
                  style={{
                    background: canSave ? '#FF8A1F' : 'rgba(255,255,255,0.08)',
                    color: canSave ? '#0A0908' : 'rgba(255,255,255,0.45)',
                  }}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Save opening times
                </button>
              </div>
            </form>

            {/* ── CLOSED ON A DATE ────────────────────────────────────────────
                THE DATED OVERRIDE, and it is a DIFFERENT MECHANISM from the week
                above — the trap Kd named (:26684 §3). "Closed every Sunday" is
                the weekly pattern (that day simply holds no sessions); "closed
                on the 25th" is this. A second way to say the recurring one would
                let a gym's two answers disagree, so there is no repeat option
                here and there must never be one. */}
            <div className="pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
                Closed on a date
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                For a holiday or a one-off. It clears itself once the date has passed.
              </p>

              <form onSubmit={closeDay} className="flex flex-wrap items-end gap-2 mt-3">
                <label className="block">
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    Date
                  </span>
                  <input
                    type="date"
                    value={closureDay}
                    onChange={(e) => setClosureDay(e.target.value)}
                    /* THE WHOLE BOX OPENS THE CALENDAR — Kd, 2026-09-01:
                       *"for date i have to hand type men"*. A `type="date"`
                       input already HAS a calendar, behind a small icon at
                       its right edge that he did not find and should not have
                       to — clicking anywhere in the field now opens it.
                       `showPicker` throws where it is unsupported or not
                       user-activated, and typing must keep working in that
                       case, so the failure is swallowed rather than
                       surfaced. */
                    onClick={(e) => {
                      try {
                        e.currentTarget.showPicker();
                      } catch {
                        /* older browser, or not user-activated — typing still works */
                      }
                    }}
                    /* **NO `min` AND NO `max`, AND THAT IS A DECISION THIS CARD
                       MADE THE HARD WAY.** Both were here first, set to the
                       gym's own today and the server's one-year read horizon —
                       and the render test found that an HTML `min` is a
                       CONSTRAINT, not a hint: the form silently refuses to
                       submit at all, with no event and no sentence. It made a
                       past closure IMPOSSIBLE to record from this screen.

                       The server accepts one deliberately — *a gym typing last
                       night's closure in at 1am is telling the truth late* — so
                       bounding the box here would have removed a capability the
                       server offers and left the owner staring at a dead button
                       with nothing on screen to explain it. The guardrail is
                       `closureAbsentReason` below, which lets the save happen
                       and then says what became of it. */
                    disabled={!allowed || readOnly || closureBusy}
                    aria-label="Date to close"
                    className="block mt-1 rounded-lg px-2 py-1.5 text-sm"
                    style={inputStyle}
                  />
                </label>
                <label className="block flex-1 min-w-[10rem]">
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    Reason (optional)
                  </span>
                  <input
                    type="text"
                    value={closureNote}
                    onChange={(e) => setClosureNote(e.target.value)}
                    maxLength={120}
                    placeholder="Holi"
                    disabled={!allowed || readOnly || closureBusy}
                    aria-label="Reason"
                    className="block w-full mt-1 rounded-lg px-2 py-1.5 text-sm"
                    style={inputStyle}
                  />
                </label>
                <button
                  type="submit"
                  disabled={!allowed || readOnly || closureBusy || closureDay === ''}
                  className="rounded-xl px-3 py-2 text-sm font-semibold"
                  style={{
                    background:
                      !allowed || readOnly || closureBusy || closureDay === ''
                        ? 'rgba(255,255,255,0.08)'
                        : '#FF8A1F',
                    color:
                      !allowed || readOnly || closureBusy || closureDay === ''
                        ? 'rgba(255,255,255,0.45)'
                        : '#0A0908',
                  }}
                >
                  Mark closed
                </button>
              </form>

              {closureError !== null ? (
                <p className="text-sm mt-2" style={{ color: '#ef4444' }}>
                  {closureError}
                </p>
              ) : null}
              {closureNotice !== null ? (
                <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  {closureNotice}
                </p>
              ) : null}

              {(hours?.closures ?? []).length > 0 ? (
                <ul className="flex flex-col gap-2 mt-3">
                  {hours.closures.map((closure) => (
                    <li key={closure.day} className="flex items-center justify-between gap-3">
                      <span className="text-sm" style={{ color: '#fff' }}>
                        {closure.day}
                        {closure.note !== null && closure.note !== '' ? (
                          <span style={{ color: 'rgba(255,255,255,0.55)' }}> — {closure.note}</span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        onClick={() => void undoClosure(closure.day)}
                        disabled={!allowed || readOnly || closureBusy}
                        className="text-xs"
                        style={{
                          color: '#FF8A1F',
                          opacity: !allowed || readOnly || closureBusy ? 0.5 : 1,
                        }}
                      >
                        Undo
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                /* NOT "nothing here yet" OVER A FAILED READ — this arm is only
                   reachable once the read has SUCCEEDED (the failure arm returns
                   above), so it is a real absence and says so plainly. */
                <p className="text-sm mt-3" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  No dates coming up.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </ConsoleSection>
  );
}
