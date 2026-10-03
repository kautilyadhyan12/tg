import { useEffect, useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flame,
  QrCode,
  X,
} from 'lucide-react';
import { orgService } from '../../api/orgsApi';
import { gymToday } from '../../pages/console/hoursView';
import CheckinPass from './CheckinPass';
import {
  emptyMonthNote,
  monthGrid,
  monthKeyOfDay,
  monthWindow,
  shiftMonthKey,
} from './attendanceView';

// CHECKING IN, AND THE DAYS A MEMBER CAME — one gym's card on My Gyms.
//
// A visit is made at the front desk (RULINGS 2026-09-21; spec Part 3 §12): the member
// shows their pass, and the desk reads it. So this card has a "Show my pass" button where
// the "I'm here" tap was (ROADMAP 16c); the tap's route answers 410. The pass is the
// PERSON's, not this gym's (RULINGS 2026-09-23), so every card opens the same one.
//
// Under it, the member's own calendar of the days they came (Kd, 2026-09-03), whatever
// made each visit: the old tap, a pass, a key tag or staff.
//
// THIS PANEL MUST BE MOUNTED ONE PER GYM, KEYED BY THE GYM'S ID. Nothing in here resets
// when `gym` changes; `MyGyms.jsx` keys the card on `gym.id`, so React throws this away
// rather than handing gym B a panel holding gym A's visits.
//
// THE HISTORY IS READ ONCE PER MONTH VIEWED, and once more when the pass is closed.
// Nothing polls or re-reads on focus: the history read and the console's day list share
// one rate-limit bucket (`orgs_attendance_read`, 600 an hour). The half-minute `tick`
// re-reads the browser's clock, not the server.

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
  const [passOpen, setPassOpen] = useState(false);
  // THE ANSWER IS STAMPED WITH THE MONTH IT WAS FETCHED FOR, so a read that lands late is
  // never drawn under another month's heading. `status` is named rather than inferred
  // from an empty list: "no visits" and "we could not ask" must not look the same.
  const [history, setHistory] = useState({
    status: 'loading',
    forMonth: null,
    visits: [],
    timezone: null,
    clockFormat: '24h',
    more: false,
  });
  // The month the member has stepped to, or null meaning the gym's own month now.
  const [monthStep, setMonthStep] = useState(null);
  // Folded away until somebody asks for it (Kd, 2026-09-03).
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Whether it has EVER been opened: the read waits for this, so a member who never opens
  // the calendar asks nothing, and folding it away and back does not ask again.
  const [everOpened, setEverOpened] = useState(false);
  // The day whose times are open, or null. The date and not the row, so a month re-read
  // cannot leave a stale row on screen.
  const [openDay, setOpenDay] = useState(null);
  // Bumped when the pass is closed: a scan at the desk while it was open made a visit
  // this screen was not told about, so the month on screen is read once more.
  const [reads, setReads] = useState(0);
  // The gym's hours, read for its time zone: the calendar's month and "today" are the
  // gym's, not the reader's. Null until read, and after a failed read.
  const [hours, setHours] = useState(null);
  // Whether that read has finished, whichever way it went: a failed read must still
  // produce a calendar.
  const [hoursDone, setHoursDone] = useState(false);
  // The browser's clock, so a member sitting here past the gym's midnight is not left a
  // day or a month behind.
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
        // Silent: `GymHoursNote` above draws the hours and their failure. The flag is
        // still set, or the calendar would wait for ever on a read that is not coming.
        if (!cancelled) setHoursDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [gymId]);

  // The month the gym is in and the month on screen, both derived. A zone that cannot be
  // read falls back to the reader's: it decides only which month the grid OPENS on, and
  // the reader can step.
  const gymZone =
    typeof hours?.timezone === 'string' && hours.timezone !== '' ? hours.timezone : null;
  const currentMonth = hoursDone
    ? monthKeyOfDay(gymZone === null ? gymToday(undefined, tick) : gymToday(gymZone, tick))
    : null;
  const month = monthStep ?? currentMonth;

  useEffect(() => {
    if (gymId === null || month === null || !everOpened) return undefined;
    // Not `window`: that would shadow the browser global for the rest of this effect.
    const range = monthWindow(month);
    if (range === null) return undefined;
    let cancelled = false;
    void orgService
      .getAttendanceHistory(gymId, range)
      .then((res) => {
        if (cancelled) return;
        const answer = res.data?.attendance;
        setHistory({
          status: 'ready',
          // The month ASKED for, never whatever `month` is by the time this lands.
          forMonth: month,
          visits: answer?.visits ?? [],
          timezone: answer?.timezone ?? null,
          clockFormat: answer?.clockFormat ?? '24h',
          more: (answer?.nextCursor ?? null) !== null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        // Stamped like the success, so a failure on one month cannot mark another failed.
        setHistory((held) => ({ ...held, status: 'failed', forMonth: month }));
      });
    return () => {
      cancelled = true;
    };
  }, [gymId, month, everOpened, reads]);

  // An answer to a different month is not an answer: until the read for the month on
  // screen lands, the grid is loading and draws no visits.
  const fresh = history.forMonth === month && month !== null;
  const gridStatus = fresh ? history.status : 'loading';
  const grid =
    month === null
      ? null
      : monthGrid(month, fresh ? history.visits : [], {
          timezone: history.timezone,
          clockFormat: history.clockFormat,
          // The GYM's today, so a day is greyed as future by the gym's calendar. Null
          // with no zone: nothing is greyed.
          today: gymZone === null ? null : gymToday(gymZone, tick),
        });
  const openRow = grid?.cells.find((c) => c.date === openDay && c.came) ?? null;

  /** Move a month, and close whatever day was open: without the clear, a member who
   *  opens the 2nd, steps away and steps back finds the sheet open again, untapped. */
  const stepMonth = (delta) => {
    setOpenDay(null);
    setMonthStep(shiftMonthKey(month, delta));
  };

  return (
    <div className="mt-3">
      <p className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
        Check in
      </p>
      <p className="text-sm mt-0.5 mb-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
        {gym?.orgType === 'personal_trainer'
          ? 'Show your pass to your trainer when you arrive.'
          : 'Show your pass at the front desk when you arrive.'}
      </p>
      <button
        type="button"
        onClick={() => {
          setPassOpen(true);
        }}
        className="rounded-xl px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-2"
        style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
      >
        <QrCode className="w-4 h-4" aria-hidden="true" />
        Show my pass
      </button>
      {passOpen ? (
        <CheckinPass
          onClose={() => {
            setPassOpen(false);
            setReads((n) => n + 1);
          }}
        />
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
                    // THE LABEL IS HOW A MARKED DAY IS ADDRESSED — by anybody
                    // not looking at pixels, and by every test in this file.
                    // The flame is `aria-hidden`, so this sentence is the ONLY
                    // thing that says the day was marked.
                    //
                    // It used to say the fire sat BESIDE the number and that a
                    // fire drawn over it "would take the date away". Kd reversed
                    // that at his own browser on 2026-09-03 (:32395 §3) — the
                    // flame FILLS the square now and the date sits INSIDE it in
                    // white — and the comment outlived the design it described,
                    // which is :31295's defect in prose rather than in a prop.
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
