import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { MEMBER_PT_WEEKS, PT_LATE_CANCEL_ERROR } from '@app/shared';
import { memberPtService } from '../../api/memberPtApi';
import { errorCode, errorStatus, errorText } from '../../api/orgsApi';
import Sheet from './Sheet';
import { weekText } from './classesView';
import { emptyText, ptCancelAsk, ptCancelledText, ptPage, ptZoneNote, sessionText } from './personalTrainingView';

// A GYM'S PERSONAL TRAINING FOR ITS MEMBER (spec Part 3 §13.5; ROADMAP 17e-ii): the
// trainers' available times, each a button that books it, and the member's own sessions
// with Cancel. The server decides every one, and sends nobody else's session. The member
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
    setWeek(to);
  };
  const tryAgain = () => {
    setState({ loading: true, error: null, view: null });
    load();
  };

  const book = async (trainer, day, time) => {
    if (busy !== null) return;
    const id = `${trainer.trainerId}|${day.localDate}|${time.minute}`;
    const key = keys.current.get(id) ?? crypto.randomUUID();
    keys.current.set(id, key);
    setBusy(id);
    setSaid(null);
    try {
      const session = await memberPtService.book(gym.id, key, {
        trainerId: trainer.trainerId,
        localDate: day.localDate,
        startMinute: time.minute,
        minutes: trainer.sessionMinutes,
      });
      keys.current.delete(id);
      setSaid({ text: `Booked: ${sessionText(session)}.`, bad: false });
      load();
    } catch (err) {
      // An answer from the server ends this press; no answer keeps its key for the retry.
      if (err?.response !== undefined) keys.current.delete(id);
      setSaid({ text: errorText(err, "That didn't go through. Try again."), bad: true });
      // The times are not as this page showed them: read them again.
      if (err?.response !== undefined) load();
    } finally {
      setBusy(null);
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
  const page = view === null ? null : ptPage(view);
  const empty = view === null ? null : emptyText(view, gym.name);
  const note = view === null ? null : ptZoneNote(view.timezone, gym.name, deviceZone(), new Date());
  const ask = asking === null || view === null ? null : ptCancelAsk(asking, view.timezone);

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

          {view.sessions.length > 0 && (
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

          {empty !== null ? (
            <p className="text-sm" style={{ color: MUTED }}>{empty}</p>
          ) : (
            <>
              {page.top !== null && <p className="text-sm" style={{ color: page.top.can ? 'rgba(255,255,255,0.8)' : ORANGE }}>{page.top.text}</p>}
              <p className="text-xs" style={{ color: MUTED }}>
                {page.top === null || page.top.can ? 'Available times. Press one to book it.' : 'Available times.'}
              </p>
              {note !== null && <p className="text-xs" style={{ color: ORANGE }}>{note}</p>}
              {page.trainers.map((t) => (
                <div key={t.trainerId} role="group" aria-label={t.name} className="rounded-xl p-3 flex flex-col gap-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <p className="text-sm font-semibold text-white break-words">
                    {t.name} <span className="font-normal text-xs" style={{ color: MUTED }}>· {t.lengthText}</span>
                  </p>
                  {t.days.length === 0 ? (
                    <p className="text-xs" style={{ color: MUTED }}>No available times in these 7 days.</p>
                  ) : (
                    t.days.map((d) => (
                      <div key={d.localDate}>
                        <h4 className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: MUTED }}>{d.heading}</h4>
                        {d.note !== null && <p className="text-xs mb-1.5" style={{ color: d.can ? MUTED : ORANGE }}>{d.note}</p>}
                        <ul className="flex flex-wrap gap-2" aria-label={`${t.name}, ${d.heading}`}>
                          {d.times.map((time) => {
                            const id = `${t.trainerId}|${d.localDate}|${time.minute}`;
                            return (
                              <li key={time.minute}>
                                {d.can ? (
                                  <button
                                    type="button"
                                    disabled={busy !== null}
                                    onClick={() => book(t, d, time)}
                                    aria-label={`Book ${time.text} with ${t.name}, ${d.heading}`}
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
                      </div>
                    ))
                  )}
                </div>
              ))}
            </>
          )}
        </>
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
