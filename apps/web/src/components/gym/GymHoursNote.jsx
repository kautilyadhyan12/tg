import { useEffect, useState } from 'react';
import { CalendarClock, ChevronDown } from 'lucide-react';
import { orgService } from '../../api/orgsApi';
import {
  WEEKDAYS,
  closureDateLabel,
  dayLine,
  gymToday,
  isoWeekdayOfDay,
} from '../../pages/console/hoursView';

// WHEN YOUR GYM IS OPEN, on the member's own card — Kd ruled it in the same
// breath as the feature (:26684 §2, *"yes can see"*), so it ships with the
// console half rather than after it.
//
// **IT DRAWS ABSOLUTELY NOTHING UNTIL THE GYM HAS ANSWERED, and that is the one
// thing to check first.** A gym that never filled the section in has no session
// rows — byte-identical, from the rows alone, to a gym that is genuinely shut
// every day. Printing "Closed" for the first is a member shown something FALSE
// about their own gym (:5807), and on the day this ships it would be every gym
// in the database. So the MODE decides, before a word is drawn, and `unset`
// renders null.
//
// IT ALSO DRAWS NOTHING ON A FAILED READ, and here that is right where almost
// everywhere else in this project it would be the defect. The card this sits in
// is ADDITIVE — it exists to add a true sentence — so silence claims nothing at
// all, whereas a red strip on the screen somebody opens to start a workout is
// noise about a background request. `GymMembershipCard` above it makes the same
// call for the same reason.
//
// EVERY DATE HERE IS THE GYM'S, NEVER THE PHONE'S (trap #8). A member in Assam
// looking at a gym in Texas must be told the gym's today, and `gymToday` is the
// only thing that decides which weekday this is.
//
// **AND THE WEEK IS FOLDED AWAY — Kd, at his own browser, 2026-09-03:** *"should
// have a drop down type of effect whenver click or hover in them"*, on a
// screenshot where this card was seven rows tall before the attendance section
// even started. **ON TAP AND NOT ON HOVER, and that is a ruling rather than a
// taste**: hover does not exist on a phone and :26586 is his own *"members are
// not going to use the web"*, so the phone is where this actually gets read.
// `Today: 7:40 AM – 9:40 AM` stays on screen in both states — the closed row
// still answers the question somebody opened the card with (:20338).

export default function GymHoursNote({ gymId }) {
  const [hours, setHours] = useState(null);
  // **PLAIN `useState`, SEEDED CLOSED, AND THE HEADER ROW IS ITS ONLY WRITER.**
  // :31295 is a dropdown Kd found dead at his browser — `isOpen = open ||
  // forceOpen`, so pinning it made the tap flip a flag the `||` overrode, and
  // both of its comments claimed it worked. Nothing here forces this open and
  // nothing needs to: `forceOpen` is the anti-silence rule (a section holding an
  // error somebody must see), and the one thing a member must see — today — is
  // the headline above the fold, which never moves.
  //
  // The closing direction is driven by a TEST rather than described here, for
  // the same reason (:31295 §3: for a two-state control, the assertion is the
  // state it is NOT in when you find it).
  const [weekOpen, setWeekOpen] = useState(false);

  useEffect(() => {
    if (gymId === undefined || gymId === null) return undefined;
    let cancelled = false;
    void orgService
      .getHours(gymId)
      .then((res) => {
        if (cancelled) return;
        setHours(res.data?.hours ?? null);
      })
      .catch(() => {
        // Deliberately silent — see the header. The card is additive.
      });
    return () => {
      cancelled = true;
    };
  }, [gymId]);

  // THE MODE GATE, and it is the first statement for a reason. Everything below
  // assumes the gym has answered; nothing below is allowed to run for a gym that
  // has not.
  if (hours === null) return null;
  if (hours.mode !== 'open_24h' && hours.mode !== 'scheduled') return null;

  const today = gymToday(hours.timezone);
  const todayIso = isoWeekdayOfDay(today);
  const closedToday = (hours.closures ?? []).find((c) => c.day === today) ?? null;
  // THE GYM'S OWN CLOCK, not this reader's browser — Kd's 2026-09-01 ruling.
  // One gym, one clock: the owner's console and every member's card show the
  // same Monday the same way, which is the point of the setting being on the
  // GYM row rather than in a browser.
  const clockFormat = hours.clockFormat ?? '24h';

  return (
    <div className="mt-2 flex items-start gap-2">
      <CalendarClock
        className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
        style={{ color: 'rgba(255,255,255,0.35)' }}
      />
      <div className="min-w-0">
        {/* THE DATED CLOSURE WINS OVER THE PATTERN — Kd's two mechanisms, in the
            order he ruled them (:26684 §3). "Closed every Sunday" is the weekly
            pattern below; "closed on the 25th" is this, and on that date it is
            the only thing that matters. The reason is shown when the gym gave
            one, because a member told "closed" with no explanation is the worse
            product — and that note is NOT the struck session name returning: it
            sits on the exception, where the explanation is the point. */}
        {closedToday !== null ? (
          <p className="text-sm font-medium" style={{ color: '#fff' }}>
            Closed today
            {closedToday.note !== null && closedToday.note !== '' ? (
              <span style={{ color: 'rgba(255,255,255,0.55)' }}> — {closedToday.note}</span>
            ) : null}
          </p>
        ) : hours.mode === 'open_24h' ? (
          <p className="text-sm font-medium" style={{ color: '#fff' }}>
            Open 24 hours
          </p>
        ) : (
          <p className="text-sm font-medium" style={{ color: '#fff' }}>
            Today: {dayLine(hours.week?.find((d) => d.weekday === todayIso)?.sessions, clockFormat)}
          </p>
        )}

        {/* THE REST OF THE WEEK, and only when there IS a week — a 24-hour gym
            has nothing to list, and listing seven identical rows for it would be
            noise.

            **TODAY'S ROW OBEYS THE CLOSURE TOO, and that is T3 round 1's second
            Critical/High.** The headline branched on `closedToday` and this list
            did not, so a member read "Closed today — Holi" and, three lines
            under it, today's own row still printing the ordinary pattern —
            06:00 – 07:00, in the brighter colour this list uses to mark today.
            The one row a member's eye is steered to was the one asserting the
            gym is open on a day it had declared shut (:5807), and it is exactly
            the conflation :26684 §3 rules against: the dated closure WINS over
            the weekly pattern, in every place the pattern is drawn and not only
            in the first one.

            **IT SAYS "Closed today", NOT "Closed", AND THE EXTRA WORD IS THE
            WHOLE POINT** — T3 round 2's L-5. This list IS the weekly pattern, so
            a bare "Closed" on the Wednesday row is read as *closed every
            Wednesday* by a member who is looking at a list of weekdays. The word
            names WHICH of Kd's two mechanisms shut the day: the dated override,
            today only, gone tomorrow. It is a calendar-day comparison in the
            GYM's zone on both sides (`todayIso` from `gymToday`, `closedToday`
            matched on the gym's own date), which is what :13432's rule requires
            of any sentence containing "today". */}
        {hours.mode === 'scheduled' ? (
          <>
            {/* THE WHOLE ROW IS THE CONTROL, not a small chevron beside a label:
                on a phone a 44px row is a target and a 14px arrow is not
                (:26586, and :32395 §2 is where the same call was made for the
                calendar one card ago). It carries no second icon — this block
                already has its `CalendarClock`, and two marks competing for one
                job is what made Kd's fire unreadable (:32395 §3).

                IT SAYS WHICH WAY IT WILL GO. `aria-expanded` is the state and
                the chevron follows it, so a screen reader and an eye get the
                same answer.

                CLOSED MEANS UNMOUNTED, NOT HIDDEN WITH CSS. A `display:none`
                body would leave every assertion in this file's suite passing
                against rows no person can see — the class :20338 refused when
                the console's own sections learned to fold. */}
            <button
              type="button"
              onClick={() => {
                setWeekOpen((open) => !open);
              }}
              aria-expanded={weekOpen}
              className="mt-1 w-full flex items-center gap-2 text-left"
              style={{ minHeight: '44px' }}
            >
              <span
                className="text-xs uppercase tracking-wider"
                style={{ color: 'rgba(255,255,255,0.45)' }}
              >
                This week
              </span>
              <ChevronDown
                className="w-3.5 h-3.5 flex-shrink-0"
                style={{
                  color: 'rgba(255,255,255,0.45)',
                  transform: weekOpen ? 'rotate(180deg)' : 'none',
                }}
                aria-hidden="true"
              />
            </button>

            {weekOpen ? (
              <ul className="flex flex-col gap-0.5">
                {WEEKDAYS.map((weekday) => (
                  <li
                    key={weekday.iso}
                    className="text-xs flex gap-2"
                    style={{
                      color:
                        weekday.iso === todayIso
                          ? 'rgba(255,255,255,0.75)'
                          : 'rgba(255,255,255,0.45)',
                    }}
                  >
                    <span className="w-8 flex-shrink-0">{weekday.short}</span>
                    <span>
                      {weekday.iso === todayIso && closedToday !== null
                        ? 'Closed today'
                        : dayLine(
                            hours.week?.find((d) => d.weekday === weekday.iso)?.sessions,
                            clockFormat,
                          )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        {/* UPCOMING CLOSURES, so a member sees the holiday before they walk to
            it. Today's is already the headline above and is not repeated. */}
        {(hours.closures ?? []).filter((c) => c.day !== today).length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {(hours.closures ?? [])
              .filter((c) => c.day !== today)
              .map((closure) => (
                <li key={closure.day} className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  Closed {closureDateLabel(closure.day)}
                  {closure.note !== null && closure.note !== '' ? ` — ${closure.note}` : ''}
                </li>
              ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
