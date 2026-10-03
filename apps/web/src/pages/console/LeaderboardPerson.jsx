import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, X } from 'lucide-react';
import { staffLeaderboardService } from '../../api/leaderboardApi';
import { errorText, orgService } from '../../api/orgsApi';
import {
  BOARD_TABS,
  PERIODS,
  dayCountText,
  dayLabel,
  ordinal,
  valueText,
  visitText,
  weekText,
  workoutCountText,
} from '../../components/gym/leaderboardView';
import { gymToday } from './hoursView';
import {
  HIDDEN_TAG,
  addVisitBox,
  addVisitWindow,
  hiddenLine,
  nameOf,
  panelPlace,
  removeVisitBox,
  staffVisitNotCountedText,
  staffWorkoutNotCountedText,
  takeOffBox,
} from './leaderboardStaffView';

// One person on the console's leaderboard (ROADMAP 19a-iii): their place and number on all
// three boards, what counted for each, and Take off the board / Put back. Before either
// happens a box names who changes and what is kept. In the middle on a computer, from the
// bottom on a phone, as Members' boxes. Staff who check people in also fix a visit here
// (19a-iv): Remove beside each visit and Add a visit under Gym days, each behind its own box.

function Counted({ gymId, userId, boardId, period, canFix, onRemove, onAdd }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  useEffect(() => {
    let live = true;
    staffLeaderboardService.counted(gymId, userId, boardId, period).then(
      (data) => live && setState({ loading: false, error: null, data }),
      (err) => live && setState({ loading: false, error: errorText(err, "We couldn't load what counted."), data: null }),
    );
    return () => {
      live = false;
    };
  }, [gymId, userId, boardId, period]);

  if (state.loading) {
    return (
      <p className="c-s14 c-t2 flex items-center gap-2">
        <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading…
      </p>
    );
  }
  if (state.error !== null) {
    return (
      <p className="c-s14 c-t1" role="alert">
        {state.error}
      </p>
    );
  }
  const d = state.data;
  const missed = boardId === 'gym_days' ? d.notCounted : boardId === 'workout_days' ? d.workoutsNotCounted : [];
  return (
    <div className="flex flex-col gap-3" data-testid={`counted-${boardId}`}>
      {boardId === 'gym_days' ? (
        d.days.length === 0 ? (
          <p className="c-s14 c-t2">No gym days in this period.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {d.days.map((day) => (
              <li key={day.day} className="flex flex-col gap-0.5">
                <span className="c-s14 c-t1">
                  {dayLabel(day.day)} <span className="c-t2">· {dayCountText(day.visits.length)}</span>
                </span>
                {day.visits.map((v) => (
                  <span key={v.id} className="c-s13 c-t2 flex items-center justify-between gap-3">
                    <span>{visitText(v, d.timezone)}</span>
                    {canFix ? (
                      <button
                        type="button"
                        onClick={() => onRemove(v, day, d)}
                        aria-label={`Remove the visit on ${dayLabel(day.day)}: ${visitText(v, d.timezone)}`}
                        className="c-btn c-btn-link c-btn-sm flex-shrink-0"
                      >
                        Remove
                      </button>
                    ) : null}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )
      ) : null}
      {boardId === 'gym_days' && canFix ? (
        <button type="button" onClick={() => onAdd(d)} data-testid="add-visit-open" className="c-btn c-btn-s c-btn-sm self-start">
          Add a visit
        </button>
      ) : null}
      {boardId === 'workout_days' ? (
        d.workoutDays.length === 0 ? (
          <p className="c-s14 c-t2">No workout days in this period.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {d.workoutDays.map((day) => (
              <li key={day.day} className="c-s14 c-t1">
                {dayLabel(day.day)} <span className="c-t2">· {workoutCountText(day.workouts)}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {boardId === 'streak' ? (
        d.weeks.length === 0 ? (
          <p className="c-s14 c-t2">No streak.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {d.weeks.map((w) => {
              const line = weekText(w, d.gymName);
              return (
                <li key={w.weekStart} className="c-s14 flex justify-between gap-3">
                  <span className="c-t1">{line.label}</span>
                  <span className="c-t2 text-right">{line.text}</span>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
      {missed.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="c-th">Didn&apos;t count</span>
          <ul className="flex flex-col gap-1">
            {missed.map((n, i) => (
              <li key={`${n.day}-${i}`} className="c-s13 c-t2">
                {dayLabel(n.day)} · {boardId === 'gym_days' ? staffVisitNotCountedText(n) : staffWorkoutNotCountedText(n, d.gymName)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function LeaderboardPerson({ gymId, gym, orgSlug, row, period, words, readOnly, canFix, onClose, onChanged }) {
  const [state, setState] = useState({ loading: true, error: null, profile: null });
  /** The board whose "what counted" is open. */
  const [counted, setCounted] = useState(null);
  /** The take-off or put-back box: the value it would set. */
  const [asking, setAsking] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  /** The visit box: `{ kind: 'remove', visit, day, counted }` or `{ kind: 'add', counted }`. */
  const [fix, setFix] = useState(null);
  const [fixDay, setFixDay] = useState('');
  /** Read "what counted" again after a visit changed. */
  const [countedRead, setCountedRead] = useState(0);

  // The page behind holds still while the box is open.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  const load = useCallback(
    () =>
      staffLeaderboardService.profile(gymId, row.userId, period).then(
        (profile) => setState({ loading: false, error: null, profile }),
        (err) => setState({ loading: false, error: errorText(err, "We couldn't load this person."), profile: null }),
      ),
    [gymId, row.userId, period],
  );
  useEffect(() => {
    load();
  }, [load]);

  const profile = state.profile;
  const person = profile ?? row;
  const periodLabel = PERIODS.find((p) => p.id === period)?.label.toLowerCase() ?? '';
  // The box is built from the server's answer for the person, never from the row alone.
  const fixBox =
    fix === null
      ? null
      : fix.kind === 'remove'
        ? { ...removeVisitBox(nameOf(person), fix.visit, fix.day, fix.counted), ready: true }
        : addVisitBox(nameOf(person), fixDay, fix.counted);
  const box = fixBox ?? (asking === null || profile === null ? null : takeOffBox(profile, asking, gym.name, words));
  const addWindow = addVisitWindow(gymToday(gym.timezone));

  const closeBox = () => {
    setAsking(null);
    setFix(null);
    setFixDay('');
    setSaveError(null);
  };

  const pressFix = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      if (fix.kind === 'remove') {
        await orgService.removeVisit(gymId, fix.visit.id);
        onChanged(fixBox.done);
      } else {
        const res = await orgService.addVisit(gymId, { userId: row.userId }, fixDay);
        onChanged(
          res.data.result === 'added' ? fixBox.done : `${nameOf(person)} already had a visit that counts on that day. Nothing was added.`,
        );
      }
      closeBox();
      setCountedRead((n) => n + 1);
      await load();
    } catch (err) {
      setSaveError(errorText(err, "We couldn't change that. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  const press = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await staffLeaderboardService.setTakenOff(gymId, row.userId, asking);
      onChanged(box.done);
      setAsking(null);
      await load();
    } catch (err) {
      setSaveError(errorText(err, "We couldn't change that. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  let body;
  if (state.loading) {
    body = (
      <p className="c-s14 c-t2 flex items-center gap-2">
        <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading…
      </p>
    );
  } else if (profile === null) {
    body = (
      <p className="c-s14 c-t1" role="alert">
        {state.error}
      </p>
    );
  } else if (box !== null) {
    body = (
      <div className="flex flex-col gap-5" data-testid={fix !== null ? 'visit-box' : 'take-off-box'}>
        {fix?.kind === 'add' ? (
          <label className="c-field">
            <span className="c-label">Day they came</span>
            <input
              type="date"
              className="c-input"
              value={fixDay}
              min={addWindow.min}
              max={addWindow.max}
              onChange={(e) => setFixDay(e.target.value)}
              data-testid="add-visit-day"
            />
            <span className="c-s13 c-t2">An earlier day, up to 62 days back. For today, use Check in on Attendance.</span>
          </label>
        ) : null}
        <section className="flex flex-col gap-1.5">
          <h3 className="c-s16 c-w6 c-t1">What changes</h3>
          {box.changes.map((line) => (
            <p key={line} className="c-s15 c-t1">
              {line}
            </p>
          ))}
        </section>
        {box.keeps.length > 0 ? (
          <section className="flex flex-col gap-1.5">
            <h3 className="c-s16 c-w6 c-t1">What stays the same</h3>
            {box.keeps.map((line) => (
              <p key={line} className="c-s15 c-t2">
                {line}
              </p>
            ))}
          </section>
        ) : null}
      </div>
    );
  } else {
    const reason = hiddenLine(profile.hidden, words);
    body = (
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <span className="c-avatar" aria-hidden="true">
            {profile.initials}
          </span>
          <div className="flex flex-col gap-1 min-w-0">
            {profile.hidden !== null ? (
              <span className="c-tag c-tag-plain self-start">{HIDDEN_TAG[profile.hidden]}</span>
            ) : profile.boards.some((b) => b.place !== null) ? (
              <span className="c-tag c-tag-good self-start">On the board</span>
            ) : null}
            {reason !== null ? <span className="c-s14 c-t2">{reason}</span> : null}
          </div>
        </div>

        <section className="c-card overflow-hidden" aria-label="Their boards">
          {profile.boards.map((b) => {
            const label = BOARD_TABS.find((t) => t.id === b.board)?.label ?? '';
            const isOpen = counted === b.board;
            return (
              <div key={b.board} className="c-row" style={{ display: 'block' }} data-testid={`person-${b.board}`}>
                <div className="flex items-center gap-3">
                  <div className="flex flex-col gap-0.5 min-w-0 flex-grow">
                    <span className="c-s15 c-w6 c-t1">{b.board === 'streak' ? 'Streak' : `${label}, ${periodLabel}`}</span>
                    <span className="c-s14 c-t2">
                      {panelPlace(b, profile.hidden) ?? ordinal(b.place)} · {valueText(b.value, b.board)}
                    </span>
                  </div>
                  <button type="button" aria-expanded={isOpen} onClick={() => setCounted(isOpen ? null : b.board)} className="c-btn c-btn-link c-btn-sm">
                    {isOpen ? 'Hide' : 'What counted'}
                  </button>
                </div>
                {isOpen ? (
                  <div className="pt-3">
                    <Counted
                      key={countedRead}
                      gymId={gymId}
                      userId={row.userId}
                      boardId={b.board}
                      period={period}
                      canFix={canFix === true && !readOnly}
                      onRemove={(visit, day, data) => setFix({ kind: 'remove', visit, day, counted: data })}
                      onAdd={(data) => setFix({ kind: 'add', counted: data })}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>

        <p className="c-s14 c-t2">
          <Link to={`/console/${orgSlug}/members?view=app`} className="c-lk c-w6">
            {`Find them in ${words.peopleCap}`}
          </Link>
        </p>
      </div>
    );
  }

  let footer;
  if (box !== null) {
    footer = (
      <div className="flex flex-col gap-3 w-full">
        {saveError !== null ? (
          <p className="c-s14 c-t1" role="alert">
            {saveError}
          </p>
        ) : null}
        <div className="grid grid-cols-[1fr_auto] md:flex md:justify-end gap-2 md:gap-3">
          <button
            type="button"
            onClick={() => void (fix !== null ? pressFix() : press())}
            disabled={saving || (fix !== null && !fixBox.ready)}
            data-testid={fix !== null ? 'visit-press' : 'take-off-press'}
            className={`c-btn c-btn-lg md:order-2 ${asking || fix?.kind === 'remove' ? 'c-btn-danger' : 'c-btn-p'}`}
          >
            {saving ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            {box.button}
          </button>
          <button type="button" onClick={closeBox} disabled={saving} className="c-btn c-btn-s c-btn-lg md:order-1">
            Cancel
          </button>
        </div>
      </div>
    );
  } else {
    // Staff are never ranked, so there is nothing to take them off.
    const canChange = profile !== null && !profile.isStaff && !readOnly;
    footer = (
      <div className="grid grid-cols-[1fr_auto] md:flex md:justify-end gap-2 md:gap-3 w-full">
        {canChange ? (
          <button type="button" onClick={() => setAsking(!profile.takenOff)} data-testid="take-off-open" className="c-btn c-btn-s c-btn-lg md:order-2">
            {profile.takenOff ? 'Put back on the board' : 'Take off the board'}
          </button>
        ) : null}
        <button type="button" onClick={onClose} className="c-btn c-btn-s c-btn-lg md:order-1">
          Close
        </button>
      </div>
    );
  }

  const title = box !== null ? box.title : nameOf(person);
  return (
    <div className="fixed inset-0 z-50" style={{ background: 'var(--scrim)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="person-box"
        className="c-sheet absolute inset-x-0 bottom-0 top-16 md:top-16 md:bottom-auto md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[600px] md:max-h-[calc(100%-96px)] flex flex-col rounded-t-[20px] md:rounded-[20px] border"
        style={{ borderColor: 'var(--card-line)' }}
      >
        <div className="flex items-center gap-3 pl-4 pr-2 pt-3 md:px-7 md:pt-6 md:pb-2">
          <h2 className="c-h2 flex-grow" style={{ fontSize: 22, lineHeight: '28px', fontWeight: 700 }}>
            {title}
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="c-icon-btn">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 pt-2 pb-4 md:px-7 md:pt-3 md:pb-6 overflow-y-auto overscroll-contain flex-grow min-h-0">{body}</div>
        <div className="flex px-4 pt-3 pb-5 md:px-7 md:py-4 border-t md:justify-end" style={{ borderColor: 'var(--line)', background: 'var(--card)' }}>
          {footer}
        </div>
      </div>
    </div>
  );
}
