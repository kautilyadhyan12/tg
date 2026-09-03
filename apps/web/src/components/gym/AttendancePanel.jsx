import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { attendanceShutReason, markedSentence, mergeVisits, visitDays, withVisit } from './attendanceView';

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
// AND IT IS GREYED, NEVER ABSENT, WHEN THE GYM IS SHUT RIGHT NOW — the OTHER
// half of :24141, and the two are not in tension. That entry rules on which of
// the two a state gets: a power somebody NEVER has draws nothing, because
// nothing false is being said; **a TEMPORARY fact about the GYM is greyed with
// a true sentence beside it, because a control that vanished would leave them
// guessing whether they had lost something.** The switch being off is the first
// kind — it is the gym's settled answer and the member has no way in at all.
// Being shut at 05:28 is the second: it clears at opening time, on its own, and
// the button is drawn all along so a member can see what will be there. The
// sentence is not optional either — a greyed control with nothing beside it is
// what :29500's C/H-1 graded Critical/High, on the sixth panel to do it.
//
// KD ASKED FOR THE BUTTON TO SAY WHAT IT IS FOR, in the same message that
// approved this: *"there should be some indication that i am here means
// attandance in gym so that user understands"*. **"I'm here" is his own
// wording and does not change** (:30867 quotes it); what was missing is
// anywhere on the card saying that pressing it marks attendance, so the label
// and the line under it do that and the button is left alone.
//
// THIS PANEL MUST BE MOUNTED ONE PER GYM, KEYED BY THE GYM'S ID, and that is a
// requirement on the CALLER rather than a detail of it (T3 round 2, F4).
// Nothing in here resets when `gym` changes — not the taps it is holding, not
// the history it read — because :20712 ruled that a per-field reset fixes the
// field somebody remembered and leaves the next one behind. `MyGyms.jsx` keys
// the card on `gym.id`, so React throws this away rather than handing gym B a
// panel holding gym A's visits. A second mount site that keys on anything else
// re-arms that, and no type or lint rule can see it.
//
// NOTHING HERE POLLS OR RE-READS ON FOCUS, and that is a SERVER constraint
// rather than a style choice: the history read and the console's day list share
// ONE rate-limit bucket — 600 an hour between them, one Redis key — so a loop
// on this screen would spend an owner's allowance as well as the member's.
// After a successful tap the server's own answer is kept and merged into what
// is drawn (`mergeVisits`) instead of asking again — held apart from the read's
// list, because a read already in flight cannot know about a tap and used to
// erase it (T3 round 1 C/H-2).
//
// ~~OR RUNS ON A TIMER~~ — **STRUCK 2026-09-03, and the distinction it was
// hiding is the one that matters: the constraint above is about REQUESTS, and
// this file now runs a timer that makes none.** `tick` re-reads the browser's
// CLOCK every half minute so the gate below can notice the gym opening. Without
// it the button is decided once, at paint, and a member sitting on this screen
// at 06:59 is still refused at 07:05 — blocked from something they are entitled
// to do, which is :5807's second clause and Critical/High. It issues no fetch,
// touches no bucket, and is cleared on unmount. **The two reads are unchanged
// and still happen exactly once each.**

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
  //
  // **ONLY THE READ EVER SETS `status`, and T3 round 1 C/H-1 is why.** A mark
  // used to flip a FAILED read to `ready` so the new visit could be drawn — and
  // that drew the whole list off a read that never answered, so a member with
  // months of history was shown a history of exactly one day, with `more` false
  // so not even the "most recent visits" line appeared. A tap tells you what it
  // recorded; it does not tell you what else is in your history, and a screen
  // that answers the second question from the first is guessing.
  const [history, setHistory] = useState({
    status: 'loading',
    visits: [],
    timezone: null,
    clockFormat: '24h',
    more: false,
  });
  // THE TAPS THIS SESSION CONFIRMED, HELD APART FROM THE READ'S LIST (C/H-2).
  // See `mergeVisits` — a read already in flight when somebody taps cannot know
  // about the tap, and holding both in one place let it erase them.
  const [marked, setMarked] = useState([]);
  // WHEN THE GYM IS OPEN — the SAME reader `GymHoursNote` uses two lines above
  // this button, which is what stops the button and the times it is judged
  // against ever disagreeing (`gymHoursSchema`'s own header: *"one reader for
  // the console and for the member's gym card"*).
  //
  // **IT IS A SECOND CALL ON THIS CARD AND THAT COST IS STATED, NOT HIDDEN.**
  // `GymHoursNote` makes its own, so `/my-gyms` asks each gym for its hours
  // twice. Sharing one answer means either a cache that outlives a component or
  // a second, optional shape for a note THREE screens already draw — both
  // bigger than this card and both able to break a screen Kd has smoked. It has
  // an `OWED.md` line instead, which is what :28822 §3 did with the identical
  // duplicate it created on the same screen.
  //
  // **`null` MEANS "WE HAVE NOT ASKED OR COULD NOT", AND THE GATE ADMITS ON
  // IT** — see `attendanceShutReason`. A failed read draws no error strip here
  // for `GymHoursNote`'s reason: this card is ADDITIVE, and the button still
  // works because the server is the enforcement.
  const [hours, setHours] = useState(null);
  // THE CLOCK, AND IT MAKES NO REQUEST — see the header. Held in state because
  // nothing else on this screen re-renders between the read landing and the
  // gym's opening minute, so without it the gate is frozen at paint.
  const [tick, setTick] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => {
      setTick(new Date());
    }, 30_000);
    return () => {
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (gymId === null) return undefined;
    let cancelled = false;
    void orgService
      .getHours(gymId)
      .then((res) => {
        if (cancelled) return;
        setHours(res.data?.hours ?? null);
      })
      .catch(() => {
        // Deliberately silent, and the gate admits on the null this leaves
        // behind: a member must never be refused their own gym's door because a
        // background read dropped (:24141 §3a).
      });
    return () => {
      cancelled = true;
    };
  }, [gymId]);

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
      // THE SERVER'S OWN VISIT GOES INTO ITS OWN LIST — see the header for why
      // this is not a re-read, and `mergeVisits` for why it is not put into the
      // read's list. `status` is deliberately untouched: a tap says what it
      // recorded and says nothing about what else is in the history (C/H-1).
      setMarked((held) => withVisit(held, answer?.visit ?? null));
      // THE MARK'S ZONE AND CLOCK ARE THE FRESHER PAIR AND WIN (T3 round 1,
      // L-4). Both answers describe the same gym, and this one was computed
      // now — so a gym that changed its clock between the read and the tap
      // draws the new chip the way the gym reads it today, not the way it did
      // when the page loaded.
      setHistory((held) => ({
        ...held,
        timezone: answer?.timezone ?? held.timezone,
        clockFormat: answer?.clockFormat ?? held.clockFormat,
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

  const days = visitDays(mergeVisits(history.visits, marked), {
    timezone: history.timezone,
    clockFormat: history.clockFormat,
  });
  // KD'S RULING OF 2026-09-03 REACHING THE SCREEN. Null means press away — and
  // it is null for every state we cannot decide, because the server is the
  // enforcement and refusing on a guess is the worse mistake (:24141 §3a).
  const shutReason = attendanceShutReason(hours, tick);

  return (
    <div className="mt-3">
      {/* ABSENT, NOT GREYED (ruling 4). Only an explicit `false` hides it: the
          shared contract defaults the field to `true`, so an api older than
          this bundle cannot make a gym's only way in disappear. */}
      {gym?.manualAttendanceEnabled !== false ? (
        <>
          {/* WHAT THE BUTTON IS FOR, because Kd asked for it in as many words
              and because "I'm here" on its own names no subject. It heads the
              control rather than the panel: a member whose gym has the switch
              off sees neither this nor the button, and their history below is
              left exactly as it was. */}
          <p
            className="text-xs uppercase tracking-wider"
            style={{ color: 'rgba(255,255,255,0.35)' }}
          >
            Attendance
          </p>
          <p className="text-sm mt-0.5 mb-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Pressing this marks your attendance at the gym.
          </p>
          <button
            type="button"
            onClick={markPresent}
            // GREYED, NEVER HIDDEN, and the sentence below is not decoration —
            // :29500's C/H-1 is a greyed control with nothing beside it.
            disabled={mark.busy || shutReason !== null}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-40"
            style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
          >
            {mark.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            I&apos;m here
          </button>
          {/* IT NAMES THE STATE AND NOT THE TIMES — `GymHoursNote` has already
              drawn today's opening times on this same card, on the gym's own
              clock, which is a better answer to "when should I come back" than
              this sentence could give without spelling one minute twice. */}
          {shutReason !== null ? (
            <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
              {shutReason}
            </p>
          ) : null}
        </>
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
