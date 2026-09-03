import { useEffect, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flame,
  Loader2,
  X,
} from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { gymToday } from '../../pages/console/hoursView';
import {
  attendanceShutReason,
  emptyMonthNote,
  markedSentence,
  mergeVisits,
  monthGrid,
  monthKeyOfDay,
  monthWindow,
  shiftMonthKey,
  withVisit,
} from './attendanceView';

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
// touches no bucket, and is cleared on unmount.
//
// ~~**The two reads are unchanged and still happen exactly once each.**~~
// **STRUCK 2026-09-03 BY THE CALENDAR (Kd, `:31508`): the history read now
// happens ONCE PER MONTH VIEWED.** The list it replaced grew without bound,
// which is the problem he named; a month grid is a fixed height however often
// somebody comes. **The cost is one request per arrow press and it is bounded by
// the person pressing** — nothing polls, nothing re-reads on focus, and stepping
// is an action rather than something the screen does on its own. Against the
// shared 600/hour bucket (`orgs_attendance_read`, split with the console's day
// list) a member would have to step through fifty years of months in an hour to
// reach it.

/** THE TIMES OF ONE DAY, OPENED BY TAPPING IT — Kd was told this cost before he
 *  chose the calendar (`OWED.md`): *"a square in a grid cannot show that
 *  somebody came at 5:01 PM and 3:32 AM, so the times move behind a tap on the
 *  day — the same place the workout calendar puts them"*.
 *
 *  **IT IS A SHEET AND NOT AN INLINE ROW because that is what he was told**, and
 *  `WorkoutCalendar`'s `SessionDetail` is the shape named: `items-end` on a
 *  phone, so it arrives as a bottom sheet where members actually read this
 *  (:26586), and centred from `sm` up. Tapping the backdrop or the X closes it.
 *
 *  **NO FOCUS TRAP, STATED RATHER THAN OMITTED.** `SessionDetail` has none
 *  either, so this adds no new standard; :23578 records that a jsdom test cannot
 *  prove keyboard behaviour anyway, so building one here would ship an
 *  unobserved guarantee. It has an `OWED.md` line for the app's modals as a
 *  class rather than a fix invented on this card. */
function DaySheet({ row, onClose }) {
  if (row === null) return null;
  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
    >
      <div
        role="presentation"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs rounded-3xl overflow-hidden p-5"
        style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#FF8A1F' }}>
              You were here
            </p>
            <h3 className="text-base font-bold text-white">{row.label}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            <X className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>
        </div>

        {row.times.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {row.times.map((time, i) => (
              // KEYED BY THE TIME AND ITS POSITION. Two visits cannot share a
              // minute in one session (the UNIQUE sees to that), but two
              // different sessions in one day CAN both start at a minute that
              // formats the same on a 12-hour clock, and a duplicate sibling key
              // silently drops a fiber (:20867, the guard in `test-setup.js`).
              <span
                key={`${row.date}-${i}-${time}`}
                className="text-xs px-2 py-1 rounded-md"
                style={{ background: 'rgba(255,138,31,0.12)', color: '#FFB347' }}
              >
                {time}
              </span>
            ))}
          </div>
        ) : (
          // THE DAY IS A FACT OFF THE WIRE; A TIME IS A RENDERING OF IT. A zone
          // `Intl` cannot resolve gives no chips, and saying "you came, at no
          // time" is better than either inventing a time in the reader's own
          // zone (trap #8) or dropping a day the member really attended.
          <p className="text-sm mt-3" style={{ color: 'rgba(255,255,255,0.55)' }}>
            You came this day. The times couldn&apos;t be read.
          </p>
        )}
      </div>
    </div>
  );
}

const WEEK_HEADS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** HOW WIDE THE MONTH IS ALLOWED TO BE — Kd, at his own browser: *"it looks
 *  disgusting covering alsmot the whole page ... the calender need to be compact
 *  small"*.
 *
 *  **THE CELLS WERE `aspect-square` IN A FULL-WIDTH CARD, WHICH IS WHY IT ATE
 *  THE PAGE.** On his screen that card is ~950px, so each square came out over a
 *  hundred pixels tall and six rows filled everything below the button. Capping
 *  the GRID rather than the cell keeps the squares square and makes the month
 *  ~36px a day — a block you take in at a glance instead of scrolling past. The
 *  weekday heads take the same cap or the columns stop lining up. */
const CALENDAR_MAX_WIDTH = '17rem';

/** ONE DAY SOMEBODY CAME — Kd's fire, and all three of his corrections are here.
 *
 *  *"the burn sysmbol so small have to use a maginfying glass"* · *"the burn
 *  symbol should be bright with color"* · *"in the middle of the symbol should
 *  be the date with white color"*.
 *
 *  **IT WAS A 10px HAIRLINE OUTLINE UNDER THE NUMBER.** Now the flame FILLS the
 *  square and is filled with the colour rather than stroked in it, and the date
 *  sits inside it in white — one mark instead of two competing ones.
 *
 *  **THE NUMBER IS NUDGED DOWN, and that is the flame's shape rather than a
 *  fudge**: a flame's mass is in its lower bulge, so the optical centre is below
 *  the geometric one and a number centred by the box reads as floating in the
 *  tip. **`aria-hidden` on the icon and the number in real text** — the date has
 *  to survive for anybody not looking at pixels, which is the thing a picture of
 *  a number would lose. */
function CameDay({ day }) {
  return (
    <span className="relative block w-full h-full">
      <Flame
        className="w-full h-full"
        style={{ color: '#FF8A1F' }}
        fill="#FF8A1F"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span
        className="absolute inset-0 flex items-center justify-center"
        style={{ paddingTop: '0.3em' }}
      >
        <span
          className="font-black tabular-nums leading-none text-white"
          style={{ fontSize: '0.6rem' }}
        >
          {day}
        </span>
      </span>
    </span>
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
  // THE ANSWER IS STAMPED WITH THE MONTH IT WAS FETCHED FOR — `Attendance.jsx`'s
  // own instrument (:29250 §6), on this side of the product.
  //
  // **A synchronous reset at the top of the effect is what this replaces**: it
  // is a cascading render (`react-hooks/set-state-in-effect`) and, worse, two
  // sources of truth — the held visits belong to the OLD month for as long as
  // the new read is in flight, and only the setter's timing keeps them off
  // screen. Stamping makes staleness a property of the DATA, so a read that
  // lands late cannot be drawn under the wrong month's heading whatever the
  // ordering.
  const [history, setHistory] = useState({
    status: 'loading',
    forMonth: null,
    visits: [],
    timezone: null,
    clockFormat: '24h',
    more: false,
  });
  // WHICH MONTH THE MEMBER HAS STEPPED TO, or null meaning "wherever the gym is
  // now". **DERIVED AT RENDER RATHER THAN SET IN AN EFFECT** — the month is a
  // function of the gym's zone and this member's presses, and computing it in an
  // effect was both a cascading render and a second place for it to live.
  const [monthStep, setMonthStep] = useState(null);
  // **THE CALENDAR IS FOLDED AWAY UNTIL SOMEBODY ASKS FOR IT — Kd, at his own
  // browser, 2026-09-03:** *"the calender need to be compact small and only
  // appear when click may be have a calendar symbol big that the user can see
  // properly"*. A full month opened by default filled the whole page under a
  // two-line gym card, which is the shape he was shown and rejected.
  //
  // **CLOSED IS THE STARTING STATE AND IT MUST BE ABLE TO GO BACK THERE**
  // (:31295 — a dropdown that arrived open and could not be closed, because one
  // `||` overrode the tap). Nothing forces this open; it is `useState` and the
  // header row is its only writer.
  const [calendarOpen, setCalendarOpen] = useState(false);
  // **AND WHETHER IT HAS EVER BEEN OPENED, WHICH IS A DIFFERENT QUESTION.** The
  // read is gated on THIS rather than on `calendarOpen`, so folding the calendar
  // away and opening it again does not spend another request on a month already
  // in hand — the shared 600/hour bucket, again. Two states because they mean
  // two things; collapsing them into one re-reads on every open.
  const [everOpened, setEverOpened] = useState(false);
  // THE DAY WHOSE TIMES ARE OPEN, or null. Holds the DATE and not the row, so a
  // month re-read cannot leave a stale row on screen — the row is looked up out
  // of the current grid at render.
  const [openDay, setOpenDay] = useState(null);
  // THE TAPS THIS SESSION CONFIRMED, HELD APART FROM THE READ'S LIST (C/H-2).
  // See `mergeVisits` — a read already in flight when somebody taps cannot know
  // about the tap, and holding both in one place let it erase them.
  const [marked, setMarked] = useState([]);
  // THE ZONE AND CLOCK THE MARK CAME BACK WITH, HELD APART FROM THE READ'S FOR
  // THE SAME REASON THE VISITS ARE (C/H-2), and this is the second time that
  // lesson has had to be applied on this panel.
  //
  // **T3 round 1's L-4 made the MARK's pair win because it is the FRESHER of two
  // answers about one gym. It won by ORDERING — the read had almost always
  // landed first — and the calendar broke that**: the history read now waits for
  // the hours read to name a month, so it lands AFTER a quick tap and its whole
  // object replaced `clockFormat`, spelling the new chip on the gym's OLD clock.
  // Found by a probe, not by a test, and not by reading (the setter was
  // untouched and still correct).
  //
  // Holding it separately makes the precedence a FACT rather than a race: the
  // tap's pair wins whenever there is one, whatever order the two responses
  // arrive in.
  const [markedClock, setMarkedClock] = useState(null);
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
  // WHETHER THE HOURS READ HAS FINISHED, WHICHEVER WAY IT WENT — and it exists
  // because `hours === null` cannot tell "not back yet" from "it failed". The
  // BUTTON does not care (both admit), but the CALENDAR does: it anchors its
  // first month on the gym's zone, which arrives with this read, and without
  // this flag a failed read would leave the grid waiting for ever.
  const [hoursDone, setHoursDone] = useState(false);
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
        setHoursDone(true);
      })
      .catch(() => {
        // Deliberately silent, and the gate admits on the null this leaves
        // behind: a member must never be refused their own gym's door because a
        // background read dropped (:24141 §3a).
        //
        // **THE FLAG IS STILL SET, and that is the point of having one.** The
        // calendar below waits for this read to RESOLVE before it names a month;
        // leaving the flag false on a failure would hang the grid on a request
        // that is never coming back, which is the loading-spinner-for-ever shape
        // :4267's F4 records.
        if (!cancelled) setHoursDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [gymId]);

  // THE MONTH THE GYM IS IN, and the month on screen — both DERIVED, neither
  // stored.
  //
  // **THE ZONE COMES FROM THE HOURS READ THIS CARD ALREADY MAKES, which is what
  // keeps the history read at ONE REQUEST PER MONTH.** The obvious alternative —
  // a first unwindowed history read to learn the zone, then a windowed one —
  // costs two requests on every mount, on a screen that draws one panel per gym
  // and shares a 600/hour bucket with the console.
  //
  // **IT WAITS FOR THE READ TO RESOLVE, NOT TO SUCCEED** (`hoursDone`): a failed
  // hours read must still produce a calendar, or a dropped background request
  // would remove a feature.
  //
  // **A ZONE WE CANNOT READ FALLS BACK TO THE READER'S, DELIBERATELY, AND IT IS
  // THE ONLY DATE ON THIS CARD THAT DOES.** `gymToday` already has that fallback
  // and `attendanceShutReason` refuses to use it — correctly, because that
  // decides whether a control is DEAD. This decides which month a grid OPENS on,
  // and the reader can step. Drawing no calendar at all because a zone failed to
  // resolve would remove the feature over a label being a day out.
  //
  // **RECOMPUTED OFF `tick`**, so a member sitting on this screen past the gym's
  // midnight is not left a month behind with the forward arrow dead.
  const gymZone =
    typeof hours?.timezone === 'string' && hours.timezone !== '' ? hours.timezone : null;
  const currentMonth = hoursDone
    ? monthKeyOfDay(gymZone === null ? gymToday(undefined, tick) : gymToday(gymZone, tick))
    : null;
  const month = monthStep ?? currentMonth;

  // THE HISTORY READ — ONE REQUEST PER MONTH VIEWED, and `month` is the only
  // dependency that moves after mount.
  //
  // **A TAP, A TICK OR AN OPENED DAY ISSUES NOTHING**, which is the shared
  // 600/hour bucket (`orgs_attendance_read`) the console's own day list also
  // draws from. Stepping months is the one thing that re-reads, and it is an
  // action a person takes rather than something the screen does on its own.
  //
  // **IT WAITS FOR `month`, WHICH MEANS IT WAITS FOR THE GYM'S ZONE.** A window
  // built from the browser's clock would ask for the wrong month for any member
  // not in their gym's zone — the window and the grid disagreeing about one
  // visit, which is the defect the server half was arranged to prevent
  // (DECISIONS `:31921` §1), arriving on the client instead.
  useEffect(() => {
    // **NOTHING IS ASKED FOR UNTIL THE CALENDAR HAS BEEN OPENED.** It is folded
    // away by default (Kd, 2026-09-03), so a member who never opens it costs the
    // server nothing at all — and `/my-gyms` draws one of these per gym, so on a
    // member of three that is three requests saved on every page load.
    if (gymId === null || month === null || !everOpened) return undefined;
    const window = monthWindow(month);
    if (window === null) return undefined;
    let cancelled = false;
    void orgService
      .getAttendanceHistory(gymId, window)
      .then((res) => {
        if (cancelled) return;
        const answer = res.data?.attendance;
        setHistory({
          status: 'ready',
          // STAMPED WITH THE MONTH ASKED FOR, never with whatever `month` is by
          // the time this lands.
          forMonth: month,
          visits: answer?.visits ?? [],
          timezone: answer?.timezone ?? null,
          clockFormat: answer?.clockFormat ?? '24h',
          more: (answer?.nextCursor ?? null) !== null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        // The grid is not drawn at all on a failure — no empty month, no error
        // strip. The BUTTON is the point of this panel and it still works; a
        // red bar about a background read would be noise on the screen somebody
        // opened to say they had arrived. Stamped like the success, so a failure
        // on one month cannot mark another month failed.
        setHistory((held) => ({ ...held, status: 'failed', forMonth: month }));
      });
    return () => {
      cancelled = true;
    };
  }, [gymId, month, everOpened]);

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
      //
      // **INTO ITS OWN STATE, NEVER INTO `history`.** Merging it there made the
      // precedence depend on which response landed last, and the calendar's
      // month gate is what made the read land second — see `markedClock`.
      setMarkedClock({
        timezone: answer?.timezone ?? null,
        clockFormat: answer?.clockFormat ?? null,
      });
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

  // AN ANSWER TO A DIFFERENT MONTH IS NOT AN ANSWER (:29250 §6). Until the read
  // for the month on screen lands, this grid is loading — it never draws
  // September's days under October's heading, whatever order the responses
  // arrive in.
  const fresh = history.forMonth === month && month !== null;
  const gridStatus = fresh ? history.status : 'loading';

  // THE GRID. `mergeVisits` is unchanged and still holds the read's list and
  // this session's taps apart (T3 round 1 C/H-2) — what the month adds is that a
  // tap made TODAY simply does not match any cell of a month somebody has
  // stepped back to. That falls out of indexing by date rather than needing a
  // filter, and it is asserted rather than assumed.
  //
  // **THE VISITS ARE THE STAMPED ONES ONLY.** Drawing `history.visits` while the
  // stamp disagrees is the exact defect the stamp exists to prevent.
  // THE FRESHER PAIR WINS, DECIDED HERE RATHER THAN BY WHICH RESPONSE LANDED
  // LAST (T3 round 1 L-4, re-fixed — see `markedClock`).
  const shownZone = markedClock?.timezone ?? history.timezone;
  const shownClock = markedClock?.clockFormat ?? history.clockFormat;
  const grid =
    month === null
      ? null
      : monthGrid(month, fresh ? mergeVisits(history.visits, marked) : marked, {
          timezone: shownZone,
          clockFormat: shownClock,
          // The GYM's today, so a day is greyed as future by the gym's calendar
          // and not the reader's. Null when we have no zone — nothing is greyed,
          // which is the admit-on-unknown direction this file uses everywhere.
          today: gymZone === null ? null : gymToday(gymZone, tick),
        });
  const openRow = grid?.cells.find((c) => c.date === openDay && c.came) ?? null;

  /** MOVE A MONTH, AND CLOSE WHATEVER DAY WAS OPEN.
   *
   *  **ONE FUNCTION RATHER THAN THE SAME TWO LINES IN BOTH ARROWS, AND THE
   *  MUTATION SWEEP IS WHY.** With the clear written into each handler, deleting
   *  it from ONE of them changed nothing observable: the sheet is looked up out
   *  of the CURRENT grid, so stepping away closes it either way, and the OTHER
   *  handler cleared it on the way back. The mutant survived both single
   *  deletions — :28221 §3(d)'s question, and the answer here was that the
   *  guarantee was held by the PAIR, so no honest fixture could attack it.
   *
   *  **WHAT IT PROTECTS IS THE ROUND TRIP.** Without the clear, a member who
   *  opens the 2nd, steps to August and steps back finds the sheet OPEN again —
   *  a panel appearing over the screen that nobody tapped. */
  const stepMonth = (delta) => {
    setOpenDay(null);
    setMonthStep(shiftMonthKey(month, delta));
  };
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

      {/* THE DAYS THEY CAME — Kd's calendar (`:31508`). The heading stays and
          the grid replaces the list under it, because the list grew without
          bound and a month is a fixed height however often somebody comes.
          The month arrows are drawn as soon as there is a month, INCLUDING
          while a read is in flight: hiding them during loading would make a
          second press impossible until the first landed, which on a slow
          connection reads as a broken control. */}
      {grid !== null ? (
        <div className="mt-3">
          {/* THE FOLD — Kd, 2026-09-03: *"only appear when click may be have a
              calendar symbol big that the user can see properly"*. The whole row
              is the control rather than a small chevron beside a heading,
              because on a phone a 44px row is a target and a 14px chevron is
              not (:26586 — members are on phones).

              **IT SAYS WHICH WAY IT WILL GO.** `aria-expanded` is the state and
              the chevron follows it, so a screen reader and an eye get the same
              answer — and :31295's defect was a control whose comment said it
              could close while one `||` stopped it, so the closing direction is
              driven by a test rather than described here. */}
          <button
            type="button"
            onClick={() => {
              setCalendarOpen((open) => !open);
              setEverOpened(true);
            }}
            aria-expanded={calendarOpen}
            className="w-full flex items-center gap-2.5 rounded-xl px-2 py-2 -mx-2"
            style={{ background: calendarOpen ? 'rgba(255,255,255,0.03)' : 'transparent' }}
          >
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(255,138,31,0.15)' }}
            >
              <CalendarDays className="w-5 h-5" style={{ color: '#FF8A1F' }} aria-hidden="true" />
            </span>
            <span
              className="text-xs uppercase tracking-wider flex-1 text-left"
              style={{ color: 'rgba(255,255,255,0.55)' }}
            >
              Days you came
            </span>
            <ChevronDown
              className="w-4 h-4 flex-shrink-0"
              style={{
                color: 'rgba(255,255,255,0.45)',
                transform: calendarOpen ? 'rotate(180deg)' : 'none',
              }}
              aria-hidden="true"
            />
          </button>

          {calendarOpen ? (
            <>
          <div className="flex items-center justify-between gap-2 mt-2">
            <p className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {grid.label}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => { stepMonth(-1); }}
                aria-label="Previous month"
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.04)' }}
              >
                <ChevronLeft className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.65)' }} />
              </button>
              {/* THE FUTURE IS NOT OFFERED. Bounded by the GYM's month, so a
                  member reading late at night in another country is not stopped
                  a month early — or let a month past. */}
              <button
                type="button"
                onClick={() => { stepMonth(1); }}
                disabled={currentMonth !== null && month >= currentMonth}
                aria-label="Next month"
                className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-30"
                style={{ background: 'rgba(255,255,255,0.04)' }}
              >
                <ChevronRight className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.65)' }} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mt-2" style={{ maxWidth: CALENDAR_MAX_WIDTH }}>
            {WEEK_HEADS.map((d) => (
              <div
                key={d}
                className="text-center text-2xs font-semibold uppercase tracking-wider"
                style={{ color: 'rgba(255,255,255,0.30)' }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* THREE STATES, NEVER TWO — "we could not ask" and "nobody came" look
              identical in the data and must never look identical on screen
              (:8267/:8343). A failed read draws no grid at all rather than a
              month of empty squares, which would be this app telling somebody
              they did not come on days nobody looked at. */}
          {gridStatus === 'failed' ? (
            <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Couldn&apos;t load the days you came.
            </p>
          ) : (
            <>
              <div
                className="grid grid-cols-7 gap-0.5 mt-1"
                aria-busy={gridStatus === 'loading'}
                style={{ maxWidth: CALENDAR_MAX_WIDTH, opacity: gridStatus === 'loading' ? 0.4 : 1 }}
              >
                {Array.from({ length: grid.leading }, (_, i) => (
                  <div key={`lead-${String(i)}`} />
                ))}
                {grid.cells.map((cell) => (
                  <button
                    key={cell.date}
                    type="button"
                    onClick={() => {
                      if (cell.came) setOpenDay(cell.date);
                    }}
                    disabled={!cell.came || gridStatus === 'loading'}
                    // THE DAY NUMBER IS ALWAYS READABLE AND THE FIRE SITS BESIDE
                    // IT. Kd asked for "a day with attandance will have a fire
                    // effect"; a fire drawn OVER the number would take the date
                    // away to show that the date mattered.
                    aria-label={
                      cell.came ? `${String(cell.day)} — you came` : String(cell.day)
                    }
                    className="aspect-square rounded-lg flex items-center justify-center p-px"
                    style={{
                      cursor: cell.came ? 'pointer' : 'default',
                      opacity: cell.future ? 0.3 : 1,
                    }}
                  >
                    {/* THE FIRE CARRIES THE DATE (Kd, 2026-09-03), so a day that
                        was two marks — a small number with a smaller flame under
                        it — is now one. A day nobody came on keeps a plain
                        number and no tinted box: the box was competing with the
                        flame for the same job. */}
                    {cell.came ? (
                      <CameDay day={cell.day} />
                    ) : (
                      <span
                        className="font-medium tabular-nums leading-none"
                        style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.45)' }}
                      >
                        {cell.day}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {gridStatus === 'ready' && grid.cells.every((c) => !c.came) ? (
                <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {emptyMonthNote(month, { current: month === currentMonth })}
                </p>
              ) : null}

              {/* SAID RATHER THAN SILENTLY SHORT. The server pages this read and
                  this screen takes the first page, so a month holding more
                  visits than one page says so — a grid that simply left days
                  blank would be telling somebody they did not come. Reaching it
                  needs more than a hundred visits in ONE month, which the window
                  makes rare rather than impossible, and "rare" is not a reason to
                  print something false (:4355's own correction). */}
              {gridStatus === 'ready' && history.more ? (
                <p className="text-xs mt-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  This month has more visits than this view can show, so some days may be missing.
                </p>
              ) : null}
            </>
          )}
            </>
          ) : null}
        </div>
      ) : null}

      <DaySheet row={openRow} onClose={() => setOpenDay(null)} />
    </div>
  );
}
