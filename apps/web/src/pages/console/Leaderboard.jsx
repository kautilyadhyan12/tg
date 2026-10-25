import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, Flame } from 'lucide-react';
import { staffLeaderboardService } from '../../api/leaderboardApi';
import { errorStatus, errorText } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { BOARD_TABS, PERIODS, circleLabel, datesLine, ordinal, updatedText, weekLabel, weekdayInitial } from '../../components/gym/leaderboardView';
import LeaderboardPerson from './LeaderboardPerson';
import { msToGymMidnight, useLiveNews } from './liveNews';
import { gymToday } from './hoursView';
import { canManagePosts } from '../../components/gym/postsView';
import { useConsoleOrg } from './useConsoleOrg';
import { orgWords, viewerPrivileges } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import {
  WHAT_IT_COUNTS,
  boardSwitch,
  canFixVisits,
  countLine,
  emptyLine,
  flamesNote,
  nameOf,
  notInAppLine,
  pageLine,
  rowTag,
} from './leaderboardStaffView';

// The gym's leaderboard, for staff (ROADMAP 19a-iii; spec Part 3 §15.5): everyone with a
// number by full name, the people members do not see marked with the reason; a person's
// panel with what counted and Take off the board; and which boards members see, each with
// why it is not showing. `leaderboard.manage`'s; the server refuses anyone else whatever
// this screen shows. Read again when the server says something changed (live updates, Stage 4
// item 18): a board switched or a person taken off by staff elsewhere, at once; a visit, a workout
// or Hide me at most once a minute, since a large gym's all-time board is slow to work out and a
// busy hour's news is gathered into one read. And once at the gym's midnight.

const BUNDLE_MS = 60_000;
/** While the live line cannot open, the board checks for itself this often. */
const WITHOUT_LINE_MS = 60_000;
/** A read at the gym's midnight that came back on the old day (the browser's clock ahead) is tried
 *  again after this, this many times. */
const MIDNIGHT_AGAIN_MS = 30_000;
const MIDNIGHT_TRIES = 10;
/** The wait for midnight is worked out again each hour, so a 23- or 25-hour day is met. */
const HOUR_MS = 3_600_000;

function Circles({ circles, days, boardId }) {
  if (circles === null || days === null) return null;
  return (
    <span className="flex gap-[3px]" aria-label={weekLabel(days, boardId)}>
      {circles.map((c, i) => (
        <span key={days[i]} role="img" aria-label={circleLabel(c, days[i], boardId)} title={circleLabel(c, days[i], boardId)} className="flex">
          <Flame aria-hidden="true" className={`c-flame${c === 'yes' ? ' c-flame-on' : c === 'open' || c === 'skipped' ? ' c-flame-open' : ''}`} />
        </span>
      ))}
    </span>
  );
}

function BoardSwitches({ board, words, readOnly, saving, error, onSwitch }) {
  return (
    <section className="c-card" aria-label={`Which boards ${words.people} see`} data-testid="board-switches">
      <div className="px-4 md:px-5 pt-4 pb-1 flex flex-col gap-1">
        <h2 className="c-h3">{`Which boards ${words.people} see`}</h2>
        <p className="c-s14 c-t2">{`Switch a board off and ${words.people} stop seeing it in their app. You still see it here.`}</p>
      </div>
      {BOARD_TABS.map((t) => {
        const s = boardSwitch(t.id, board, words);
        return (
          <div key={t.id} className="c-row" data-testid={`switch-${t.id}`}>
            <div className="flex flex-col gap-0.5 min-w-0 flex-grow">
              <span className="c-s15 c-w6 c-t1">{s.label}</span>
              <span className="c-s13 c-t2">{WHAT_IT_COUNTS[t.id]}</span>
              <span className="c-s13" style={{ color: s.showing ? 'var(--good)' : 'var(--t2)' }}>
                {s.line}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={s.on}
              aria-label={`${words.peopleCap} see ${s.label}`}
              disabled={readOnly || saving}
              onClick={() => onSwitch(t.id, !s.on)}
              className={s.on ? 'c-switch c-switch-on' : 'c-switch'}
            />
          </div>
        );
      })}
      {error !== null ? (
        <p className="c-s14 c-t1 px-4 md:px-5 pb-4" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export default function Leaderboard() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const gymId = org?.id ?? null;
  const words = orgWords(org?.orgType);
  const readOnly = consoleIsReadOnly(org);

  const [boardId, setBoardId] = useState('gym_days');
  const [period, setPeriod] = useState('this_week');
  const [pageNo, setPageNo] = useState(1);
  // Each answer carries what it was asked for, so a slow answer to an earlier tab is never
  // drawn under a later one.
  const key = `${boardId}|${period}|${pageNo}`;
  const [state, setState] = useState({ key: null, error: null, refused: false, board: null });
  const shownKey = useRef(key);
  const [saving, setSaving] = useState(false);
  const [switchError, setSwitchError] = useState(null);
  /** The row whose panel is open. */
  const [open, setOpen] = useState(null);
  /** "Chen Wu is off the board.", after the panel closes. */
  const [notice, setNotice] = useState(null);
  /** Why the server will not open the live line: said under the heading until it opens. */
  const [liveRefused, setLiveRefused] = useState(null);
  /** When the board was last asked for, and a read waiting for its minute to come round. */
  const lastRead = useRef(0);
  const soon = useRef(null);
  /** Only the newest read is drawn: two reads that cross never leave the older answer showing. */
  const readSeq = useRef(0);

  const load = useCallback(() => {
    if (gymId === null) return Promise.resolve();
    lastRead.current = Date.now();
    const asked = ++readSeq.current;
    return staffLeaderboardService.board(gymId, boardId, period, pageNo).then(
      (board) => {
        if (shownKey.current !== key || readSeq.current !== asked) return;
        setState({ key, error: null, refused: false, board });
      },
      (err) => {
        if (shownKey.current !== key || readSeq.current !== asked) return;
        setState((s) => ({
          key,
          error: errorText(err, "We couldn't load the leaderboard."),
          refused: errorStatus(err) === 403,
          board: s.key === key ? s.board : null,
        }));
      },
    );
  }, [gymId, boardId, period, pageNo, key]);

  useEffect(() => {
    shownKey.current = key;
    load();
    return () => {
      clearTimeout(soon.current);
      soon.current = null;
    };
  }, [load, key]);

  useLiveNews(gymId, (message) => {
    if (message.what === 'refused') {
      setLiveRefused(message.message);
      return;
    }
    if (message.what === 'ready') setLiveRefused(null);
    if (message.what === 'leaderboard' && message.change === 'switched') {
      // Staff changed what the page shows: read at once, and that read covers any waiting one.
      clearTimeout(soon.current);
      soon.current = null;
      load();
    } else if (message.what === 'visits' || message.what === 'leaderboard' || message.what === 'people') {
      // At once after a quiet minute; within the minute, one read when it is up.
      if (soon.current !== null) return;
      soon.current = setTimeout(
        () => {
          soon.current = null;
          load();
        },
        Math.max(0, lastRead.current + BUNDLE_MS - Date.now()),
      );
    } else if (message.what === 'ready' || message.what === 'cameBack') {
      load();
    }
  });

  // The gym's day turns at its midnight: "this week", the flames and the Streak move with it. The
  // wait is worked out again each hour, so a clock change is met; a read that comes back still on
  // the old day (the browser's clock ahead of the server's) is tried again shortly, a few times.
  const zone = state.board?.timezone ?? null;
  const asOf = state.board?.asOf ?? null;
  const boardDay = zone === null || asOf === null ? null : gymToday(zone, new Date(asOf));
  const [turn, setTurn] = useState(0);
  const midnight = useRef({ from: null, tries: 0 });
  useEffect(() => {
    if (zone === null) return undefined;
    const atMidnight = midnight.current.from !== null && midnight.current.from === boardDay && midnight.current.tries < MIDNIGHT_TRIES;
    if (midnight.current.from !== boardDay) midnight.current = { from: null, tries: 0 };
    const wait = atMidnight ? MIDNIGHT_AGAIN_MS : msToGymMidnight(zone);
    if (wait === null) return undefined;
    const due = atMidnight ? wait : wait + 1_000;
    const timer = setTimeout(
      () => {
        if (due > HOUR_MS) {
          setTurn((t) => t + 1);
          return;
        }
        midnight.current = { from: boardDay, tries: atMidnight ? midnight.current.tries + 1 : 0 };
        load();
        setTurn((t) => t + 1);
      },
      Math.min(due, HOUR_MS),
    );
    return () => clearTimeout(timer);
  }, [zone, boardDay, turn, load]);

  // While the live line cannot open, the board checks for itself, until the line is back.
  useEffect(() => {
    if (liveRefused === null) return undefined;
    const timer = setInterval(load, WITHOUT_LINE_MS);
    return () => clearInterval(timer);
  }, [liveRefused, load]);

  const pick = (nextBoard, nextPeriod) => {
    setNotice(null);
    setBoardId(nextBoard);
    setPeriod(nextPeriod);
    setPageNo(1);
  };

  const onSwitch = async (id, on) => {
    if (state.board === null) return;
    setSaving(true);
    setSwitchError(null);
    try {
      const done = await staffLeaderboardService.setBoardOff(gymId, id, !on);
      setState((s) => (s.board === null ? s : { ...s, board: { ...s.board, boardsOff: done.boardsOff } }));
      await load();
    } catch (err) {
      setSwitchError(errorText(err, "We couldn't change that. Please try again."));
    } finally {
      setSaving(false);
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

  const loading = state.key !== key;
  const board = loading ? null : state.board;
  const count = board === null ? null : countLine(board, words);
  const noApp = board === null ? null : notInAppLine(board.notInApp, words);
  const pages = board === null ? null : pageLine(board);
  const flames = board === null || board.rows.length === 0 ? null : flamesNote(board);

  return (
    <div className="c-page">
      <header className="flex flex-col gap-1.5 min-w-0">
        <h1 className="c-h1">Leaderboard</h1>
        <p className="c-sub">{`Everyone on ${org.name}'s boards, and what your ${words.people} see`}</p>
        {liveRefused !== null ? <p className="c-s14 c-t2">{liveRefused}</p> : null}
      </header>

      {readOnly && !state.refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{readOnlyNote(org?.orgType)}</p>
        </section>
      ) : null}

      {state.refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{state.error}</p>
        </section>
      ) : (
        <>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
            <div className="c-utabs flex-grow" role="tablist" aria-label="Boards">
              {BOARD_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={boardId === t.id}
                  onClick={() => pick(t.id, period)}
                  className={boardId === t.id ? 'c-utab c-utab-on whitespace-nowrap' : 'c-utab whitespace-nowrap'}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {boardId !== 'streak' ? (
              <div className="w-full md:w-[200px] md:flex-shrink-0">
                <select aria-label="Period" value={period} onChange={(e) => pick(boardId, e.target.value)} className="c-sel">
                  {PERIODS.map((p) => (
                    <option key={p.id} value={p.id} className="c-opt">
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          {notice !== null ? (
            <p className="c-s14 c-w6" role="status" style={{ color: 'var(--good)' }}>
              {notice}
            </p>
          ) : null}

          {loading ? <ConsoleLoading label="Loading the leaderboard…" newLook /> : null}
          {!loading && board === null ? <ConsoleFailed message={state.error} onRetry={load} newLook /> : null}

          {board !== null ? (
            <>
              <p className="c-s14 c-t2" data-testid="board-dates">
                {datesLine(board)} · {updatedText(board.asOf, board.timezone)}
                {count !== null ? ` · ${count}` : ''}
                {flames !== null ? ` · ${flames}` : ''}
              </p>

              {board.rows.length === 0 ? (
                <section className="c-card p-5 md:p-6">
                  <p className="c-s15 c-t2">{emptyLine(board)}</p>
                </section>
              ) : (
                <section className="c-card overflow-hidden">
                  <div className="c-board-grid c-th hidden md:grid px-5 py-3">
                    <span style={{ gridArea: 'place' }}>Place</span>
                    <span style={{ gridArea: 'who' }}>Name</span>
                    <span style={{ gridArea: 'dots' }} className="flex gap-[3px]" aria-hidden="true">
                      {board.circleDays !== null && boardId !== 'streak'
                        ? board.circleDays.map((d) => (
                            <span key={d} className="c-flame-head">
                              {weekdayInitial(d)}
                            </span>
                          ))
                        : board.circleDays !== null
                          ? 'Last 7 weeks'
                          : null}
                    </span>
                    <span style={{ gridArea: 'num' }} className="text-right">
                      {BOARD_TABS.find((t) => t.id === boardId)?.label}
                    </span>
                    <span style={{ gridArea: 'tag' }}>{`What ${words.people} see`}</span>
                  </div>
                  <ul>
                    {board.rows.map((r, i) => {
                      const said = rowTag(r, board);
                      return (
                      <li key={r.userId} className={i > 0 ? 'border-t' : 'md:border-t'} style={{ borderColor: 'var(--line)' }}>
                        <button
                          type="button"
                          data-testid="board-row"
                          onClick={() => {
                            setNotice(null);
                            setOpen(r);
                          }}
                          className="c-board-grid grid w-full text-left min-h-11 px-4 md:px-5 py-3"
                          style={r.hidden !== null ? { opacity: 0.62 } : undefined}
                        >
                          <span className="c-s15 c-w6 c-num c-t1" style={{ gridArea: 'place' }}>
                            {r.place === null ? '—' : ordinal(r.place)}
                          </span>
                          <span className="c-s15 c-w6 c-t1 c-ell" style={{ gridArea: 'who' }}>
                            {nameOf(r)}
                          </span>
                          <span className="hidden md:flex" style={{ gridArea: 'dots' }}>
                            <Circles circles={r.circles} days={board.circleDays} boardId={boardId} />
                          </span>
                          <span className="c-s15 c-w6 c-num c-t1 text-right" style={{ gridArea: 'num' }}>
                            {r.value}
                          </span>
                          <span style={{ gridArea: 'tag' }}>
                            {said.tag ? (
                              <span className="c-tag c-tag-plain">{said.text}</span>
                            ) : (
                              <span className="hidden md:inline c-s14 c-t2">{said.text}</span>
                            )}
                          </span>
                          <ChevronRight aria-hidden="true" className="w-[18px] h-[18px] c-t3" style={{ gridArea: 'go' }} />
                        </button>
                      </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {pages !== null ? (
                <div className="flex items-center gap-3">
                  <button type="button" disabled={board.page <= 1} onClick={() => setPageNo(board.page - 1)} className="c-btn c-btn-s c-btn-sm">
                    Previous
                  </button>
                  <span className="c-s14 c-t2">{pages}</span>
                  <button type="button" disabled={board.page >= board.pages} onClick={() => setPageNo(board.page + 1)} className="c-btn c-btn-s c-btn-sm">
                    Next
                  </button>
                </div>
              ) : null}

              {noApp !== null ? (
                <section className="c-callout" data-testid="not-in-app">
                  <p className="c-s14">{noApp}</p>
                </section>
              ) : null}

              <BoardSwitches board={board} words={words} readOnly={readOnly} saving={saving} error={switchError} onSwitch={onSwitch} />
            </>
          ) : null}
        </>
      )}

      {open !== null ? (
        <LeaderboardPerson
          gymId={gymId}
          gym={org}
          orgSlug={orgSlug}
          row={open}
          period={period}
          words={words}
          readOnly={readOnly}
          canFix={canFixVisits(viewerPrivileges(org))}
          canSeePosts={canManagePosts(viewerPrivileges(org))}
          onClose={() => setOpen(null)}
          onChanged={(line) => {
            setNotice(line);
            load();
          }}
        />
      ) : null}
    </div>
  );
}
