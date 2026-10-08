import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { MEMBER_PT_WEEKS, PT_LATE_CANCEL_ERROR } from '@app/shared';
import { memberPtService } from '../../api/memberPtApi';
import { errorCode, errorStatus, errorText } from '../../api/orgsApi';
import Sheet from './Sheet';
import { weekText } from './classesView';
import { emptyText, historyText, ptBookAsk, ptCancelAsk, ptCancelledText, ptDay, ptDays, ptZoneNote, sessionText } from './personalTrainingView';

// A GYM'S PERSONAL TRAINING FOR ITS MEMBER (spec Part 3 §13.5; ROADMAP 17e-ii): the
// trainers' available times on the day picked, each a button that asks first and then books it, and the
// member's own sessions with Cancel; one that is over or cancelled stays in that list,
// saying what happened. The server decides every one, and sends nobody else's session. The member
// web's screen until the phone app has its own.

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

export default function PersonalTraining({ gym }) {
  const [week, setWeek] = useState(0);
  const [state, setState] = useState({ loading: true, error: null, view: null });
  // The one press on its way, and what the server last said.
  const [busy, setBusy] = useState(null);
  const [said, setSaid] = useState(null);
  const [asking, setAsking] = useState(null);
  // The time pressed, waiting for the member's yes: nothing is booked by one press.
  const [choosing, setChoosing] = useState(null);
  // The day whose times are shown; null until one is pressed, and then the first with a time.
  const [picked, setPicked] = useState(null);
  // One key a time pressed: kept while its answer is unknown, so a retry cannot book twice.
  const keys = useRef(new Map());
  const asked = useRef(0);

  const load = useCallback(() => {
    const mine = ++asked.current;
    memberPtService
      .view(gym.id, week)
      .then((view) => {
        if (mine !== asked.current) return;
        setState({ loading: false, error: null, view });
      })
      .catch((err) => {
        if (mine !== asked.current) return;
        // The server's 404 is for anybody who is not a member of a gym on a live plan.
        const error = errorStatus(err) === 404 ? `${gym.name}'s personal training isn't available right now.` : errorText(err, "Couldn't load personal training.");
        setState({ loading: false, error, view: null });
      });
  }, [gym.id, gym.name, week]);
  useEffect(() => {
    load();
    return () => {
      asked.current += 1;
    };
  }, [load]);

  const go = (to) => {
    setState((s) => ({ ...s, loading: true }));
    setChoosing(null);
    setPicked(null);
    setWeek(to);
  };
  const tryAgain = () => {
    setState({ loading: true, error: null, view: null });
    load();
  };

  const book = async (trainer, localDate, time) => {
    if (busy !== null) return;
    const id = `${trainer.trainerId}|${localDate}|${time.minute}`;
    const key = keys.current.get(id) ?? crypto.randomUUID();
    keys.current.set(id, key);
    setBusy(id);
    setSaid(null);
    try {
      const session = await memberPtService.book(gym.id, key, {
        trainerId: trainer.trainerId,
        localDate,
        startMinute: time.minute,
        minutes: trainer.sessionMinutes,
      });
      keys.current.delete(id);
      // The same press answered again can find a session that was cancelled since: it is
      // said as it is, never as booked.
      setSaid(session.status === 'booked' ? { text: `Booked: ${sessionText(session)}.`, bad: false } : { text: 'That session was cancelled since. It is not booked.', bad: true });
      load();
    } catch (err) {
      // An answer from the server ends this press; no answer keeps its key for the retry.
      if (err?.response !== undefined) keys.current.delete(id);
      setSaid({ text: errorText(err, "That didn't go through. Try again."), bad: true });
      // The times are not as this page showed them: read them again.
      if (err?.response !== undefined) load();
    } finally {
      setBusy(null);
      setChoosing(null);
    }
  };

  const cancel = async (session) => {
    if (busy !== null) return;
    const lateOk = session.cancel === 'late';
    setBusy(session.id);
    setSaid(null);
    try {
      const now = await memberPtService.cancel(gym.id, session.id, lateOk);
      setAsking(null);
      setSaid({ text: ptCancelledText(now), bad: false });
      load();
    } catch (err) {
      if (errorCode(err) === PT_LATE_CANCEL_ERROR && !lateOk) {
        // The free time ran out while the box was open: ask again, as a late cancel.
        setAsking({ ...session, cancel: 'late', packCharged: err.response?.data?.packCharged === true });
      } else {
        setAsking(null);
        setSaid({ text: errorText(err, "That didn't go through. Try again."), bad: true });
        if (err?.response !== undefined) load();
      }
    } finally {
      setBusy(null);
    }
  };

  const view = state.view;
  const row = view === null ? null : ptDays(view);
  const shown = row === null ? null : row.days.some((d) => d.localDate === picked) ? picked : row.first;
  const day = view === null || shown === null ? null : ptDay(view, shown);
  const shownLabel = row?.days.find((d) => d.localDate === shown)?.label ?? '';
  const empty = view === null ? null : emptyText(view, gym.name);
  const note = view === null ? null : ptZoneNote(view.timezone, gym.name, deviceZone(), new Date());
  const ask = asking === null || view === null ? null : ptCancelAsk(asking, view.timezone, gym.name);
  const bookAsk = choosing === null ? null : ptBookAsk({ trainerName: choosing.trainer.name, dayLabel: choosing.label, timeText: choosing.time.text, pay: choosing.pay });

  return (
    <section aria-label={`${gym.name}'s personal training`} className="flex flex-col gap-3 mt-3">
      {state.loading && view === null ? (
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
      ) : (
        <>
          {said !== null && (
            <p role="status" className="text-sm" style={{ color: said.bad ? RED : GREEN }}>{said.text}</p>
          )}

          {view.sessions.length + view.history.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: MUTED }}>Your sessions</h3>
              <ul className="flex flex-col gap-2" aria-label="Your sessions">
                {view.sessions.map((s) => (
                  <li key={s.id} className="rounded-xl p-3 flex flex-wrap items-center justify-between gap-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white break-words">{sessionText(s)}</p>
                      {s.packCharged && <p className="text-xs mt-0.5" style={{ color: MUTED }}>1 session used from your pack</p>}
                    </div>
                    {s.cancel !== null && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => setAsking(s)}
                        aria-label={`Cancel session: ${sessionText(s)}`}
                        className="px-3.5 py-2 rounded-xl text-sm font-semibold min-h-11 disabled:opacity-50"
                        style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)' }}
                      >
                        Cancel session
                      </button>
                    )}
                  </li>
                ))}
                {view.history.map((s) => (
                  <li key={s.id} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <p className="text-sm break-words" style={{ color: MUTED }}>{sessionText(s)}</p>
                    <p className="text-xs mt-0.5" style={{ color: MUTED }}>{historyText(s)}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
            <p className="text-sm font-semibold text-white text-center">{week === 0 ? `Next 7 days · ${weekText(view)}` : weekText(view)}</p>
            <button
              type="button"
              onClick={() => go(week + 1)}
              disabled={week === MEMBER_PT_WEEKS - 1 || view.to >= view.lastDay || state.loading}
              className="px-3 py-2 rounded-xl text-sm font-semibold min-h-11 flex items-center gap-1 disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.8)' }}
            >
              Later <ChevronRight aria-hidden="true" className="w-4 h-4" />
            </button>
          </div>

          {empty !== null || day === null ? (
            <p className="text-sm" style={{ color: MUTED }}>{empty}</p>
          ) : (
            <>
              <div role="group" aria-label="Pick a day" className="flex flex-wrap gap-2">
                {row.days.map((d) => (
                  <button
                    key={d.localDate}
                    type="button"
                    aria-pressed={d.localDate === shown}
                    onClick={() => setPicked(d.localDate)}
                    className="px-3 py-2 rounded-xl text-sm font-semibold min-h-11"
                    style={
                      d.localDate === shown
                        ? { background: 'rgba(255,138,31,0.18)', color: ORANGE }
                        : { background: 'rgba(255,255,255,0.05)', color: d.hasTimes ? 'rgba(255,255,255,0.8)' : MUTED }
                    }
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              {day.notOpen === null && day.pay !== null && <p className="text-sm" style={{ color: day.pay.can ? 'rgba(255,255,255,0.8)' : ORANGE }}>{day.pay.text}</p>}
              {day.notOpen !== null ? (
                <p className="text-sm" style={{ color: MUTED }}>{day.notOpen}</p>
              ) : (
                <p className="text-xs" style={{ color: MUTED }}>{day.can ? 'Available times. Press one to book it.' : 'Available times.'}</p>
              )}
              {note !== null && <p className="text-xs" style={{ color: ORANGE }}>{note}</p>}
              {(day.notOpen === null ? day.trainers : []).map((t) => (
                <div key={t.trainerId} role="group" aria-label={t.name} className="rounded-xl p-3 flex flex-col gap-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <p className="text-sm font-semibold text-white break-words">
                    {t.name} <span className="font-normal text-xs" style={{ color: MUTED }}>· {t.lengthText}</span>
                  </p>
                  {t.times.length === 0 ? (
                    <p className="text-xs" style={{ color: MUTED }}>{t.later ?? 'No available times on this day.'}</p>
                  ) : (
                    <ul className="flex flex-wrap gap-2" aria-label={`${t.name}, ${shownLabel}`}>
                      {t.times.map((time) => {
                        const id = `${t.trainerId}|${shown}|${time.minute}`;
                        return (
                          <li key={time.minute}>
                            {day.can ? (
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() => setChoosing({ trainer: t, localDate: shown, time, label: shownLabel, pay: day.pay })}
                                aria-label={`Book ${time.text} with ${t.name}, ${shownLabel}`}
                                className="px-3.5 py-2 rounded-xl text-sm font-semibold min-h-11 flex items-center gap-1.5 disabled:opacity-50"
                                style={{ background: ORANGE, color: '#161412' }}
                              >
                                {busy === id ? <Loader2 aria-label="Working" className="w-4 h-4 animate-spin" /> : <span aria-hidden="true">+</span>}
                                {time.text}
                              </button>
                            ) : (
                              <span className="px-3 py-2 rounded-xl text-sm inline-block" style={{ border: '1px solid rgba(255,255,255,0.12)', color: MUTED }}>
                                {time.text}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {t.times.length > 0 && t.later !== null && <p className="text-xs" style={{ color: MUTED }}>{t.later}</p>}
                </div>
              ))}
            </>
          )}
        </>
      )}

      {bookAsk !== null && (
        <Sheet title={bookAsk.title} onClose={() => busy === null && setChoosing(null)}>
          <div className="flex flex-col gap-2">
            {bookAsk.lines.map((line) => (
              <p key={line} className="text-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>{line}</p>
            ))}
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => book(choosing.trainer, choosing.localDate, choosing.time)}
                className="px-3.5 py-2 rounded-xl text-sm font-semibold min-h-11 flex items-center gap-1.5 disabled:opacity-50"
                style={{ background: ORANGE, color: '#161412' }}
              >
                {busy !== null ? <Loader2 aria-label="Working" className="w-4 h-4 animate-spin" /> : null}
                {bookAsk.yes}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setChoosing(null)}
                className="px-3.5 py-2 rounded-xl text-sm font-semibold min-h-11 disabled:opacity-50"
                style={{ background: 'rgba(255,255,255,0.06)', color: '#fff' }}
              >
                {bookAsk.no}
              </button>
            </div>
          </div>
        </Sheet>
      )}

      {ask !== null && (
        <Sheet title={ask.title} onClose={() => busy === null && setAsking(null)}>
          <div className="flex flex-col gap-2">
            {ask.lines.map((line) => (
              <p key={line} className="text-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>{line}</p>
            ))}
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => cancel(asking)}
                className="px-3.5 py-2 rounded-xl text-sm font-semibold min-h-11 disabled:opacity-50"
                style={{ background: RED, color: '#fff' }}
              >
                {ask.yes}
              </button>
              <button
                type="button"
                disabled={busy !== null}
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
