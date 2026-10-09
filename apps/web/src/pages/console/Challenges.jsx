import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Gift, ListOrdered, Medal, Pencil, Plus, Trophy, Users, X } from 'lucide-react';
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
  TEAMS_BUTTON,
  TEAM_LIMITS,
  TEAM_NOTES,
  badBox,
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
  draftSummary,
  emptyBoard,
  fieldsForKept,
  fieldsOf,
  inSaves,
  inTeamSaves,
  inTeams,
  isLocked,
  leadersLine,
  newChallengeDraft,
  notCheckingInNote,
  numbersToSave,
  pageLine,
  pastTitle,
  removedTeamLines,
  resultPostNote,
  rowLeader,
  rowSummary,
  rowNote,
  sameAsSent,
  startHint,
  takesNumbers,
  takesTeams,
  targetHint,
  teamChoices,
  teamLines,
  teamName,
  teamNotes,
  teamsBox,
  teamsHeading,
  teamsToSave,
  unsavedNote,
  unsavedTeamsNote,
  whoChoices,
  winChoices,
  withCounts,
  withNumberLine,
  withStartDay,
  withTeamAdded,
  withTeamNamed,
  withTeamRemoved,
} from './challengesView';
import { nameOf } from './leaderboardStaffView';
import { useConsoleOrg } from './useConsoleOrg';
import { orgWords, viewerPrivileges } from './consoleView';
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

/** One numbered part of the form. */
function Part({ n, title, children }) {
  return (
    <div className="c-card p-4 md:p-5 flex flex-col gap-4" role="group" aria-label={`Part ${n}: ${title}`}>
      <p className="flex items-center gap-2.5 c-s15 c-w6 c-t1">
        <span aria-hidden="true" className="inline-flex items-center justify-center c-s13 c-w7 flex-shrink-0" style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--soft)', color: 'var(--soft-t)' }}>
          {n}
        </span>
        {title}
      </p>
      {children}
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
  const teamed = draft.teams !== 'none';
  const removing = removedTeamLines(draft, challenge);
  const toReach = teamed ? 'Number a team has to reach' : own ? 'Number to reach' : `${draft.counts === 'gym_days' ? 'Gym days' : 'Workout days'} to reach`;

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
      if (adding && !sameAsSent(saved, fields)) saved = await staffChallengesService.change(gymId, saved.id, fieldsForKept(fields, saved));
      onSaved(saved, adding);
    } catch (err) {
      setError(errorText(err, "We couldn't save that. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onClose} disabled={saving} className="c-btn c-btn-link self-start" aria-label="Back to all challenges">
        <ChevronLeft aria-hidden="true" className="w-4 h-4" />
        All challenges
      </button>
      <div className="grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_300px]">
    <section className="flex flex-col gap-4 min-w-0" aria-label={title} data-testid="challenge-form">
      <h2 className="c-h2">{title}</h2>
      <Part n={1} title="What it is, and when">
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

      </Part>

      <Part n={2} title="How it is won, and who is in it">
      <div className="flex flex-col gap-3">
        <Choices label="How it is won" choices={winChoices(draft.counts, draft.teams)} value={draft.win} onPick={(win) => set({ win })} disabled={saving || locked} />
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

      <Choices label="Who is in it" choices={whoChoices(words, list.inApp, draft.teams)} value={draft.who} onPick={(who) => set({ who })} disabled={saving || locked} />

      </Part>

      <Part n={3} title="Teams, prize and details">
      <div className="flex flex-col gap-3">
        <Choices label="Alone or in teams" choices={teamChoices(words)} value={draft.teams} onPick={(teams) => set({ teams })} disabled={saving || locked} />
        {teamed ? (
          <div className="c-field" role="group" aria-label="Teams">
            <span className="c-label">Teams</span>
            <div className="flex flex-col gap-2" style={{ maxWidth: 420 }}>
              {draft.teamList.map((team, i) => (
                <div key={team.id ?? `new-${i}`} className="flex items-center gap-2">
                  <input
                    value={team.name}
                    onChange={(e) => {
                      setDraft((d) => withTeamNamed(d, i, e.target.value));
                      setProblem(null);
                      setError(null);
                    }}
                    aria-label={`Team ${i + 1} name`}
                    disabled={saving || locked}
                    maxLength={TEAM_LIMITS.name * 2}
                    className="c-input flex-grow"
                    placeholder={i === 0 ? 'Red Team' : i === 1 ? 'Blue Team' : `Team ${i + 1}`}
                  />
                  {draft.teamList.length > TEAM_LIMITS.min && !locked ? (
                    <button
                      type="button"
                      onClick={() => {
                        setDraft((d) => withTeamRemoved(d, i));
                        setProblem(null);
                        setError(null);
                      }}
                      disabled={saving}
                      className="c-btn c-btn-quiet c-btn-sm flex-shrink-0"
                      aria-label={`Remove team ${i + 1}${team.name.trim() === '' ? '' : `, ${team.name.trim()}`}`}
                    >
                      <X aria-hidden="true" className="w-4 h-4" />
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {draft.teamList.length < TEAM_LIMITS.max && !locked ? (
              <button
                type="button"
                onClick={() => {
                  setDraft((d) => withTeamAdded(d));
                  setProblem(null);
                  setError(null);
                }}
                disabled={saving}
                className="c-btn c-btn-s c-btn-sm self-start"
              >
                <Plus aria-hidden="true" className="w-4 h-4" />
                Add a team
              </button>
            ) : null}
            <span className="c-hint">
              {`${TEAM_LIMITS.min} to ${TEAM_LIMITS.max} teams. A team's number is its people's numbers added together. ${
                draft.teams === 'staff' ? "After you save, open the challenge and press Put people in teams." : `Your ${words.people} pick a team in the app; you can move anybody on the challenge's board.`
              }`}
            </span>
          </div>
        ) : null}
        {removing.map((line) => (
          <p key={line} className="c-s14" role="note" style={{ color: 'var(--warn)' }}>
            {line}
          </p>
        ))}
      </div>

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

      </Part>

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
      <p className="c-hint">{`Every one of your ${words.people} in the app sees it straight away. Nobody is emailed. When it ends, its result is posted to Updates. Staff, under-18s and anyone who chose Hide me are never shown on its board.`}</p>
    </section>
        <aside className="c-card p-4 md:p-5 flex flex-col gap-3 lg:sticky lg:top-4" aria-label="Your challenge so far" data-testid="challenge-summary">
          <p className="c-s13 c-w6 c-t3" style={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Your challenge so far
          </p>
          <dl className="flex flex-col gap-3">
            {draftSummary(draft, list, words).map((line) => (
              <div key={line.label} className="flex flex-col gap-0.5 min-w-0">
                <dt className="c-s13 c-t3">{line.label}</dt>
                <dd className={`c-s14 break-words ${line.empty ? 'c-t3' : 'c-w6 c-t1'}`}>{line.value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </div>
  );
}

/** A challenge's board for staff: everybody's full name, and why members do not see some. */
function ChallengeBoard({ gymId, challenge, timezone, words, canType, canTeam, onTeamsSaved }) {
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: null, board: null });
  /** What is typed in each person's box and not yet saved, by person, on every page. */
  const [typed, setTyped] = useState({});
  /** The number kept for each person loaded so far, on every page opened. */
  const [kept, setKept] = useState({});
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState(null);
  /** The team picked beside each person and not yet saved, by person, on every page. */
  const [moved, setMoved] = useState({});
  /** The people the box before a save names; null while it is closed. */
  const [moving, setMoving] = useState(null);
  const [seeAll, setSeeAll] = useState(false);
  const [asking, setAsking] = useState(false);
  const teamed = inTeams(challenge);
  const load = useCallback(
    () =>
      staffChallengesService.board(gymId, challenge.id, page).then(
        (board) => {
          setKept((k) => ({ ...k, ...Object.fromEntries(board.rows.map((row) => [row.userId, { value: row.value, name: row.name, teamId: row.teamId ?? null }])) }));
          setState({ loading: false, error: null, board });
        },
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
    // Every box typed in, on whichever page: not only the page that is open.
    const known = Object.entries(kept).map(([userId, person]) => ({ userId, ...person }));
    const scores = numbersToSave(known, typed);
    if (scores === null) {
      // Named, since the box may be on a page that is not open.
      setSaid({ bad: true, text: NUMBER_NOTES.badFor(badBox(known, typed)?.name ?? null) });
      return;
    }
    if (scores.length === 0) {
      setSaid({ bad: false, text: NUMBER_NOTES.none });
      return;
    }
    setSaving(true);
    setSaid(null);
    try {
      for (const save of inSaves(scores)) await staffChallengesService.setScores(gymId, challenge.id, save);
      setTyped({});
      await load();
      setSaid({ bad: false, text: NUMBER_NOTES.saved(scores.length) });
    } catch (err) {
      setSaid({ bad: true, text: errorText(err, "We couldn't save the numbers. Please try again.") });
    } finally {
      setSaving(false);
    }
  };
  // Everybody moved, on whichever page: not only the page that is open.
  const changesIn = (known) => teamsToSave(Object.entries(known).map(([userId, person]) => ({ userId, ...person })), moved);
  const changes = () => changesIn(kept);
  const askTeams = async () => {
    if (changes().length === 0) {
      setSaid({ bad: false, text: TEAM_NOTES.none });
      return;
    }
    setSaid(null);
    setAsking(true);
    // Every page is read again first, so the box names the team each person is in NOW: a
    // member may have picked one since the page was loaded.
    let known = kept;
    try {
      for (let at = 1; at <= board.pages; at += 1) {
        const now = await staffChallengesService.board(gymId, challenge.id, at);
        known = { ...known, ...Object.fromEntries(now.rows.map((row) => [row.userId, { value: row.value, name: row.name, teamId: row.teamId ?? null }])) };
      }
      setKept(known);
    } catch {
      // The teams as they were loaded; the save says so if somebody has gone.
    }
    setAsking(false);
    const people = changesIn(known);
    if (people.length === 0) {
      setSaid({ bad: false, text: TEAM_NOTES.none });
      return;
    }
    setSeeAll(false);
    setMoving(people);
  };
  const saveTeams = async () => {
    const people = moving;
    setSaving(true);
    try {
      for (const save of inTeamSaves(people)) await staffChallengesService.setTeamPeople(gymId, challenge.id, save);
      setMoved({});
      setMoving(null);
      await load();
      setSaid({ bad: false, text: TEAM_NOTES.saved(people.length) });
      onTeamsSaved();
    } catch (err) {
      setMoving(null);
      setSaid({ bad: true, text: errorText(err, "We couldn't save the teams. Please try again.") });
      // Somebody left, or a team changed, meanwhile: show the list as it is now.
      await load();
    } finally {
      setSaving(false);
    }
  };
  const box = moving === null ? null : teamsBox(moving, challenge, words, seeAll);
  const unsavedTeams = canTeam ? unsavedTeamsNote(changes().length) : null;
  return (
    <section className="flex flex-col gap-2" aria-label={`The board of ${challenge.name}`} data-testid="challenge-board">
      {canType ? <p className="c-s14 c-t1">{NUMBER_NOTES.help(challenge, words)}</p> : null}
      {canTeam ? <p className="c-s14 c-t1">{TEAM_NOTES.help(challenge, words)}</p> : null}
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
                className={`flex items-center gap-x-3 gap-y-2 px-3 md:px-4 py-2.5 min-h-11 ${canTeam ? 'flex-wrap md:flex-nowrap' : ''}`}
                style={{ borderTop: i > 0 ? '1px solid var(--line)' : undefined, opacity: row.hidden !== null ? 0.72 : 1 }}
                data-testid="challenge-row"
              >
                <span className="c-s14 c-w6 c-num c-t1 w-10 flex-shrink-0">{row.place === null ? '—' : ordinal(row.place)}</span>
                <span className="flex flex-col md:flex-row md:items-center gap-x-3 gap-y-0.5 min-w-0 flex-grow">
                  <span className="c-s14 c-w6 c-t1 c-ell">{nameOf(row)}</span>
                  {note !== null ? <span className="c-tag c-tag-plain self-start md:self-auto">{note}</span> : null}
                  {teamed && !canTeam ? <span className={`c-tag self-start md:self-auto ${row.teamId === null ? 'c-tag-plain' : 'c-tag-good'}`}>{teamName(challenge, row.teamId)}</span> : null}
                </span>
                {canTeam ? (
                  <select
                    value={moved[row.userId] === undefined ? (row.teamId ?? '') : (moved[row.userId] ?? '')}
                    onChange={(e) => {
                      setMoved((m) => ({ ...m, [row.userId]: e.target.value === '' ? null : e.target.value }));
                      setSaid(null);
                    }}
                    aria-label={`${nameOf(row)}: team`}
                    disabled={saving || asking || moving !== null}
                    className="c-sel order-last md:order-none basis-full md:basis-auto md:flex-shrink-0 md:max-w-[180px]"
                  >
                    <option value="">No team</option>
                    {(challenge.teamList ?? []).map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                ) : null}
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
      {canTeam && board.rows.length > 0 && box === null ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={askTeams} disabled={saving || asking} className="c-btn c-btn-p">
            {asking ? 'Checking…' : 'Save teams'}
          </button>
          {said !== null ? (
            <span className="c-s14" role={said.bad ? 'alert' : 'status'} style={{ color: said.bad ? 'var(--bad)' : 'var(--good)' }}>
              {said.text}
            </span>
          ) : null}
        </div>
      ) : null}
      {box !== null ? (
        <div className="c-callout flex-col" role="group" aria-label={box.title}>
          <p className="c-s15 c-w6 c-t1">{box.title}</p>
          {box.lines.map((line, at) => (
            <p key={`${String(at)}:${line}`} className="c-s14 c-t1">
              {line}
            </p>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={saveTeams} disabled={saving} className="c-btn c-btn-p c-btn-sm">
              {saving ? 'Saving…' : box.yes}
            </button>
            {box.seeAll !== null ? (
              <button type="button" onClick={() => setSeeAll(true)} disabled={saving} className="c-btn c-btn-s c-btn-sm">
                {box.seeAll}
              </button>
            ) : null}
            <button type="button" onClick={() => setMoving(null)} disabled={saving} className="c-btn c-btn-s c-btn-sm">
              {box.no}
            </button>
          </div>
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
            {canType && unsavedNote(typed) !== null ? (
              <span className="c-s13 c-t1" role="note">
                {unsavedNote(typed)}
              </span>
            ) : null}
            {unsavedTeams !== null ? (
              <span className="c-s13 c-t1" role="note">
                {unsavedTeams}
              </span>
            ) : null}
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

/** One challenge on the list: what it is, where it stands, and the way in. */
function ChallengeRow({ challenge, list, words, onOpen }) {
  const tag = challengeTag(challenge, list.today);
  const lead = rowLeader(challenge);
  return (
    <li className="c-card flex items-center gap-3 md:gap-4 p-4 md:px-5" data-testid="challenge">
      <span className="c-avatar flex-shrink-0" aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 12 }}>
        <Medal className="w-5 h-5" />
      </span>
      <div className="flex flex-col gap-1 min-w-0 flex-grow">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="c-h3 break-words min-w-0" style={challenge.cancelled ? { textDecoration: 'line-through' } : undefined}>
            {challenge.name}
          </h3>
          <span className={TAG[tag.tone]}>{tag.text}</span>
        </div>
        <p className="c-s14 c-t2">{datesLine(challenge, list.today)}</p>
        <p className="c-s13 c-t3">{rowSummary(challenge, list.inApp, words)}</p>
        {lead !== null ? (
          <p className="c-s13 c-w6 c-t1 flex items-center gap-1.5 md:hidden">
            <Trophy aria-hidden="true" className="w-3.5 h-3.5 c-medal-1" />
            {lead}
          </p>
        ) : null}
      </div>
      {lead !== null ? (
        <div className="hidden md:flex flex-col items-end gap-0.5 flex-shrink-0" style={{ maxWidth: 240 }}>
          <span className="c-s13 c-t3">In the lead</span>
          <span className="c-s14 c-w6 c-t1 c-ell max-w-full flex items-center gap-1.5">
            <Trophy aria-hidden="true" className="w-4 h-4 flex-shrink-0 c-medal-1" />
            {lead}
          </span>
        </div>
      ) : null}
      <button type="button" onClick={() => onOpen(challenge)} className="c-btn c-btn-s c-btn-sm flex-shrink-0" aria-label={`Open ${challenge.name}`}>
        Open
        <ChevronRight aria-hidden="true" className="w-4 h-4" />
      </button>
    </li>
  );
}

/** One challenge on a page of its own: what it is at the top with what can be done to it,
 *  then who is leading, then its board. */
function ChallengeDetail({ gymId, challenge, list, words, readOnly, busy, asking, updatesLink, onBack, onEdit, onAsk, onCancel, onUncancel, onTeamsSaved }) {
  /** The board that is open: 'see' to read it, 'type' with a box a person, 'teams' with a
   *  team to pick beside each person; null for none. */
  const [board, setBoard] = useState(null);
  const showBoard = board !== null;
  const canType = takesNumbers(challenge, list.today) && !readOnly;
  const canTeam = takesTeams(challenge, list.today) && !readOnly;
  const past = challenge.state === 'ended';
  /** An ended challenge's list carries no team numbers: they are read with its board. */
  const [teamNumbers, setTeamNumbers] = useState(null);
  const readsResult = past && !challenge.cancelled && inTeams(challenge);
  useEffect(() => {
    if (!readsResult) return undefined;
    let live = true;
    staffChallengesService.board(gymId, challenge.id, 1).then(
      (board) => live && setTeamNumbers(board.teams ?? null),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gymId, challenge.id, readsResult]);
  const teams = teamLines(challenge, teamNumbers);
  const notes = teamNotes(challenge, teams);
  const tag = challengeTag(challenge, list.today);
  const box = asking ? cancelBox(challenge, words) : null;
  const bar = daysBar(challenge, list.today);
  const numbered = withNumberLine(challenge);
  const leaders = leadersLine(challenge, words);
  const top = challenge.top ?? [];
  const about = challenge.prize !== '' || challenge.details !== '';
  const posted = resultPostNote(challenge, updatesLink !== null, words);
  return (
    <div className="flex flex-col gap-4" data-testid="challenge-detail">
      <button type="button" onClick={onBack} className="c-btn c-btn-link self-start">
        <ChevronLeft aria-hidden="true" className="w-4 h-4" />
        All challenges
      </button>

      <section className="c-card p-4 md:p-6 flex flex-col gap-5" aria-label={challenge.name}>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between min-w-0">
          <div className="flex items-start gap-3 md:gap-4 min-w-0">
            <span className="c-avatar flex-shrink-0" aria-hidden="true" style={{ width: 52, height: 52, borderRadius: 14 }}>
              <Medal className="w-6 h-6" />
            </span>
            <div className="flex flex-col gap-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h2 className="c-h2 break-words min-w-0" style={challenge.cancelled ? { textDecoration: 'line-through' } : undefined}>
                  {challenge.name}
                </h2>
                <span className={TAG[tag.tone]}>{tag.text}</span>
              </div>
              <p className="c-s14 c-t2 flex items-center gap-2">
                <CalendarDays aria-hidden="true" className="w-4 h-4 flex-shrink-0 c-t3" />
                {datesLine(challenge, list.today)}
              </p>
              {posted !== null ? (
                <p className="c-s14 c-t2 flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="result-post-note">
                  <span>{posted.text}</span>
                  {posted.link ? (
                    <Link to={updatesLink} className="c-lk c-w6">
                      See it in Updates
                    </Link>
                  ) : null}
                  {posted.who !== null ? <span>{posted.who}</span> : null}
                </p>
              ) : null}
            </div>
          </div>
          {box === null && !past && !readOnly ? (
            <div className="flex flex-wrap gap-2 md:flex-shrink-0">
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
            </div>
          ) : null}
        </div>

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

        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2.5" data-testid="challenge-facts">
          {cardFacts(challenge, list.inApp, words).map((fact) => (
            <div key={fact.label} className="rounded-[12px] px-4 py-3.5 flex flex-col gap-0.5 min-w-0" style={{ background: 'var(--raise)' }}>
              <dt className="c-s13 c-t3">{fact.label}</dt>
              <dd className="c-s16 c-w6 c-t1 break-words">{fact.value}</dd>
              {fact.note !== null ? <dd className="c-s13 c-t2">{fact.note}</dd> : null}
            </div>
          ))}
        </dl>

        {bar !== null ? (
          <div className="flex flex-col gap-2" data-testid="challenge-days">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5">
              <span className="c-s14 c-w6 c-t1">{bar.text}</span>
              {numbered !== null ? <span className="c-s13 c-t2">{numbered}</span> : null}
            </div>
            <div className="c-bar" role="progressbar" aria-label={bar.text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bar.percent}>
              <div className="c-bar-fill" style={{ width: `${bar.percent}%` }} />
            </div>
          </div>
        ) : null}
      </section>

      {teams.length > 0 || leaders !== null || about ? (
        <div className={`grid gap-4 items-start ${(teams.length > 0 || leaders !== null) && about ? 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : ''}`}>
          {teams.length > 0 ? (
            <section className="c-card p-4 md:p-6 flex flex-col gap-3" data-testid="challenge-teams" aria-label="Teams">
              <h3 className="c-h3 flex items-center gap-2">
                <Users aria-hidden="true" className="w-[18px] h-[18px] c-t3" />
                {teamsHeading(challenge, words)}
              </h3>
              <ol className="flex flex-col gap-2" aria-label={`Teams: ${challenge.name}`}>
                {teams.map((team) => (
                  <li key={team.id} className={`c-podium ${team.place === 1 ? 'c-podium-1' : ''}`}>
                    {team.placeText !== null ? (
                      <span className={`flex items-center gap-1 c-s13 c-w7 flex-shrink-0 c-medal-${Math.min(team.place, 3)}`} style={{ minWidth: 52 }}>
                        <Medal aria-hidden="true" className="w-[18px] h-[18px]" />
                        {team.placeText}
                      </span>
                    ) : null}
                    <span className="flex flex-col min-w-0 flex-grow">
                      <span className="c-s14 c-w6 c-t1 c-ell">{team.name}</span>
                      <span className="c-s13 c-t2">{team.people}</span>
                    </span>
                    {team.number !== null ? <span className="c-s16 c-w7 c-num c-t1 flex-shrink-0">{team.number}</span> : null}
                  </li>
                ))}
              </ol>
              {notes.map((line) => (
                <p key={line} className="c-s13 c-t2">
                  {line}
                </p>
              ))}
            </section>
          ) : leaders !== null ? (
            <section className="c-card p-4 md:p-6 flex flex-col gap-3" aria-label="In the lead">
              {top.length > 0 ? (
                <h3 className="c-h3 flex items-center gap-2">
                  <Trophy aria-hidden="true" className="w-[18px] h-[18px] c-t3" />
                  {leaders}
                </h3>
              ) : (
                <span className="c-s14 c-t2">{leaders}</span>
              )}
              {top.length > 0 ? (
                <ol className="flex flex-col gap-2" aria-label={`In the lead: ${challenge.name}`}>
                  {top.map((person) => (
                    <li key={person.userId} className={`c-podium ${person.place === 1 ? 'c-podium-1' : ''}`}>
                      <span className={`flex items-center gap-1 c-s13 c-w7 flex-shrink-0 c-medal-${Math.min(person.place, 3)}`} style={{ minWidth: 52 }}>
                        <Medal aria-hidden="true" className="w-[18px] h-[18px]" />
                        {ordinal(person.place)}
                      </span>
                      <span className="c-s14 c-w6 c-t1 c-ell flex-grow">{person.name}</span>
                      <span className="c-s16 c-w7 c-num c-t1 flex-shrink-0">{person.value.toLocaleString('en')}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </section>
          ) : null}
          {about ? (
            <section className="c-card p-4 md:p-6 flex flex-col gap-3" aria-label="Prize and details">
              <h3 className="c-h3 flex items-center gap-2">
                <Gift aria-hidden="true" className="w-[18px] h-[18px] c-t3" />
                Prize and details
              </h3>
              {challenge.prize !== '' ? <p className="c-s15 c-w6 c-t1 break-words">{`Prize: ${challenge.prize}`}</p> : null}
              {challenge.details !== '' ? <p className="c-s14 c-t2 whitespace-pre-wrap break-words">{challenge.details}</p> : null}
            </section>
          ) : null}
        </div>
      ) : null}

      {!challenge.cancelled && box === null ? (
        <section className="c-card p-4 md:p-6 flex flex-col gap-4" aria-label="Board">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-0.5 min-w-0">
              <h3 className="c-h3 flex items-center gap-2">
                <ListOrdered aria-hidden="true" className="w-[18px] h-[18px] c-t3" />
                Board
              </h3>
              <p className="c-s13 c-t2">{`Everybody in it by full name, with what your ${words.people} see and what they don't.`}</p>
            </div>
            <div className="flex flex-wrap gap-2 md:flex-shrink-0">
              <button type="button" onClick={() => setBoard((b) => (b === null ? 'see' : null))} aria-expanded={showBoard} className={`c-btn c-btn-sm ${showBoard ? 'c-btn-s' : 'c-btn-soft'}`} aria-label={`${boardButton(challenge, showBoard)}: ${challenge.name}`}>
                {boardButton(challenge, showBoard)}
              </button>
              {canType && board !== 'type' ? (
                <button type="button" onClick={() => setBoard('type')} className="c-btn c-btn-s c-btn-sm" aria-label={`Enter numbers: ${challenge.name}`}>
                  Enter numbers
                </button>
              ) : null}
              {canTeam && board !== 'teams' ? (
                <button type="button" onClick={() => setBoard('teams')} className="c-btn c-btn-s c-btn-sm" aria-label={`${TEAMS_BUTTON}: ${challenge.name}`}>
                  <Users aria-hidden="true" className="w-4 h-4" />
                  {TEAMS_BUTTON}
                </button>
              ) : null}
            </div>
          </div>
          {showBoard ? (
            <ChallengeBoard gymId={gymId} challenge={challenge} timezone={list.timezone} words={words} canType={canType && board === 'type'} canTeam={canTeam && board === 'teams'} onTeamsSaved={onTeamsSaved} />
          ) : null}
        </section>
      ) : null}
    </div>
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
  // The challenge that is open is in the address, so Back goes to the list and a reload stays.
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get('challenge');
  const show = (id) => {
    setNotice(null);
    setActionError(null);
    setAsking(null);
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      if (id === null) next.delete('challenge');
      else next.set('challenge', id);
      return next;
    });
  };

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
  const everyOne = list === null ? [] : [...list.current, ...list.past];
  const formChallenge = formOpen && form.id !== null ? (list.current.find((c) => c.id === form.id) ?? null) : null;
  // A challenge that is not on the list any more takes its open page with it.
  const opened = openId === null ? null : (everyOne.find((c) => c.id === openId) ?? null);
  const view = formOpen ? 'form' : opened !== null ? 'one' : 'list';
  const row = (challenge) => <ChallengeRow key={challenge.id} challenge={challenge} list={list} words={words} onOpen={(c) => show(c.id)} />;

  return (
    <div className="c-page">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between min-w-0">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="c-h1">Challenges</h1>
          <p className="c-sub">{`Friendly contests for your ${words.people} at ${org.name}, counted for you from check-ins and app workouts`}</p>
        </div>
        {!readOnly && !state.refused && list !== null && view === 'list' ? (
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

          {view === 'form' ? (
            <ChallengeForm
              key={formChallenge === null ? 'new' : formChallenge.id}
              gymId={gymId}
              challenge={formChallenge}
              list={list}
              words={words}
              onClose={() => setForm(null)}
              onSaved={(saved, added) => {
                setForm(null);
                setNotice(added ? CHALLENGE_NOTES.added(words) : CHALLENGE_NOTES.saved(words));
                load();
              }}
            />
          ) : null}

          {view === 'one' ? (
            <ChallengeDetail
              key={opened.id}
              gymId={gymId}
              challenge={opened}
              list={list}
              words={words}
              readOnly={readOnly}
              updatesLink={viewerPrivileges(org).includes('posts.manage') ? `/console/${orgSlug}/updates` : null}
              busy={busy === opened.id}
              asking={asking === opened.id}
              onBack={() => show(null)}
              onEdit={open}
              onAsk={setAsking}
              onCancel={(c) => setCancelled(c, true)}
              onUncancel={(c) => setCancelled(c, false)}
              onTeamsSaved={load}
            />
          ) : null}

          {view === 'list' && list !== null && list.current.length === 0 ? (
            <section className="c-card p-5 md:p-6 flex flex-col gap-2">
              <p className="c-s15 c-w6 c-t1">No challenge is running or coming up.</p>
              <p className="c-s15 c-t2">
                {readOnly
                  ? 'Nothing to show yet.'
                  : `A challenge is a contest with a start and an end, such as "Most gym days in October" or "Reach 12 workouts this month". The app does the counting. Press Add challenge to set one up.`}
              </p>
            </section>
          ) : null}

          {view === 'list' && list !== null && list.current.length > 0 ? (
            <section className="flex flex-col gap-3" aria-label="Running and coming up">
              <h2 className="c-s15 c-w6 c-t1">{`Running and coming up (${list.current.length})`}</h2>
              <ul className="flex flex-col gap-2.5">{list.current.map(row)}</ul>
            </section>
          ) : null}

          {view === 'list' && list !== null && list.pastTotal > 0 ? (
            <section className="flex flex-col gap-3" aria-label="Past challenges">
              <button type="button" onClick={() => setShowPast((v) => !v)} aria-expanded={showPast} className="c-btn c-btn-s c-btn-sm self-start">
                {showPast ? 'Hide past challenges' : pastTitle(list)}
              </button>
              {showPast ? (
                <>
                  <p className="c-s13 c-t2">{`Challenges that have ended. Your ${words.people} see each one's result for 14 days. They can't be changed.`}</p>
                  <ul className="flex flex-col gap-2.5">{list.past.map(row)}</ul>
                </>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
