import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, Flame, Gift, Info, Loader2, Medal, Target, Trophy, Users } from 'lucide-react';
import { challengesService } from '../../api/challengesApi';
import { errorStatus, errorText } from '../../api/orgsApi';
import PersonProfile from './PersonProfile';
import Sheet, { Initials } from './Sheet';
import {
  boardNote,
  challengeChip,
  challengeDates,
  countText,
  dayMarks,
  howToWin,
  joinNote,
  leaveBox,
  markLabel,
  noChallenges,
  notCountingNote,
  placeLine,
  progress,
  resultOf,
  unitOf,
  whatCounts,
  whoLine,
} from './challengesView';
import { hiddenText, ordinal, updatedText } from './leaderboardView';

// A GYM'S CHALLENGES FOR ITS MEMBER (spec Part 3 §15.6; ROADMAP 19d-i): what is running,
// what is coming and what has just finished, each with the member's own number, the top
// three and, where the gym asked people to join, the button. The member web's screen
// until the phone app has its own. The server works every number out; this draws them.

const ORANGE = '#FF8A1F';
const MUTED = 'rgba(255,255,255,0.45)';
const SOFT = 'rgba(255,255,255,0.8)';
const RED = '#ef4444';
const GREEN = '#4ade80';
/** First, second and third: the medal's colour, always beside the place in words. */
const MEDAL = { 1: '#F5C542', 2: '#C9CED6', 3: '#D08A5B' };

const BUTTON = 'px-3.5 py-2 rounded-xl text-sm font-semibold min-h-11 disabled:opacity-50';
const MAIN = { background: ORANGE, color: '#111' };
const QUIET = { background: 'rgba(255,255,255,0.06)', color: '#fff' };

const CHIP = {
  good: { background: 'rgba(74,222,128,0.15)', color: GREEN },
  hot: { background: 'rgba(255,138,31,0.18)', color: ORANGE },
  bad: { background: 'rgba(239,68,68,0.15)', color: RED },
  plain: { background: 'rgba(255,255,255,0.08)', color: SOFT },
};

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** The member's counted days as flames, a week a row, Monday first. */
function Flames({ challenge, today }) {
  const marks = dayMarks(challenge, today);
  if (marks === null) return null;
  return (
    <div className="flex-shrink-0" aria-label={marks.whole ? 'Your days in this challenge' : 'Your days this week'}>
      <div className="grid gap-y-1" style={{ gridTemplateColumns: 'repeat(7, 22px)' }}>
        {WEEKDAYS.map((letter, i) => (
          <span key={`${letter}${i}`} aria-hidden="true" className="text-center text-[10px]" style={{ color: MUTED }}>
            {letter}
          </span>
        ))}
        {marks.weeks.flat().map((cell, i) => {
          if (cell === null) return <span key={`out-${i}`} aria-hidden="true" />;
          const style =
            cell.state === 'yes'
              ? { color: ORANGE, fill: ORANGE, filter: 'drop-shadow(0 0 4px rgba(255,138,31,0.9))' }
              : cell.state === 'open'
                ? { color: ORANGE, opacity: 0.7 }
                : cell.state === 'ahead'
                  ? { color: 'rgba(255,255,255,0.12)' }
                  : { color: 'rgba(255,255,255,0.28)' };
          const label = markLabel(cell, challenge.counts);
          return (
            <span key={cell.day} role="img" aria-label={label} title={label} className="flex justify-center">
              <Flame aria-hidden="true" className="w-4 h-4" style={style} />
            </span>
          );
        })}
      </div>
      <p aria-hidden="true" className="flex items-center gap-1 text-[10px] mt-1.5" style={{ color: MUTED }}>
        <Flame className="w-3 h-3" style={{ color: ORANGE, fill: ORANGE }} /> {`a ${unitOf(challenge.counts)}`}
      </p>
      {!marks.whole && <p className="text-xs mt-1" style={{ color: MUTED, maxWidth: 170 }}>This week. Your number counts every day of the challenge.</p>}
    </div>
  );
}

/** The member's own number in the challenge. */
function Mine({ challenge, today, gymName }) {
  const mine = progress(challenge);
  if (mine === null || challenge.state === 'coming') return null;
  const place = placeLine(challenge);
  const hidden = challenge.me.hidden === null ? null : hiddenText(challenge.me.hidden, gymName);
  return (
    <div
      className={`rounded-xl p-3 mt-1 ${mine.done ? 'motion-safe:animate-pulse-amber' : ''}`}
      style={{ background: mine.done ? 'rgba(255,138,31,0.10)' : 'rgba(255,255,255,0.04)', border: `1px solid ${mine.done ? 'rgba(255,138,31,0.45)' : 'rgba(255,255,255,0.06)'}` }}
      aria-label="Your number in this challenge"
    >
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
      <div className="flex-1" style={{ minWidth: 200 }}>
      <div className="flex items-end justify-between gap-3">
        <p className="text-white leading-none">
          <span className="text-4xl font-bold tabular-nums">{mine.big.toLocaleString('en')}</span>
          <span className="text-sm ml-1.5" style={{ color: SOFT }}>
            {mine.of === null ? mine.unit : `of ${mine.of.toLocaleString('en')} ${mine.unit}`}
          </span>
        </p>
        {mine.done && (
          <span className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full flex-shrink-0" style={{ background: ORANGE, color: '#111' }}>
            <Check aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={3} /> Done
          </span>
        )}
      </div>
      {mine.percent !== null && (
        <div
          role="progressbar"
          aria-label={`${mine.big} of ${mine.of} ${mine.unit}`}
          aria-valuemin={0}
          aria-valuemax={mine.of}
          aria-valuenow={Math.min(mine.big, mine.of)}
          className="h-2.5 rounded-full mt-3 overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.08)' }}
        >
          <div className="h-full rounded-full" style={{ width: `${mine.percent}%`, background: `linear-gradient(90deg, #FFB347, ${ORANGE})`, transition: 'width 600ms ease-out' }} />
        </div>
      )}
      {mine.note !== null && <p className="text-sm mt-2" style={{ color: mine.done ? ORANGE : SOFT }}>{mine.note}</p>}
      {place !== null && <p className="text-sm mt-1" style={{ color: SOFT }}>{place}</p>}
      {hidden !== null && <p className="text-xs mt-1" style={{ color: MUTED }}>{hidden}</p>}
      </div>
      <Flames challenge={challenge} today={today} />
      </div>
    </div>
  );
}

/** First, second and third, side by side. */
function Podium({ challenge }) {
  if (challenge.board.top.length === 0) return null;
  return (
    <ol className="grid grid-cols-3 gap-2 mt-1" aria-label="Top three">
      {challenge.board.top.map((row) => {
        const colour = MEDAL[row.place] ?? MUTED;
        return (
          <li
            key={row.userId}
            className="rounded-xl px-2 py-3 flex flex-col items-center text-center min-w-0"
            style={{
              background: row.place === 1 ? 'linear-gradient(180deg, rgba(245,197,66,0.16), rgba(255,255,255,0.03))' : row.isMe ? 'rgba(255,138,31,0.10)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${row.place === 1 ? 'rgba(245,197,66,0.5)' : row.isMe ? 'rgba(255,138,31,0.45)' : 'rgba(255,255,255,0.06)'}`,
            }}
          >
            <span className="flex items-center gap-1 text-sm font-bold" style={{ color: colour }}>
              <Medal aria-hidden="true" className="w-5 h-5" /> {ordinal(row.place)}
            </span>
            <span className="mt-2 rounded-full" style={{ boxShadow: `0 0 0 2px ${colour}` }}>
              <Initials text={row.initials} />
            </span>
            <span className="text-sm text-white font-semibold mt-1.5 max-w-full truncate">{row.isMe ? 'You' : row.name}</span>
            <span className="text-xl font-bold text-white tabular-nums mt-0.5">{row.value.toLocaleString('en')}</span>
            {row.reached && (
              <span className="flex items-center gap-0.5 text-[11px] font-semibold mt-0.5" style={{ color: ORANGE }}>
                <Check aria-hidden="true" className="w-3 h-3" strokeWidth={3} /> Reached
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The whole board: the first hundred, and the member's own line. */
function BoardSheet({ gym, challenge, onClose, onPerson }) {
  const [state, setState] = useState({ loading: true, error: null, board: null });
  useEffect(() => {
    let live = true;
    challengesService
      .board(gym.id, challenge.id)
      .then((board) => live && setState({ loading: false, error: null, board }))
      .catch((err) => live && setState({ loading: false, error: errorText(err, "Couldn't load the board."), board: null }));
    return () => {
      live = false;
    };
  }, [gym.id, challenge.id]);
  const board = state.board;
  const me = board?.me ?? null;
  const meInRows = board !== null && board.rows.some((row) => row.isMe);
  return (
    <Sheet title={challenge.name} onClose={onClose}>
      {state.loading ? (
        <p className="text-sm flex items-center gap-2" style={{ color: MUTED }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </p>
      ) : state.error !== null ? (
        <p className="text-sm" role="alert" style={{ color: RED }}>{state.error}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs" style={{ color: MUTED }}>
            {howToWin(challenge)} · {board.ranked.toLocaleString('en')} on the board · {updatedText(board.asOf, gym.timezone ?? 'UTC')}
          </p>
          {board.rows.length === 0 ? (
            <p className="text-sm" style={{ color: SOFT }}>The places show once 3 people have a number in this challenge.</p>
          ) : (
            <ol className="flex flex-col gap-1" aria-label="The board">
              {board.rows.map((row) => (
                <li key={row.userId}>
                  <button
                    type="button"
                    onClick={() => (row.isMe ? undefined : onPerson(row))}
                    disabled={row.isMe}
                    className="w-full flex items-center gap-3 rounded-xl px-2 py-1.5 text-left min-h-11"
                    style={{ background: row.isMe ? 'rgba(255,138,31,0.08)' : 'transparent' }}
                    aria-label={`${ordinal(row.place)}: ${row.isMe ? 'You' : row.name}, ${countText(row.value, challenge.counts, challenge.unit)}${row.reached ? ', reached the target' : ''}`}
                  >
                    <span className="w-9 text-sm font-bold text-right" style={{ color: MEDAL[row.place] ?? MUTED }}>{ordinal(row.place)}</span>
                    <Initials text={row.initials} />
                    <span className="flex-1 min-w-0 text-sm text-white truncate">{row.isMe ? 'You' : row.name}</span>
                    {row.reached && <Check aria-hidden="true" className="w-4 h-4 flex-shrink-0" strokeWidth={3} style={{ color: ORANGE }} />}
                    <span className="w-10 text-right text-sm font-semibold text-white tabular-nums">{row.value}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {me !== null && !meInRows && (
            <div className="rounded-xl px-2 py-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <p className="flex items-center gap-3 text-sm text-white">
                <span className="w-9 text-right font-bold" style={{ color: MUTED }}>{me.place === null ? '—' : ordinal(me.place)}</span>
                <Initials text="You" greyed={me.hidden !== null} />
                <span className="flex-1">You</span>
                <span className="w-10 text-right font-semibold tabular-nums">{me.value}</span>
              </p>
              {me.hidden !== null && <p className="text-xs mt-1 pl-12" style={{ color: MUTED }}>{hiddenText(me.hidden, gym.name)}</p>}
              {me.hidden === null && me.place !== null && <p className="text-xs mt-1 pl-12" style={{ color: MUTED }}>The board shows the first 100; your place is shown here.</p>}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

function ChallengeCard({ gym, challenge, list, busy, said, asking, onJoin, onLeave, onAsk, onBoard }) {
  const [info, setInfo] = useState(false);
  const chip = challengeChip(challenge, list.today);
  const result = resultOf(challenge);
  const note = boardNote(challenge);
  const quiet = notCountingNote(challenge, list);
  const join = joinNote(challenge);
  const box = leaveBox(challenge);
  const waiting = challenge.state === 'coming' && challenge.me !== null && challenge.who === 'joined';
  return (
    <li className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', opacity: challenge.cancelled ? 0.7 : 1 }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,138,31,0.15)' }}>
            <Trophy aria-hidden="true" className="w-4 h-4" style={{ color: ORANGE }} />
          </span>
          <div className="min-w-0">
            <p className="text-base font-bold text-white break-words" style={challenge.cancelled ? { textDecoration: 'line-through' } : undefined}>
              {challenge.name}
            </p>
            <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: ORANGE }}>
              <Target aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
              {howToWin(challenge)}
            </p>
          </div>
        </div>
        <span className="text-xs font-semibold px-2 py-1 rounded-full flex-shrink-0" style={CHIP[chip.tone]}>
          {chip.text}
        </span>
      </div>

      <p className="text-sm flex items-center gap-1.5" style={{ color: SOFT }}>
        <CalendarDays aria-hidden="true" className="w-4 h-4 flex-shrink-0" style={{ color: ORANGE }} />
        {challengeDates(challenge, list.today)}
      </p>
      {challenge.prize !== '' && (
        <p className="text-sm flex items-start gap-1.5" style={{ color: SOFT }}>
          <Gift aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: ORANGE }} />
          <span className="break-words min-w-0">
            <span className="font-semibold text-white">Prize:</span> {challenge.prize}
          </span>
        </p>
      )}
      <p className="text-sm flex items-center gap-1.5" style={{ color: SOFT }}>
        <Users aria-hidden="true" className="w-4 h-4 flex-shrink-0" style={{ color: ORANGE }} />
        <span className="flex-1 min-w-0">{whoLine(challenge, gym.name)}</span>
        <button type="button" onClick={() => setInfo((v) => !v)} aria-expanded={info} aria-label={`What ${challenge.name} counts`} className="p-1.5 rounded-lg flex-shrink-0" style={{ color: MUTED }}>
          <Info className="w-4 h-4" />
        </button>
      </p>
      {info && <p className="text-xs rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.65)' }}>{whatCounts(challenge, gym.name)}</p>}
      {challenge.details !== '' && <p className="text-sm whitespace-pre-wrap break-words" style={{ color: 'rgba(255,255,255,0.65)' }}>{challenge.details}</p>}

      {challenge.cancelled ? (
        <p className="text-sm" style={{ color: MUTED }}>{`${gym.name} cancelled this challenge.`}</p>
      ) : (
        <>
          {result !== null && (
            <div className="rounded-xl p-3 flex items-start gap-2.5 motion-safe:animate-scale-in" style={{ background: 'rgba(245,197,66,0.10)', border: '1px solid rgba(245,197,66,0.35)' }} aria-label="How it finished">
              <Trophy aria-hidden="true" className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: MEDAL[1] }} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white break-words">{result.headline}</p>
                {result.mine !== null && <p className="text-sm mt-0.5" style={{ color: SOFT }}>{result.mine}</p>}
              </div>
            </div>
          )}
          {waiting && <p className="text-sm font-semibold" style={{ color: GREEN }}>You&apos;re in.</p>}
          {quiet !== null && <p className="text-xs" style={{ color: ORANGE }}>{quiet}</p>}
          <Mine challenge={challenge} today={list.today} gymName={gym.name} />
          <Podium challenge={challenge} />
          {note !== null && <p className="text-xs" style={{ color: MUTED }}>{note}</p>}

          {asking ? (
            <div role="group" aria-label={box.title} className="flex flex-col gap-2 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <p className="text-sm font-semibold text-white">{box.title}</p>
              <p className="text-sm" style={{ color: SOFT }}>{box.line}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => onLeave(challenge)} disabled={busy} className={BUTTON} style={{ background: RED, color: '#fff' }}>
                  {busy ? 'Working…' : box.yes}
                </button>
                <button type="button" onClick={() => onAsk(null)} disabled={busy} className={BUTTON} style={QUIET}>
                  {box.no}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {challenge.can.join && (
                <button type="button" onClick={() => onJoin(challenge)} disabled={busy} aria-label={`Join ${challenge.name}`} className={BUTTON} style={MAIN}>
                  {busy ? 'Working…' : 'Join the challenge'}
                </button>
              )}
              {challenge.board.status === 'shown' && (
                <button type="button" onClick={() => onBoard(challenge)} aria-label={`See the whole board of ${challenge.name}`} className={BUTTON} style={QUIET}>
                  {`See the whole board (${challenge.board.ranked.toLocaleString('en')})`}
                </button>
              )}
              {challenge.can.leave && (
                <button type="button" onClick={() => onAsk(challenge.id)} disabled={busy} aria-label={`Leave ${challenge.name}`} className={BUTTON} style={{ color: MUTED }}>
                  Leave
                </button>
              )}
            </div>
          )}
          {join !== null && !asking && <p className="text-xs" style={{ color: MUTED }}>{join}</p>}
        </>
      )}
      {said !== null && <p className="text-sm" role="alert" style={{ color: RED }}>{said}</p>}
    </li>
  );
}

export default function Challenges({ gym }) {
  const [state, setState] = useState({ loading: true, error: null, list: null });
  const asked = useRef(0);
  const [busyId, setBusyId] = useState(null);
  /** What the last tap on a challenge answered when it failed, by challenge. */
  const [said, setSaid] = useState({});
  const [asking, setAsking] = useState(null);
  const [sheet, setSheet] = useState(null);

  const load = useCallback(() => {
    const mine = ++asked.current;
    challengesService
      .list(gym.id)
      .then((list) => {
        if (mine === asked.current) setState({ loading: false, error: null, list });
      })
      .catch((err) => {
        if (mine !== asked.current) return;
        // The server's 404 is for anybody who is not a member of this gym.
        const error = errorStatus(err) === 404 ? `${gym.name}'s challenges aren't available right now.` : errorText(err, "Couldn't load the challenges.");
        setState({ loading: false, error, list: null });
      });
  }, [gym.id, gym.name]);
  useEffect(() => {
    load();
    // Read again when the tab or window is shown again: the numbers move while it is away.
    const shown = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', shown);
    return () => {
      document.removeEventListener('visibilitychange', shown);
      asked.current += 1;
    };
  }, [load]);

  const tryAgain = () => {
    setState({ loading: true, error: null, list: null });
    load();
  };

  const act = async (challenge, joining) => {
    if (busyId !== null) return;
    setBusyId(challenge.id);
    setSaid((m) => ({ ...m, [challenge.id]: null }));
    try {
      const now = joining ? await challengesService.join(gym.id, challenge.id) : await challengesService.leave(gym.id, challenge.id);
      // A slower read of the list asked before this tap must not draw over its answer.
      asked.current += 1;
      setState((s) => (s.list === null ? s : { ...s, list: { ...s.list, challenges: s.list.challenges.map((c) => (c.id === now.id ? now : c)) } }));
    } catch (err) {
      setSaid((m) => ({ ...m, [challenge.id]: errorText(err, "That didn't go through. Try again.") }));
      // The challenge is not as this card showed it: read the list again.
      if (err?.response !== undefined) load();
    } finally {
      setAsking(null);
      setBusyId(null);
    }
  };

  const list = state.list;
  const open = sheet?.kind === 'board' ? list?.challenges.find((c) => c.id === sheet.id) : undefined;

  return (
    <section aria-label={`${gym.name}'s challenges`} className="flex flex-col gap-3 mt-3">
      {state.loading ? (
        <p className="text-sm flex items-center gap-2" style={{ color: MUTED }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </p>
      ) : state.error !== null ? (
        <div className="flex flex-col gap-2 items-start">
          <p className="text-sm" style={{ color: RED }}>{state.error}</p>
          <button type="button" onClick={tryAgain} className="px-3.5 py-2 rounded-xl text-sm font-semibold min-h-11" style={QUIET}>
            Try again
          </button>
        </div>
      ) : list.status === 'paused' ? (
        <p className="text-sm" style={{ color: MUTED }}>{`${gym.name}'s challenges aren't available right now.`}</p>
      ) : list.challenges.length === 0 ? (
        <p className="text-sm" style={{ color: MUTED }}>{noChallenges(gym.name)}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Challenges">
          {list.challenges.map((challenge) => (
            <ChallengeCard
              key={challenge.id}
              gym={gym}
              challenge={challenge}
              list={list}
              busy={busyId === challenge.id}
              said={said[challenge.id] ?? null}
              asking={asking === challenge.id}
              onJoin={(c) => act(c, true)}
              onLeave={(c) => act(c, false)}
              onAsk={setAsking}
              onBoard={(c) => setSheet({ kind: 'board', id: c.id })}
            />
          ))}
        </ul>
      )}

      {open !== undefined && (
        <BoardSheet gym={{ ...gym, timezone: list.timezone }} challenge={open} onClose={() => setSheet(null)} onPerson={(row) => setSheet({ kind: 'profile', row })} />
      )}
      {sheet?.kind === 'profile' && <PersonProfile gym={gym} person={sheet.row} period="this_month" onClose={() => setSheet(null)} />}
    </section>
  );
}
