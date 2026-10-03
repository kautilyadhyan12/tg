import { useCallback, useEffect, useRef, useState } from 'react';
import { Info, Loader2, Trophy, X } from 'lucide-react';
import { leaderboardService } from '../../api/leaderboardApi';
import { errorText } from '../../api/orgsApi';
import HideMeSwitch from './HideMeSwitch';
import {
  BOARD_TABS,
  PERIODS,
  circleLabel,
  datesLine,
  dayCountText,
  dayLabel,
  hiddenText,
  nextPlaceText,
  notCountedText,
  ordinal,
  statusText,
  updatedText,
  valueText,
  visitText,
  weekText,
  weekdayInitial,
  whatCounts,
} from './leaderboardView';

// THE GYM'S LEADERBOARD (spec Part 3 §15.5; ROADMAP 19a-i). Two boards, each ranking one
// fact the desk or staff recorded. Worked out fresh by the server; this screen asks again
// every minute while it is open and says when.

const ORANGE = '#FF8A1F';
const MUTED = 'rgba(255,255,255,0.45)';
const REFRESH_MS = 60_000;

function Circles({ circles, days, boardId }) {
  if (circles === null || days === null) return null;
  return (
    <div className="flex gap-1" aria-label={boardId === 'streak' ? 'Last seven weeks' : 'This week, Monday to Sunday'}>
      {circles.map((c, i) => {
        const day = days[i];
        const style =
          c === 'yes'
            ? { background: ORANGE, border: `1px solid ${ORANGE}` }
            : c === 'open'
              ? { border: `1px dashed ${ORANGE}` }
              : c === 'skipped'
                ? { border: '1px dashed rgba(255,255,255,0.18)' }
                : { border: '1px solid rgba(255,255,255,0.22)' };
        return (
          <span
            key={day}
            role="img"
            aria-label={circleLabel(c, day, boardId)}
            title={circleLabel(c, day, boardId)}
            className="w-2.5 h-2.5 rounded-full inline-block"
            style={style}
          />
        );
      })}
    </div>
  );
}

function Initials({ text, greyed }) {
  return (
    <span
      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
      style={{ background: greyed ? 'rgba(255,255,255,0.06)' : 'rgba(255,138,31,0.15)', color: greyed ? MUTED : ORANGE }}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5"
        style={{ background: '#161412', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="text-base font-bold text-white">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-lg" style={{ color: MUTED }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** What counted for the person's own number. */
function CountedSheet({ gymId, boardId, period, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  useEffect(() => {
    let live = true;
    leaderboardService
      .mine(gymId, boardId, period)
      .then((data) => live && setState({ loading: false, error: null, data }))
      .catch((err) => live && setState({ loading: false, error: errorText(err, "Couldn't load what counted."), data: null }));
    return () => {
      live = false;
    };
  }, [gymId, boardId, period]);

  const data = state.data;
  return (
    <Sheet title="What counted" onClose={onClose}>
      {state.loading ? (
        <p className="text-sm flex items-center gap-2" style={{ color: MUTED }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </p>
      ) : state.error !== null ? (
        <p className="text-sm" style={{ color: '#ef4444' }}>{state.error}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-white font-semibold">{valueText(data.value, boardId)}</p>
          {boardId === 'gym_days' ? (
            <>
              {data.days.length === 0 ? (
                <p className="text-sm" style={{ color: MUTED }}>No gym days in this period yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.days.map((d) => (
                    <li key={d.day} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <p className="text-sm text-white">
                        {dayLabel(d.day)} <span style={{ color: MUTED }}>· {dayCountText(d.visits.length)}</span>
                      </p>
                      {d.visits.map((v) => (
                        <p key={v.at + v.how} className="text-xs mt-1" style={{ color: MUTED }}>{visitText(v, data.timezone)}</p>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
              {data.notCounted.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mt-1 mb-1" style={{ color: MUTED }}>Didn&apos;t count</p>
                  <ul className="flex flex-col gap-1">
                    {data.notCounted.map((n) => (
                      <li key={n.at} className="text-xs" style={{ color: MUTED }}>
                        {dayLabel(n.day)} · {notCountedText(n)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {data.weeks.map((w) => {
                const line = weekText(w, data.gymName);
                return (
                  <li key={w.weekStart} className="text-sm flex justify-between gap-3">
                    <span className="text-white">{line.label}</span>
                    <span className="text-right" style={{ color: w.state === 'counted' ? ORANGE : MUTED }}>{line.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** Another member's places on every board. */
function ProfileSheet({ gymId, row, period, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  useEffect(() => {
    let live = true;
    leaderboardService
      .profile(gymId, row.userId, period)
      .then((data) => live && setState({ loading: false, error: null, data }))
      .catch((err) => live && setState({ loading: false, error: errorText(err, "Couldn't load their profile."), data: null }));
    return () => {
      live = false;
    };
  }, [gymId, row.userId, period]);

  const periodLabel = PERIODS.find((p) => p.id === period)?.label.toLowerCase() ?? '';
  return (
    <Sheet title={row.name} onClose={onClose}>
      <div className="flex items-center gap-3 mb-4">
        <Initials text={row.initials} />
        <p className="text-sm text-white font-semibold">{row.name}</p>
      </div>
      {state.loading ? (
        <p className="text-sm flex items-center gap-2" style={{ color: MUTED }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </p>
      ) : state.error !== null ? (
        <p className="text-sm" style={{ color: MUTED }}>{state.error}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {state.data.boards.map((b) => (
            <li key={b.board} className="flex justify-between text-sm rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <span className="text-white">
                {b.board === 'streak' ? 'Streak' : `Gym days, ${periodLabel}`}
              </span>
              <span style={{ color: MUTED }}>
                {b.place === null ? '—' : ordinal(b.place)} · {valueText(b.value, b.board)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

export default function Leaderboard({ gym }) {
  const [boardId, setBoardId] = useState('gym_days');
  const [period, setPeriod] = useState('this_week');
  // Each answer carries the board and period it was asked for, so a slow answer to an
  // earlier tab is never drawn under a later one.
  const key = `${boardId}|${period}`;
  const [state, setState] = useState({ key: null, error: null, board: null });
  const [info, setInfo] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [visibility, setVisibility] = useState(null);
  const [savingHide, setSavingHide] = useState(false);
  const [hideError, setHideError] = useState(null);

  // The tab on screen now: an answer for a tab the member has left is dropped.
  const shownKey = useRef(key);
  const load = useCallback(
    () =>
      leaderboardService
        .board(gym.id, boardId, period)
        .then((board) => {
          if (shownKey.current === key) setState({ key, error: null, board });
        })
        .catch((err) => {
          if (shownKey.current !== key) return;
          setState((s) => ({ key, error: errorText(err, "Couldn't load the leaderboard."), board: s.key === key ? s.board : null }));
        }),
    [gym.id, boardId, period, key],
  );

  useEffect(() => {
    shownKey.current = key;
    load();
    // Not in a tab nobody is looking at; it asks again as soon as the tab is back.
    const timer = window.setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_MS);
    const onShow = () => {
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [load, key]);

  const retry = () => {
    setState({ key: null, error: null, board: null });
    load();
  };

  useEffect(() => {
    leaderboardService.visibility().then(setVisibility).catch(() => setVisibility(null));
  }, []);

  const setHidden = async (hidden) => {
    setSavingHide(true);
    setHideError(null);
    try {
      setVisibility(await leaderboardService.setHidden(hidden));
      await load();
    } catch (err) {
      setHideError(errorText(err, "Couldn't change Hide me. Please try again."));
    } finally {
      setSavingHide(false);
    }
  };

  const loading = state.key !== key;
  const board = loading ? null : state.board;
  const me = board?.me ?? null;
  const meInRows = board !== null && board.rows.some((r) => r.isMe);
  const noBoard = board === null ? null : statusText(board);

  return (
    <section className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} aria-label="Leaderboard">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <Trophy className="w-4 h-4" style={{ color: ORANGE }} /> Leaderboard
        </h2>
        <button type="button" onClick={() => setInfo((v) => !v)} aria-expanded={info} aria-label="What this board counts" className="p-1 rounded-lg" style={{ color: MUTED }}>
          <Info className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div role="tablist" aria-label="Boards" className="flex rounded-xl p-0.5" style={{ background: 'rgba(255,255,255,0.05)' }}>
          {BOARD_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={boardId === t.id}
              onClick={() => setBoardId(t.id)}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold"
              style={boardId === t.id ? { background: 'rgba(255,138,31,0.18)', color: ORANGE } : { color: MUTED }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {boardId === 'gym_days' && (
          <select
            aria-label="Period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded-xl px-3 py-1.5 text-sm"
            style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id} style={{ background: '#161412' }}>{p.label}</option>
            ))}
          </select>
        )}
      </div>

      {info && (
        <div className="rounded-xl p-3 mb-3 text-xs flex flex-col gap-1" style={{ background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.65)' }}>
          {whatCounts(boardId, gym.name).map((line) => <p key={line}>{line}</p>)}
        </div>
      )}

      {loading ? (
        <p className="text-sm flex items-center gap-2" style={{ color: MUTED }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </p>
      ) : board === null ? (
        <div>
          <p className="text-sm" style={{ color: '#ef4444' }}>{state.error}</p>
          <button type="button" onClick={retry} className="mt-2 rounded-xl px-3.5 py-2 text-sm font-semibold" style={{ background: 'rgba(255,138,31,0.15)', color: ORANGE }}>
            Try again
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs" style={{ color: MUTED }}>
            {datesLine(board)} · {updatedText(board.asOf, board.timezone)}
          </p>
          {noBoard !== null ? (
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>{noBoard}</p>
          ) : (
            <ol className="flex flex-col gap-1" aria-label={`${board.ranked} people on the board`}>
              {board.circleDays !== null && (
                <li className="flex items-center gap-3 px-2" aria-hidden="true">
                  <span className="w-8" />
                  <span className="w-8" />
                  <span className="flex-1" />
                  <span className="flex gap-1">
                    {board.circleDays.map((d) => (
                      <span key={d} className="w-2.5 text-center text-[9px]" style={{ color: MUTED }}>
                        {boardId === 'streak' ? '' : weekdayInitial(d)}
                      </span>
                    ))}
                  </span>
                  <span className="w-16" />
                </li>
              )}
              {board.rows.map((r) => {
                const mine = r.isMe;
                return (
                  <li key={r.userId}>
                    <button
                      type="button"
                      onClick={() => setSheet(mine ? { kind: 'counted' } : { kind: 'profile', row: r })}
                      className="w-full flex items-center gap-3 rounded-xl px-2 py-1.5 text-left"
                      style={{ background: mine ? 'rgba(255,138,31,0.08)' : 'transparent' }}
                    >
                      <span className="w-8 text-sm font-bold text-right" style={{ color: r.place <= 3 ? ORANGE : MUTED }}>{ordinal(r.place)}</span>
                      <Initials text={r.initials} />
                      <span className="flex-1 min-w-0 text-sm text-white truncate">{r.name}</span>
                      <Circles circles={r.circles} days={board.circleDays} boardId={boardId} />
                      <span className="w-16 text-right text-sm font-semibold text-white">{r.value}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          {me !== null && board.status !== 'no_checkins' && board.status !== 'paused' && (
            <div className="rounded-xl px-2 py-2 mt-1" style={{ background: 'rgba(255,255,255,0.03)', opacity: me.hidden !== null ? 0.6 : 1 }}>
              <button
                type="button"
                onClick={() => setSheet({ kind: 'counted' })}
                className="w-full flex items-center gap-3 text-left"
                aria-label={`You: ${valueText(me.value, boardId)}. See what counted.`}
              >
                <span className="w-8 text-sm font-bold text-right" style={{ color: MUTED }}>{me.place === null ? '—' : ordinal(me.place)}</span>
                <Initials text="You" greyed={me.hidden !== null} />
                <span className="flex-1 min-w-0 text-sm text-white">
                  You <span className="text-xs" style={{ color: ORANGE }}>· What counted</span>
                </span>
                <Circles circles={me.circles} days={board.circleDays} boardId={boardId} />
                <span className="w-16 text-right text-sm font-semibold text-white">{me.value}</span>
              </button>
              {me.hidden !== null && <p className="text-xs mt-1 pl-11" style={{ color: MUTED }}>{hiddenText(me.hidden, board.gymName)}</p>}
              {me.hidden === null && nextPlaceText(me, boardId) !== null && (
                <p className="text-xs mt-1 pl-11" style={{ color: MUTED }}>{nextPlaceText(me, boardId)}</p>
              )}
              {me.hidden === null && !meInRows && me.place !== null && (
                <p className="text-xs mt-1 pl-11" style={{ color: MUTED }}>Members see the top 100; your place is shown here.</p>
              )}
            </div>
          )}

          {visibility !== null && (
            <HideMeSwitch hidden={visibility.hidden} under18={visibility.under18} onChange={setHidden} busy={savingHide} />
          )}
          {hideError !== null && <p className="text-xs" style={{ color: '#ef4444' }}>{hideError}</p>}
        </div>
      )}

      {sheet?.kind === 'counted' && <CountedSheet gymId={gym.id} boardId={boardId} period={period} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'profile' && <ProfileSheet gymId={gym.id} row={sheet.row} period={period} onClose={() => setSheet(null)} />}
    </section>
  );
}
