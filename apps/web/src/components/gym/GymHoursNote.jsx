import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { orgService } from '../../api/orgsApi';
import {
  WEEKDAYS,
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

export default function GymHoursNote({ gymId }) {
  const [hours, setHours] = useState(null);

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
            noise. */}
        {hours.mode === 'scheduled' ? (
          <ul className="mt-1 flex flex-col gap-0.5">
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
                <span>{dayLine(hours.week?.find((d) => d.weekday === weekday.iso)?.sessions, clockFormat)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {/* UPCOMING CLOSURES, so a member sees the holiday before they walk to
            it. Today's is already the headline above and is not repeated. */}
        {(hours.closures ?? []).filter((c) => c.day !== today).length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {(hours.closures ?? [])
              .filter((c) => c.day !== today)
              .map((closure) => (
                <li key={closure.day} className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  Closed {closure.day}
                  {closure.note !== null && closure.note !== '' ? ` — ${closure.note}` : ''}
                </li>
              ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
