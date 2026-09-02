import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { markedSentence, visitDays, withVisit } from './attendanceView';

// "I'M HERE" — Kd's ruling of 2026-08-31 (:26469), and the member's own list of
// the days they came (:27900, his answer at the card's gate).
//
// THERE IS ONE WAY IN ON THE WEB AND IT IS THIS BUTTON. The QR code, the
// poster, the deep link and the scan-confirm screen are ALL phone-app work
// (:26558, :26586 — *"drop the scan part completely from web"*), so nothing
// here draws or consumes a QR. `method` still records `manual` today and `qr`
// when the phone app ships, which is why the two are separate values in the
// database from day one rather than one "attended" flag.
//
// THE BUTTON IS ABSENT, NEVER GREYED, WHEN THE GYM HAS THE SWITCH OFF (ruling
// 4, :24141's defect): a dead control with no explanation is worse than no
// control. **The member's own history stays** in that state — those visits
// really happened, and hiding them because the gym stopped taking new ones
// would remove a thing Kd ruled in.
//
// NOTHING HERE POLLS, RE-READS ON FOCUS, OR RUNS ON A TIMER, and that is a
// SERVER constraint rather than a style choice: this read and the console's
// day list share ONE rate-limit bucket — 600 an hour between them, one Redis
// key — so a loop on this screen would spend an owner's allowance as well as
// the member's. After a successful tap the server's own answer is written into
// the list on screen (`withVisit`) instead of asking again.

/** One chip per visit. Times are the GYM's, on the GYM's clock — see
 *  `attendanceView.js` for why the zone is never the reader's. */
function DayRow({ row }) {
  return (
    <li className="flex items-baseline gap-2 flex-wrap">
      <span className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
        {row.label}
      </span>
      {row.times.map((time, i) => (
        // KEYED BY THE TIME AND ITS POSITION. Two visits cannot share a minute
        // in one session (the UNIQUE sees to that), but two different sessions
        // in one day CAN both start at a minute that formats the same on a
        // 12-hour clock, and a duplicate sibling key silently drops a fiber
        // (:20867, the guard in `test-setup.js`).
        <span
          key={`${row.day}-${i}-${time}`}
          className="text-2xs px-1.5 py-0.5 rounded-md"
          style={{ background: 'rgba(255,138,31,0.12)', color: '#FFB347' }}
        >
          {time}
        </span>
      ))}
    </li>
  );
}

export default function AttendancePanel({ gym }) {
  const gymId = gym?.id ?? null;
  const [mark, setMark] = useState({ busy: false, done: null, error: null });
  // `status` is named rather than inferred from an empty list: "nobody has a
  // visit yet" and "we could not ask" look identical in the data and must never
  // look identical on screen (:8267/:8343).
  const [history, setHistory] = useState({
    status: 'loading',
    visits: [],
    timezone: null,
    clockFormat: '24h',
    more: false,
  });

  useEffect(() => {
    if (gymId === null) return undefined;
    let cancelled = false;
    void orgService
      .getAttendanceHistory(gymId)
      .then((res) => {
        if (cancelled) return;
        const answer = res.data?.attendance;
        setHistory({
          status: 'ready',
          visits: answer?.visits ?? [],
          timezone: answer?.timezone ?? null,
          clockFormat: answer?.clockFormat ?? '24h',
          more: (answer?.nextCursor ?? null) !== null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        // The list is not drawn at all on a failure — no empty state, no error
        // strip. The BUTTON is the point of this panel and it still works; a
        // red bar about a background read would be noise on the screen somebody
        // opened to say they had arrived.
        setHistory((held) => ({ ...held, status: 'failed' }));
      });
    return () => {
      cancelled = true;
    };
  }, [gymId]);

  const markPresent = async () => {
    if (gymId === null) return;
    setMark({ busy: true, done: null, error: null });
    try {
      const res = await orgService.markAttendance(gymId);
      const answer = res.data;
      setMark({ busy: false, done: answer, error: null });
      // THE SERVER'S OWN VISIT GOES STRAIGHT INTO THE LIST — see the header for
      // why this is not a re-read. The zone and clock come with it, so a member
      // whose history read FAILED still gets a correctly-formatted chip.
      setHistory((held) => ({
        ...held,
        status: held.status === 'failed' ? 'ready' : held.status,
        visits: withVisit(held.visits, answer?.visit ?? null),
        timezone: held.timezone ?? answer?.timezone ?? null,
        clockFormat: held.timezone === null ? (answer?.clockFormat ?? '24h') : held.clockFormat,
      }));
    } catch (err) {
      setMark({
        busy: false,
        done: null,
        // The server's own sentence where it has one — the refusals here are
        // things only it knows (the switch is off, the membership ended, the
        // gym was closed down), and inventing a friendlier reason would be
        // guessing at which.
        error: errorText(err, "We couldn't record that just now. Please try again."),
      });
    }
  };

  const days = visitDays(history.visits, {
    timezone: history.timezone,
    clockFormat: history.clockFormat,
  });

  return (
    <div className="mt-3">
      {/* ABSENT, NOT GREYED (ruling 4). Only an explicit `false` hides it: the
          shared contract defaults the field to `true`, so an api older than
          this bundle cannot make a gym's only way in disappear. */}
      {gym?.manualAttendanceEnabled !== false ? (
        <button
          type="button"
          onClick={markPresent}
          disabled={mark.busy}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-40"
          style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
        >
          {mark.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          I&apos;m here
        </button>
      ) : null}

      {mark.done !== null ? (
        <p
          className="text-sm mt-2 flex items-start gap-1.5"
          style={{ color: '#FF8A1F' }}
        >
          <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {/* The five states are five sentences and one of them says nothing
              about opening hours — see `markedSentence`. The clock is the one
              the SERVER sent with the visit, not the one the history read
              happened to bring back. */}
          <span>
            {markedSentence(mark.done.visit, {
              alreadyMarked: mark.done.alreadyMarked === true,
              clockFormat: mark.done.clockFormat ?? '24h',
            })}
          </span>
        </p>
      ) : null}

      {mark.error !== null ? (
        <p className="text-sm mt-2" style={{ color: '#ef4444' }}>
          {mark.error}
        </p>
      ) : null}

      {/* THE DAYS THEY CAME. Drawn only when the read actually answered — a
          failed read draws nothing at all rather than "no visits yet", which
          would be this app telling somebody their own history is empty because
          a request dropped. */}
      {history.status === 'ready' ? (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Days you came
          </p>
          {days.length === 0 ? (
            <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
              You haven&apos;t marked yourself in here yet.
            </p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1">
              {days.map((row) => (
                <DayRow key={row.day} row={row} />
              ))}
            </ul>
          )}
          {/* SAID RATHER THAN SILENTLY TRUNCATED. The server pages this list and
              this screen reads the first page only, so a member with a long
              history is told that what they are looking at is the recent part —
              a list that simply stopped would read as "this is all of it". */}
          {history.more ? (
            <p className="text-xs mt-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Showing your most recent visits.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
