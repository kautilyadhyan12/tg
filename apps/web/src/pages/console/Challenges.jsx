import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarDays, Check, Gift, Medal, Pencil, Plus } from 'lucide-react';
import { staffChallengesService } from '../../api/challengesApi';
import { errorStatus, errorText } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { ordinal, updatedText } from '../../components/gym/leaderboardView';
import { DateField, Field } from './ClassFields';
import {
  CHALLENGE_LIMITS,
  CHALLENGE_NOTES,
  COUNT_CHOICES,
  LOCKED_NOTE,
  NUMBER_NOTES,
  boardButton,
  boardLines,
  cancelBox,
  cardFacts,
  challengeProblem,
  challengeTag,
  datesLine,
  dayAfter,
  daysBar,
  detailsLine,
  draftOf,
  emptyBoard,
  fieldsOf,
  isLocked,
  leadersLine,
  newChallengeDraft,
  notCheckingInNote,
  numbersToSave,
  pageLine,
  pastTitle,
  rowNote,
  sameAsSent,
  startHint,
  takesNumbers,
  targetHint,
  whoChoices,
  winChoices,
  withCounts,
  withNumberLine,
  withStartDay,
} from './challengesView';
import { nameOf } from './leaderboardStaffView';
import { useConsoleOrg } from './useConsoleOrg';
import { orgWords } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';

// The gym's Challenges, for staff (ROADMAP 19d-i; spec Part 3 §15.6): set one up, change
// it, cancel or un-cancel it, and see its board with everybody's full name.
// `leaderboard.manage`'s; the server refuses anyone else whatever this screen shows.

const newKey = () => globalThis.crypto.randomUUID();
const TAG = { good: 'c-tag c-tag-good', bad: 'c-tag c-tag-bad', plain: 'c-tag c-tag-plain' };

/** One of two answers to a question, as a button that says what it means. */
function Choice({ on, title, sub, onClick, disabled }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-4 py-3 min-h-[44px] text-left border disabled:opacity-60 ${on ? 'c-picked' : ''}`}
      style={{ background: on ? undefined : 'var(--card)', borderColor: on ? 'var(--accent)' : 'var(--ctl-line)' }}
    >
      <span className="flex items-center gap-2 c-s15 c-w6 c-t1">
        <span aria-hidden="true" className={on ? 'c-check c-check-on' : 'c-check'} style={{ borderRadius: '50%' }}>
          {on ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : null}
        </span>
        {title}
      </span>
      <span className="block c-s13 c-t2 mt-1">{sub}</span>
    </button>
  );
}

function Choices({ label, choices, value, onPick, disabled }) {
  return (
    <div className="c-field">
      <span className="c-label">{label}</span>
      <div role="radiogroup" aria-label={label} className={`grid grid-cols-1 gap-2.5 ${choices.length === 3 ? 'md:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {choices.map((choice) => (
          <Choice key={choice.id} on={value === choice.id} title={choice.title} sub={choice.sub} onClick={() => onPick(choice.id)} disabled={disabled} />
        ))}
      </div>
    </div>
  );
}

function ChallengeForm({ gymId, challenge, list, words, onSaved, onClose }) {
  const adding = challenge === null;
  const locked = isLocked(challenge);
  const [draft, setDraft] = useState(() => (adding ? newChallengeDraft() : draftOf(challenge)));
  // One key a challenge: pressed again after a lost reply, the server answers with the one it kept.
  const [challengeKey] = useState(newKey);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState(null);
  const [error, setError] = useState(null);
  const set = (change) => {
    setDraft((d) => ({ ...d, ...change }));
    setProblem(null);
    setError(null);
  };
  const chars = detailsLine(draft.details);
  const title = adding ? 'Add a challenge' : `Edit ${challenge.name}`;
  const quiet = notCheckingInNote(draft.counts, list, words);
  const started = startHint(draft, list.today);
  const own = draft.counts === 'own';
  const toReach = own ? 'Number to reach' : `${draft.counts === 'gym_days' ? 'Gym days' : 'Workout days'} to reach`;

  const save = async () => {
    const wrong = challengeProblem(draft, list.today, challenge);
    if (wrong !== null) {
      setProblem(wrong);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fields = fieldsOf(draft);
      let saved = adding ? await staffChallengesService.add(gymId, challengeKey, fields) : await staffChallengesService.change(gymId, challenge.id, fields);
      // An earlier press of this form was kept and its reply lost: the server answered
      // with that challenge, so what the form holds now is sent as a change to it.
      if (adding && !sameAsSent(saved, fields)) saved = await staffChallengesService.change(gymId, saved.id, fields);
      onSaved(saved, adding);
    } catch (err) {
      setError(errorText(err, "We couldn't save that. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="c-card p-4 md:p-5 flex flex-col gap-4" aria-label={title} data-testid="challenge-form">
      <h2 className="c-h2">{title}</h2>
      <Field label="Challenge name">
        <input value={draft.name} onChange={(e) => set({ name: e.target.value })} disabled={saving} maxLength={CHALLENGE_LIMITS.name * 2} className="c-input" placeholder="October Challenge" />
      </Field>

      {locked ? (
        <p className="c-s14 c-t2" data-testid="locked-note">
          {LOCKED_NOTE}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Choices
          label="What it counts"
          choices={COUNT_CHOICES}
          value={draft.counts}
          onPick={(counts) => {
            setDraft((d) => withCounts(d, counts));
            setProblem(null);
            setError(null);
          }}
          disabled={saving || locked}
        />
        {own ? (
          <label className="c-field mt-2">
            <span className="c-label">What are you counting?</span>
            <input value={draft.unit} onChange={(e) => set({ unit: e.target.value })} aria-label="What are you counting?" disabled={saving} maxLength={CHALLENGE_LIMITS.unit * 2} className="c-input" style={{ maxWidth: 320 }} placeholder="push-ups" />
            <span className="c-hint">{`As you would say it after a number: push-ups, kilometres, seconds. Your staff type each person's number on the challenge's board, so it works for anything, in the gym or away from it.`}</span>
          </label>
        ) : null}
        {quiet !== null ? (
          <span className="c-hint" role="note" style={{ color: 'var(--warn)' }}>
            {quiet}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="grid gap-4 md:grid-cols-2">
          <DateField
            label="First day"
            value={draft.startsOn}
            min={dayAfter(list.today, -CHALLENGE_LIMITS.back)}
            max={dayAfter(list.today, CHALLENGE_LIMITS.ahead)}
            today={list.today}
            onChange={(day) => {
              setDraft((d) => withStartDay(d, day));
              setProblem(null);
              setError(null);
            }}
            disabled={saving || locked}
            emptyText="Pick a day"
          />
          <DateField
            label="Last day"
            value={draft.endsOn}
            min={draft.startsOn === '' || draft.startsOn < list.today ? list.today : draft.startsOn}
            max={dayAfter(draft.startsOn === '' ? list.today : draft.startsOn, CHALLENGE_LIMITS.days - 1)}
            today={list.today}
            onChange={(endsOn) => set({ endsOn })}
            disabled={saving}
            emptyText="Pick a day"
          />
        </div>
        <span className="c-hint">{`Both days count. It runs on ${list.gymName}'s own clock, to midnight on the last day.`}</span>
        {started !== null ? <span className="c-hint">{started}</span> : null}
      </div>

      <div className="flex flex-col gap-3">
        <Choices label="How it is won" choices={winChoices(draft.counts)} value={draft.win} onPick={(win) => set({ win })} disabled={saving || locked} />
        {draft.win === 'target' ? (
          <div className="c-field">
            <span className="c-label">{toReach}</span>
            <input
              value={draft.target}
              onChange={(e) => set({ target: e.target.value })}
              aria-label={toReach}
              disabled={saving || locked}
              inputMode="numeric"
              className="c-input"
              style={{ width: 104 }}
              placeholder="12"
            />
            <span className="c-hint">{targetHint(draft)}</span>
          </div>
        ) : null}
      </div>

      <Choices label="Who is in it" choices={whoChoices(words, list.inApp)} value={draft.who} onPick={(who) => set({ who })} disabled={saving || locked} />

      <Field label="Prize (optional)">
        <input value={draft.prize} onChange={(e) => set({ prize: e.target.value })} disabled={saving} maxLength={CHALLENGE_LIMITS.prize * 2} className="c-input" placeholder="A free month for the winner" />
      </Field>

      <label className="c-field">
        <span className="c-label">Details (optional)</span>
        <textarea className="c-area" rows={3} value={draft.details} onChange={(e) => set({ details: e.target.value })} disabled={saving} aria-describedby="challenge-chars" placeholder="Anything else people should know" />
        <span id="challenge-chars" className="c-hint" style={chars.over ? { color: 'var(--bad)' } : undefined}>
          {chars.text}
        </span>
      </label>

      {problem !== null ? (
        <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
          {problem.text}
        </p>
      ) : null}
      {error !== null ? (
        <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="c-btn c-btn-p">
          {saving ? 'Saving…' : adding ? 'Add challenge' : 'Save changes'}
        </button>
        <button type="button" onClick={onClose} disabled={saving} className="c-btn c-btn-s">
          Close
        </button>
      </div>
      <p className="c-hint">{`Every one of your ${words.people} in the app sees it straight away. Nobody is emailed. Staff, under-18s and anyone who chose Hide me are never shown on its board.`}</p>
    </section>
  );
}

/** A challenge's board for staff: everybody's full name, and why members do not see some. */
function ChallengeBoard({ gymId, challenge, timezone, words, canType }) {
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: null, board: null });
  /** What is typed in each person's box and not yet saved, by person. */
  const [typed, setTyped] = useState({});
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState(null);
  const load = useCallback(
    () =>
      staffChallengesService.board(gymId, challenge.id, page).then(
        (board) => setState({ loading: false, error: null, board }),
        (err) => setState((s) => ({ loading: false, error: errorText(err, "We couldn't load the board."), board: s.board })),
      ),
    [gymId, challenge.id, page],
  );
  useEffect(() => {
    load();
  }, [load]);

  const board = state.board;
  if (board === null) {
    return state.loading ? <ConsoleLoading label="Loading the board…" newLook /> : <ConsoleFailed message={state.error} onRetry={load} newLook />;
  }
  const empty = emptyBoard(board, challenge);
  const pages = pageLine(board);
  const saveNumbers = async () => {
    const scores = numbersToSave(board.rows, typed);
    if (scores === null) {
      setSaid({ bad: true, text: NUMBER_NOTES.bad });
      return;
    }
    if (scores.length === 0) {
      setSaid({ bad: false, text: NUMBER_NOTES.none });
      return;
    }
    setSaving(true);
    setSaid(null);
    try {
      await staffChallengesService.setScores(gymId, challenge.id, scores);
      setTyped({});
      await load();
      setSaid({ bad: false, text: NUMBER_NOTES.saved(scores.length, words) });
    } catch (err) {
      setSaid({ bad: true, text: errorText(err, "We couldn't save the numbers. Please try again.") });
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="flex flex-col gap-2" aria-label={`The board of ${challenge.name}`} data-testid="challenge-board">
      {canType ? <p className="c-s14 c-t1">{NUMBER_NOTES.help(challenge, words)}</p> : null}
      {boardLines(board, challenge, words).map((line) => (
        <p key={line} className="c-s14 c-t2">
          {line}
        </p>
      ))}
      {board.rows.length === 0 ? (
        empty !== null ? <p className="c-s14 c-t2">{empty}</p> : null
      ) : (
        <ol className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--line)' }}>
          {board.rows.map((row, i) => {
            const note = rowNote(row, challenge);
            return (
              <li
                key={row.userId}
                className="flex items-center gap-3 px-3 md:px-4 py-2.5 min-h-11"
                style={{ borderTop: i > 0 ? '1px solid var(--line)' : undefined, opacity: row.hidden !== null ? 0.72 : 1 }}
                data-testid="challenge-row"
              >
                <span className="c-s14 c-w6 c-num c-t1 w-10 flex-shrink-0">{row.place === null ? '—' : ordinal(row.place)}</span>
                <span className="flex flex-col md:flex-row md:items-center gap-x-3 gap-y-0.5 min-w-0 flex-grow">
                  <span className="c-s14 c-w6 c-t1 c-ell">{nameOf(row)}</span>
                  {note !== null ? <span className="c-tag c-tag-plain self-start md:self-auto">{note}</span> : null}
                </span>
                {row.reached ? (
                  <span className="c-tag c-tag-good flex-shrink-0">
                    <Check aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={3} />
                    Reached
                  </span>
                ) : null}
                {canType ? (
                  <input
                    value={typed[row.userId] ?? (row.value === 0 ? '' : String(row.value))}
                    onChange={(e) => {
                      setTyped((t) => ({ ...t, [row.userId]: e.target.value }));
                      setSaid(null);
                    }}
                    aria-label={`${nameOf(row)}: number`}
                    disabled={saving}
                    inputMode="numeric"
                    className="c-input c-num text-right flex-shrink-0"
                    style={{ width: 96 }}
                    placeholder="—"
                  />
                ) : (
                  <span className="c-s15 c-w6 c-num c-t1 w-10 text-right flex-shrink-0">{row.value.toLocaleString('en')}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {canType && board.rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={saveNumbers} disabled={saving} className="c-btn c-btn-p">
            {saving ? 'Saving…' : 'Save numbers'}
          </button>
          {said !== null ? (
            <span className="c-s14" role={said.bad ? 'alert' : 'status'} style={{ color: said.bad ? 'var(--bad)' : 'var(--good)' }}>
              {said.text}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {pages !== null ? (
          <>
            <button type="button" onClick={() => setPage((p) => p - 1)} disabled={board.page <= 1} className="c-btn c-btn-s c-btn-sm">
              Previous
            </button>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={board.page >= board.pages} className="c-btn c-btn-s c-btn-sm">
              Next
            </button>
            <span className="c-s13 c-t2">{pages}</span>
          </>
        ) : null}
        <span className="c-s13 c-t3">{updatedText(board.asOf, timezone)}</span>
        {state.error !== null ? (
          <span className="c-s13" role="alert" style={{ color: 'var(--bad)' }}>
            {state.error}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function ChallengeCard({ gymId, challenge, list, words, readOnly, busy, asking, onEdit, onAsk, onCancel, onUncancel }) {
  const [showBoard, setShowBoard] = useState(false);
  const tag = challengeTag(challenge, list.today);
  const past = challenge.state === 'ended';
  const box = asking ? cancelBox(challenge, words) : null;
  const bar = daysBar(challenge, list.today);
  const numbered = withNumberLine(challenge);
  const leaders = leadersLine(challenge, words);
  const top = challenge.top ?? [];
  return (
    <li className="c-card p-4 md:p-5 flex flex-col gap-3" data-testid="challenge">
      <div className="flex flex-col gap-3 min-w-0">
        <div className="flex items-start gap-3 min-w-0">
          <span className="c-avatar flex-shrink-0" aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 12 }}>
            <Medal className="w-5 h-5" />
          </span>
          <div className="flex flex-col gap-1 min-w-0 flex-grow">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="c-h3 break-words min-w-0" style={challenge.cancelled ? { textDecoration: 'line-through' } : undefined}>
                {challenge.name}
              </h3>
              <span className={TAG[tag.tone]}>{tag.text}</span>
            </div>
            <p className="c-s14 c-t2 flex items-center gap-2">
              <CalendarDays aria-hidden="true" className="w-4 h-4 flex-shrink-0 c-t3" />
              {datesLine(challenge, list.today)}
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2.5" data-testid="challenge-facts">
          {cardFacts(challenge, list.inApp, words).map((fact) => (
            <div key={fact.label} className="rounded-[12px] px-3.5 py-3 flex flex-col gap-0.5 min-w-0" style={{ background: 'var(--raise)' }}>
              <dt className="c-s13 c-t3">{fact.label}</dt>
              <dd className="c-s15 c-w6 c-t1 break-words">{fact.value}</dd>
              {fact.note !== null ? <dd className="c-s13 c-t2">{fact.note}</dd> : null}
            </div>
          ))}
        </dl>
        {bar !== null ? (
          <div className="flex flex-col gap-1.5" data-testid="challenge-days">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5">
              <span className="c-s13 c-w6 c-t1">{bar.text}</span>
              {numbered !== null ? <span className="c-s13 c-t2">{numbered}</span> : null}
            </div>
            <div className="c-bar" role="progressbar" aria-label={bar.text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bar.percent}>
              <div className="c-bar-fill" style={{ width: `${bar.percent}%` }} />
            </div>
          </div>
        ) : null}
        {leaders !== null ? (
          <div className="flex flex-col gap-2">
            <span className={top.length > 0 ? 'c-s13 c-w6 c-t1' : 'c-s13 c-t2'}>{leaders}</span>
            {top.length > 0 ? (
              <ol className="grid grid-cols-1 sm:grid-cols-3 gap-2.5" aria-label={`In the lead: ${challenge.name}`}>
                {top.map((person) => (
                  <li key={person.userId} className={`c-podium ${person.place === 1 ? 'c-podium-1' : ''}`}>
                    <span className={`flex items-center gap-1 c-s13 c-w7 flex-shrink-0 c-medal-${Math.min(person.place, 3)}`}>
                      <Medal aria-hidden="true" className="w-[18px] h-[18px]" />
                      {ordinal(person.place)}
                    </span>
                    <span className="c-s14 c-w6 c-t1 c-ell flex-grow">{person.name}</span>
                    <span className="c-s16 c-w7 c-num c-t1 flex-shrink-0">{person.value.toLocaleString('en')}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
        {challenge.prize !== '' ? (
          <p className="c-s14 c-t2 flex items-start gap-2">
            <Gift aria-hidden="true" className="w-4 h-4 flex-shrink-0 c-t3 mt-0.5" />
            <span className="break-words min-w-0">{`Prize: ${challenge.prize}`}</span>
          </p>
        ) : null}
        {challenge.details !== '' ? <p className="c-s14 c-t2 whitespace-pre-wrap break-words mt-1">{challenge.details}</p> : null}
      </div>

      {box === null ? (
        <div className="flex flex-wrap gap-2">
          {!challenge.cancelled ? (
            <button type="button" onClick={() => setShowBoard((v) => !v)} aria-expanded={showBoard} className={`c-btn c-btn-sm ${showBoard ? 'c-btn-s' : 'c-btn-soft'}`} aria-label={`${boardButton(challenge, showBoard)}: ${challenge.name}`}>
              {boardButton(challenge, showBoard)}
            </button>
          ) : null}
          {!past && !readOnly ? (
            <>
              <button type="button" onClick={() => onEdit(challenge)} disabled={busy} className="c-btn c-btn-s c-btn-sm" aria-label={`Edit ${challenge.name}`}>
                <Pencil aria-hidden="true" className="w-4 h-4" />
                Edit
              </button>
              {challenge.cancelled ? (
                <button type="button" onClick={() => onUncancel(challenge)} disabled={busy} className="c-btn c-btn-s c-btn-sm" aria-label={`Un-cancel ${challenge.name}`}>
                  {busy ? 'Saving…' : 'Un-cancel'}
                </button>
              ) : (
                <button type="button" onClick={() => onAsk(challenge.id)} disabled={busy} className="c-btn c-btn-quiet c-btn-sm" aria-label={`Cancel ${challenge.name}`}>
                  Cancel challenge
                </button>
              )}
            </>
          ) : null}
        </div>
      ) : null}

      {showBoard && !challenge.cancelled && box === null ? <ChallengeBoard gymId={gymId} challenge={challenge} timezone={list.timezone} words={words} canType={takesNumbers(challenge) && !readOnly} /> : null}

      {box !== null ? (
        <div className="c-callout flex-col" role="group" aria-label={box.title}>
          <p className="c-s15 c-w6 c-t1">{box.title}</p>
          {box.lines.map((line) => (
            <p key={line} className="c-s14 c-t1">
              {line}
            </p>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onCancel(challenge)} disabled={busy} className="c-btn c-btn-danger c-btn-sm">
              {busy ? 'Working…' : box.yes}
            </button>
            <button type="button" onClick={() => onAsk(null)} disabled={busy} className="c-btn c-btn-s c-btn-sm">
              {box.no}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export default function Challenges() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const gymId = org?.id ?? null;
  const words = orgWords(org?.orgType);
  const readOnly = consoleIsReadOnly(org);

  const [state, setState] = useState({ loading: true, error: null, refused: false, list: null });
  /** The form that is open: `{ id }`, the challenge's id or null for a new one; null when none is. */
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(null);
  const [asking, setAsking] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(() => {
    if (gymId === null) return Promise.resolve();
    return staffChallengesService.list(gymId).then(
      (list) => setState({ loading: false, error: null, refused: false, list }),
      (err) =>
        setState((s) => ({
          loading: false,
          error: errorText(err, "We couldn't load your challenges."),
          refused: errorStatus(err) === 403,
          list: s.list,
        })),
    );
  }, [gymId]);

  useEffect(() => {
    load();
    // Read again when the tab or window is shown again: a challenge may have ended meanwhile.
    const shown = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', shown);
    return () => document.removeEventListener('visibilitychange', shown);
  }, [load]);

  const setCancelled = async (challenge, cancelled) => {
    setBusy(challenge.id);
    setNotice(null);
    setActionError(null);
    try {
      await staffChallengesService.setCancelled(gymId, challenge.id, cancelled);
      setAsking(null);
      setNotice(cancelled ? CHALLENGE_NOTES.cancelled(words) : CHALLENGE_NOTES.uncancelled(words));
      await load();
    } catch (err) {
      setAsking(null);
      setActionError(errorText(err, "We couldn't change that. Please try again."));
      // Ended or changed somewhere else in the meantime: show what is true now.
      if (errorStatus(err) === 404 || errorStatus(err) === 409) await load();
    } finally {
      setBusy(null);
    }
  };

  if (orgLoading) {
    return (
      <div className="c-page">
        <ConsoleLoading label="Loading your organisation…" newLook />
      </div>
    );
  }
  if (orgError !== null) {
    return (
      <div className="c-page">
        <ConsoleFailed message={orgError} onRetry={reload} newLook />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="c-page">
        <section className="c-card p-5 md:p-6 flex flex-col gap-3">
          <p className="c-s15 c-t2">We couldn&apos;t find an organisation you run at this address.</p>
          <Link to="/console" className="c-s15 c-w6 c-lk self-start">
            Your organisations
          </Link>
        </section>
      </div>
    );
  }

  const list = state.list;
  // A challenge that has gone from the current list (it ended) takes its open form with it.
  const formOpen = form !== null && list !== null && (form.id === null || list.current.some((c) => c.id === form.id));
  const open = (challenge) => {
    setNotice(null);
    setActionError(null);
    setAsking(null);
    setForm({ id: challenge === null ? null : challenge.id });
  };
  const formFor = (challenge) =>
    formOpen && form.id === (challenge === null ? null : challenge.id) ? (
      <ChallengeForm
        key={challenge === null ? 'new' : challenge.id}
        gymId={gymId}
        challenge={challenge}
        list={list}
        words={words}
        onClose={() => setForm(null)}
        onSaved={(saved, added) => {
          setForm(null);
          setNotice(added ? CHALLENGE_NOTES.added(words) : CHALLENGE_NOTES.saved(words));
          load();
        }}
      />
    ) : null;
  const card = (challenge) => (
    <ChallengeCard
      key={challenge.id}
      gymId={gymId}
      challenge={challenge}
      list={list}
      words={words}
      readOnly={readOnly}
      busy={busy === challenge.id}
      asking={asking === challenge.id}
      onEdit={open}
      onAsk={setAsking}
      onCancel={(c) => setCancelled(c, true)}
      onUncancel={(c) => setCancelled(c, false)}
    />
  );

  return (
    <div className="c-page">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between min-w-0">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="c-h1">Challenges</h1>
          <p className="c-sub">{`Friendly contests for your ${words.people} at ${org.name}, counted for you from check-ins and app workouts`}</p>
        </div>
        {!readOnly && !state.refused && list !== null && !formOpen ? (
          <button type="button" onClick={() => open(null)} className="c-btn c-btn-p self-start md:self-auto">
            <Plus aria-hidden="true" className="w-[18px] h-[18px]" />
            Add challenge
          </button>
        ) : null}
      </header>

      {readOnly && !state.refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{`${readOnlyNote(org?.orgType)} Your ${words.people} can't see these challenges until then.`}</p>
        </section>
      ) : null}

      {state.refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{state.error}</p>
        </section>
      ) : (
        <>
          {formFor(null)}

          {notice !== null ? (
            <p className="c-s14 c-w6" role="status" style={{ color: 'var(--good)' }}>
              {notice}
            </p>
          ) : null}
          {actionError !== null ? (
            <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
              {actionError}
            </p>
          ) : null}

          {state.loading ? <ConsoleLoading label="Loading your challenges…" newLook /> : null}
          {!state.loading && list === null ? <ConsoleFailed message={state.error} onRetry={load} newLook /> : null}

          {list !== null && list.current.length === 0 && !formOpen ? (
            <section className="c-card p-5 md:p-6 flex flex-col gap-2">
              <p className="c-s15 c-w6 c-t1">No challenge is running or coming up.</p>
              <p className="c-s15 c-t2">
                {readOnly
                  ? 'Nothing to show yet.'
                  : `A challenge is a contest with a start and an end, such as "Most gym days in October" or "Reach 12 workouts this month". The app does the counting. Press Add challenge to set one up.`}
              </p>
            </section>
          ) : null}

          {list !== null && list.current.length > 0 ? (
            <section className="flex flex-col gap-3" aria-label="Running and coming up">
              <h2 className="c-s15 c-w6 c-t1">{`Running and coming up (${list.current.length})`}</h2>
              <ul className="flex flex-col gap-3">
                {list.current.map((challenge) => (formOpen && form.id === challenge.id ? <li key={challenge.id}>{formFor(challenge)}</li> : card(challenge)))}
              </ul>
            </section>
          ) : null}

          {list !== null && list.pastTotal > 0 ? (
            <section className="flex flex-col gap-3" aria-label="Past challenges">
              <button type="button" onClick={() => setShowPast((v) => !v)} aria-expanded={showPast} className="c-btn c-btn-s c-btn-sm self-start">
                {showPast ? 'Hide past challenges' : pastTitle(list)}
              </button>
              {showPast ? (
                <>
                  <p className="c-s13 c-t2">{`Challenges that have ended. Your ${words.people} see each one's result for 14 days. They can't be changed.`}</p>
                  <ul className="flex flex-col gap-3">{list.past.map(card)}</ul>
                </>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
