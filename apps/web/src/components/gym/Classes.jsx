import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { CLASS_LATE_CANCEL_ERROR, MEMBER_CLASSES_WEEKS } from '@app/shared';
import { classesService } from '../../api/classesApi';
import { errorCode, errorStatus, errorText } from '../../api/orgsApi';
import Sheet from './Sheet';
import { MORE_CLASSES, actionsOf, byDay, cancelAsk, cancelledText, dayHeading, mineText, nextLinkAt, onlineText, placesText, weekText, whenText, whyText, zoneNote } from './classesView';

// A GYM'S CLASSES FOR ITS MEMBER (spec Part 3 §13.6; ROADMAP 17d): the coming classes by
// day, with Book, Join waitlist, Claim place and Cancel. The server decides every one; a
// row shows what the server last said about its class. The member web's screen until the
// phone app has its own.

const ORANGE = '#FF8A1F';
const MUTED = 'rgba(255,255,255,0.45)';
const RED = '#ef4444';
const GREEN = '#4ade80';

const deviceZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
};

function ClassRow({ c, busy, said, onTake, onGive }) {
  const { take, give } = actionsOf(c);
  const mine = mineText(c);
  const places = placesText(c);
  const why = whyText(c);
  const waiting = c.mine?.status === 'waitlisted';
  const online = onlineText(c);
  return (
    <li className="rounded-xl p-3 flex flex-col gap-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white break-words" style={c.cancelled ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
            {c.className}
          </p>
          <p className="text-xs mt-0.5" style={{ color: MUTED }}>
            {whenText(c)}
            {places !== null && ` · ${places}`}
          </p>
        </div>
        {busy && <Loader2 aria-label="Working" className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: MUTED }} />}
      </div>
      {mine !== null && !c.cancelled && (
        <p className="text-xs font-semibold" style={{ color: waiting ? ORANGE : c.mine.status === 'booked' ? GREEN : MUTED }}>{mine}</p>
      )}
      {online !== null && (
        <p className="text-xs" style={{ color: online.ready ? GREEN : MUTED }} data-testid="class-online">{online.line}</p>
      )}
      {online !== null && online.link !== null && (
        <div>
          <a
            href={online.link}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Join class: ${c.className}, ${whenText(c)}`}
            className="inline-flex items-center px-3.5 py-2 rounded-xl text-sm font-semibold min-h-11"
            style={{ background: GREEN, color: '#161412' }}
          >
            Join class
          </a>
        </div>
      )}
      {why !== null && <p className="text-xs" style={{ color: MUTED }}>{why}</p>}
      {said !== null && (
        <p role="status" className="text-xs" style={{ color: said.bad ? RED : GREEN }}>{said.text}</p>
      )}
      {(take !== null || give !== null) && (
        <div className="flex flex-wrap gap-2">
          {take !== null && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onTake(c, take)}
              aria-label={`${take.label}: ${c.className}, ${whenText(c)}`}
              className="px-3.5 py-2 rounded-xl text-sm font-semibold min-h-11 disabled:opacity-50"
              style={{ background: ORANGE, color: '#161412' }}
            >
              {take.label}
            </button>
          )}
          {give !== null && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onGive(c)}
              aria-label={`${give.label}: ${c.className}, ${whenText(c)}`}
              className="px-3.5 py-2 rounded-xl text-sm font-semibold min-h-11 disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)' }}
            >
              {give.label}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export default function Classes({ gym }) {
  const [week, setWeek] = useState(0);
  const [state, setState] = useState({ loading: true, error: null, list: null });
  // What the server last said about a class, by its id, over the list as it was read.
  const [busyId, setBusyId] = useState(null);
  const [said, setSaid] = useState({});
  const [asking, setAsking] = useState(null);
  // One key a tap: kept while its answer is unknown, so a retry cannot book twice.
  const keys = useRef(new Map());
  const asked = useRef(0);

  const load = useCallback(() => {
    const mine = ++asked.current;
    classesService
      .list(gym.id, week)
      .then((list) => {
        if (mine !== asked.current) return;
        // A class they hold needs no kept key: the tap it was for has plainly been answered.
        for (const c of list.classes) if (c.mine?.status === 'booked' || c.mine?.status === 'waitlisted') keys.current.delete(c.sessionId);
        setState({ loading: false, error: null, list });
      })
      .catch((err) => {
        if (mine !== asked.current) return;
        // The server's 404 is for anybody who is not a member of a gym on a live plan.
        const error = errorStatus(err) === 404 ? `${gym.name}'s classes aren't available right now.` : errorText(err, "Couldn't load the classes.");
        setState({ loading: false, error, list: null });
      });
  }, [gym.id, gym.name, week]);
  useEffect(() => {
    load();
    return () => {
      asked.current += 1;
    };
  }, [load]);

  // The list is read again the moment a class's link is due, so Join class shows by itself.
  const linkAt = nextLinkAt(state.list?.classes);
  useEffect(() => {
    if (linkAt === null) return undefined;
    const timer = setTimeout(load, Math.max(0, linkAt - Date.now()) + 1000);
    return () => clearTimeout(timer);
  }, [linkAt, load]);

  const go = (to) => {
    setState((s) => ({ ...s, loading: true }));
    setWeek(to);
  };
  const tryAgain = () => {
    setState({ loading: true, error: null, list: null });
    load();
  };

  const put = (c) =>
    setState((s) => (s.list === null ? s : { ...s, list: { ...s.list, classes: s.list.classes.map((x) => (x.sessionId === c.sessionId ? c : x)) } }));
  const say = (sessionId, text, bad) => setSaid((m) => ({ ...m, [sessionId]: text === null ? null : { text, bad } }));

  const take = async (c, action) => {
    if (busyId !== null) return;
    const key = keys.current.get(c.sessionId) ?? crypto.randomUUID();
    keys.current.set(c.sessionId, key);
    setBusyId(c.sessionId);
    say(c.sessionId, null, false);
    try {
      const now = await classesService.book(gym.id, c.sessionId, key, action.joinWaitlist);
      keys.current.delete(c.sessionId);
      put(now);
      // One booking changes what the others say (a week's bookings, a pack's last class).
      load();
    } catch (err) {
      // An answer from the server ends this tap; no answer keeps its key for the retry.
      if (err?.response !== undefined) keys.current.delete(c.sessionId);
      say(c.sessionId, errorText(err, "That didn't go through. Try again."), true);
      // The class is not as this row showed it: read the week again.
      if (err?.response !== undefined) load();
    } finally {
      setBusyId(null);
    }
  };

  const give = async (c, lateOk) => {
    if (busyId !== null) return;
    setBusyId(c.sessionId);
    say(c.sessionId, null, false);
    try {
      const now = await classesService.cancel(gym.id, c.sessionId, lateOk);
      put(now);
      say(c.sessionId, cancelledText(now), false);
      setAsking(null);
      load();
    } catch (err) {
      if (errorCode(err) === CLASS_LATE_CANCEL_ERROR && !lateOk) {
        // The free time ran out while the box was open: ask again, as a late cancel.
        const packCharged = err.response?.data?.packCharged === true;
        setAsking({ ...c, can: { ...c.can, cancel: 'late' }, mine: c.mine === null ? null : { ...c.mine, packCharged } });
      } else {
        setAsking(null);
        say(c.sessionId, errorText(err, "That didn't go through. Try again."), true);
        if (err?.response !== undefined) load();
      }
    } finally {
      setBusyId(null);
    }
  };

  const list = state.list;
  const days = list === null ? [] : byDay(list.classes);
  const note = list === null ? null : zoneNote(list.classes, gym.name, deviceZone());
  const ask = asking === null ? null : cancelAsk(asking);

  return (
    <section aria-label={`${gym.name}'s classes`} className="flex flex-col gap-3 mt-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => go(week - 1)}
          disabled={week === 0 || state.loading}
          className="px-3 py-2 rounded-xl text-sm font-semibold min-h-11 flex items-center gap-1 disabled:opacity-40"
          style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.8)' }}
        >
          <ChevronLeft aria-hidden="true" className="w-4 h-4" /> Earlier
        </button>
        <p className="text-sm font-semibold text-white text-center">{list === null ? ' ' : week === 0 ? `Next 7 days · ${weekText(list)}` : weekText(list)}</p>
        <button
          type="button"
          onClick={() => go(week + 1)}
          disabled={week === MEMBER_CLASSES_WEEKS - 1 || state.loading}
          className="px-3 py-2 rounded-xl text-sm font-semibold min-h-11 flex items-center gap-1 disabled:opacity-40"
          style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.8)' }}
        >
          Later <ChevronRight aria-hidden="true" className="w-4 h-4" />
        </button>
      </div>

      {state.loading && list === null ? (
        <p className="text-sm flex items-center gap-2" style={{ color: MUTED }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </p>
      ) : state.error !== null ? (
        <div className="flex flex-col gap-2 items-start">
          <p className="text-sm" style={{ color: RED }}>{state.error}</p>
          <button type="button" onClick={tryAgain} className="px-3.5 py-2 rounded-xl text-sm font-semibold min-h-11" style={{ background: 'rgba(255,255,255,0.06)', color: '#fff' }}>
            Try again
          </button>
        </div>
      ) : days.length === 0 ? (
        <p className="text-sm" style={{ color: MUTED }}>
          {week === 0 ? `${gym.name} has no classes in the next 7 days.` : `${gym.name} has no classes in these 7 days.`}
        </p>
      ) : (
        <>
          {note !== null && <p className="text-xs" style={{ color: ORANGE }}>{note}</p>}
          {days.map((d) => (
            <div key={d.day}>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: MUTED }}>
                {dayHeading(d.day, week === 0 ? list.from : null)}
              </h3>
              <ul className="flex flex-col gap-2" aria-label={dayHeading(d.day, week === 0 ? list.from : null)}>
                {d.classes.map((c) => (
                  <ClassRow
                    key={c.sessionId}
                    c={c}
                    busy={busyId === c.sessionId}
                    said={said[c.sessionId] ?? null}
                    onTake={take}
                    onGive={setAsking}
                  />
                ))}
              </ul>
            </div>
          ))}
          {list.more && <p className="text-xs" style={{ color: ORANGE }}>{MORE_CLASSES}</p>}
        </>
      )}

      {ask !== null && (
        <Sheet title={ask.title} onClose={() => busyId === null && setAsking(null)}>
          <div className="flex flex-col gap-2">
            {ask.lines.map((line) => (
              <p key={line} className="text-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>{line}</p>
            ))}
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => give(asking, asking.can.cancel === 'late')}
                className="px-3.5 py-2 rounded-xl text-sm font-semibold min-h-11 disabled:opacity-50"
                style={{ background: RED, color: '#fff' }}
              >
                {ask.yes}
              </button>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => setAsking(null)}
                className="px-3.5 py-2 rounded-xl text-sm font-semibold min-h-11 disabled:opacity-50"
                style={{ background: 'rgba(255,255,255,0.06)', color: '#fff' }}
              >
                {ask.no}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </section>
  );
}
