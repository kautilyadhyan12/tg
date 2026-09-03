import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { orgService, errorText, isRetryable } from '../../api/orgsApi';
import { useConsoleOrg } from './useConsoleOrg';
import { ConsoleCard, ConsoleSection, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { addDays, closureDateLabel, gymToday } from './hoursView';
import {
  dayTotalsLine,
  emptyDayReason,
  isExceptionStatus,
  matchesName,
  personTimes,
  repeatVisitLabel,
  searchCoversEverybody,
} from './attendanceView';

// WHO CAME IN — the console's Attendance section.
//
// **IT IS A SECTION AND NOT A PANEL INSIDE SETTINGS, and that is Kd's ruling
// 17** (:28107): *"it should not be in settings but in a section call
// attandance a new option besides gym memebr settings etc"*. **The distinction
// settles later cards too: Settings is where a gym CONFIGURES itself, a section
// is where it WORKS** — which is why the manual-attendance SWITCH stays on
// Settings while this list lives out here. It is a screen an owner opens every
// morning.
//
// THE SHAPE IS RULING 14 AND IT IS A BUILD REQUIREMENT, NOT STYLING (:27992
// §3): the day's SHAPE first (one line per session), the EXCEPTIONS next as a
// filter, then PEOPLE one row each with their times as chips. A 400-tap day
// across 300 members is 300 rows, and *"this member attended twice"* is visible
// without opening anything.
//
// **EVERY COUNT ON THIS SCREEN IS THE SERVER'S.** Nothing here adds up the rows
// it downloaded — that is right on a fixture of six and reports the FIRST PAGE
// on a gym of four hundred, which is the specific breakage the ruling names.
// `attendanceView.js` carries the rule and the one place anything is summed
// (the exceptions count, over the server's whole-day summary, never over a
// page).
//
// **NOTHING POLLS, RE-READS ON FOCUS, OR RUNS ON A TIMER, AND THAT IS A SERVER
// CONSTRAINT** (:28649 L-5). This read and the history read below share ONE
// rate-limit bucket — 600/hour between them, one Redis key — so a loop here
// would spend the allowance that picking a member out of the list also draws
// from. The card's "no live-updating ticker" is therefore also a limit, and if
// this screen ever wants live-ish updates the limiter is what changes first.
//
// HIDING IS NOT THE ENFORCEMENT (R3.3, :11429 rule 4). The nav draws this tab
// only for somebody holding `attendance.read`, but the route 403s on its own and
// this screen prints the server's sentence if one arrives — exactly as
// `StaffPanel` does.

/** ONE PERSON'S ROW: their name, then their times as chips.
 *
 *  **ONE ROW PER PERSON, NEVER ONE PER TAP** — Kd's ruling 12 at the screen
 *  (:27992 §1), the same shape the member's own `My Gyms` list uses, so the two
 *  surfaces describe one day the same way.
 *
 *  A chip for an unusual arrival is marked with a WORD, never a colour: the
 *  visit is unusual, the member is not in trouble, and :26624 §4.4 exists
 *  precisely so nobody is refused for one. */
function PersonRow({ person, timezone, clockFormat, onPick, picked }) {
  const chips = personTimes(person, { timezone, clockFormat });
  return (
    <>
      <button
        type="button"
        onClick={() => onPick(person)}
        className="w-full text-left rounded-xl px-3 py-2.5 flex items-baseline gap-3 flex-wrap transition-colors"
        style={{ background: picked ? 'rgba(255,138,31,0.10)' : 'transparent' }}
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium truncate" style={{ color: '#fff' }}>
            {person.displayName}
          </span>
          {/* KD RULED THE EMAIL IN on 2026-09-03 — a knowing deviation from
              Part 3 §2.4, whose join-door disclosure changed in the same
              commit. Under the name rather than beside it: it is how a gym
              CONTACTS somebody, not how it recognises them, so it must not
              compete with the name on a four-hundred-row day. */}
          {/* NO LINE FOR AN ABSENT ADDRESS. The contract defaults `email` to an
              empty string so an api older than this bundle cannot kill the
              screen (:12660, and see the field's own note) — and an empty line
              here would be a blank row under every name on such a server. */}
          {person.email ? (
            <span className="block text-xs truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
              {person.email}
            </span>
          ) : null}
        </span>
        {/* KD, 2026-09-03: *"besides people say A visited 2 times"*. In WORDS,
            beside the name, and only when it is more than one — see
            `repeatVisitLabel`. The chips below still carry the times. */}
        {repeatVisitLabel(person) === '' ? null : (
          <span className="text-xs" style={{ color: '#FFB347' }}>
            {repeatVisitLabel(person)}
          </span>
        )}
        <span className="flex items-center gap-1.5 flex-wrap">
          {chips.map((chip, i) => (
            // KEYED BY THE INSTANT AND ITS POSITION. Two visits cannot share a
            // minute in one session (the UNIQUE sees to that), but two sessions
            // in one day can both start at a minute that formats the same on a
            // 12-hour clock — and a duplicate sibling key silently drops a fiber
            // (:20867, the guard in `test-setup.js`).
            <span
              key={`${person.userId}-${i}-${chip.markedAt}`}
              className="text-2xs px-1.5 py-0.5 rounded-md whitespace-nowrap"
              style={
                isExceptionStatus(chip.hoursStatus)
                  ? { background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.65)' }
                  : { background: 'rgba(255,138,31,0.12)', color: '#FFB347' }
              }
            >
              {chip.time}
              {isExceptionStatus(chip.hoursStatus) ? (
                <span className="ml-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {chip.hoursStatus === 'closed_day' ? '· closed day' : '· outside hours'}
                </span>
              ) : null}
            </span>
          ))}
        </span>
      </button>
    </>
  );
}

/** ONE MEMBER'S OWN HISTORY, opened by picking their name — *"how often do they
 *  actually come?"* answered without leaving the screen (:28055 §2).
 *
 *  It is the SAME route the member's own screen reads, with `?userId=` — a
 *  filter rather than a second endpoint (:14401's shape). **It spends the same
 *  600/hour bucket as the day list**, which is why it is opened by a deliberate
 *  press and never prefetched for every row. */
function PersonHistory({ gymId, person, onClose }) {
  const [state, setState] = useState({ status: 'loading', visits: [], timezone: null, clockFormat: '24h', more: false, error: null });

  // NO RESET AT THE TOP OF THIS EFFECT, and it is not needed: the call site
  // KEYS this component on the person, so picking a different name builds a new
  // one whose initial state is already `loading`. A synchronous `setState` here
  // would be a cascading render (`react-hooks/set-state-in-effect`) doing work
  // the key has already done.
  useEffect(() => {
    let cancelled = false;
    void orgService
      .getAttendanceHistory(gymId, { userId: person.userId })
      .then((res) => {
        if (cancelled) return;
        const answer = res.data?.attendance;
        setState({
          status: 'ready',
          visits: answer?.visits ?? [],
          timezone: answer?.timezone ?? null,
          clockFormat: answer?.clockFormat ?? '24h',
          more: (answer?.nextCursor ?? null) !== null,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState((held) => ({
          ...held,
          status: 'failed',
          error: errorText(err, "We couldn't load their visits just now."),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [gymId, person.userId]);

  // One row per DAY with the times inside it — the same rule as everywhere else
  // attendance is drawn, so a member who came twice reads the same on the
  // owner's screen, on their own screen, and in this drawer.
  const days = [];
  const byDay = new Map();
  for (const visit of state.visits) {
    const day = visit?.day;
    if (typeof day !== 'string' || day === '') continue;
    let row = byDay.get(day);
    if (row === undefined) {
      row = { day, label: closureDateLabel(day), times: [] };
      byDay.set(day, row);
      days.push(row);
    }
    const chips = personTimes({ visits: [visit] }, { timezone: state.timezone, clockFormat: state.clockFormat });
    if (chips.length === 1) row.times.push(chips[0]);
  }

  return (
    <div
      className="mt-3 rounded-xl p-3"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium" style={{ color: '#fff' }}>
          {person.displayName} — when they came
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg p-1"
          style={{ color: 'rgba(255,255,255,0.55)' }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {state.status === 'loading' ? (
        <p className="text-sm mt-2 flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading their visits…
        </p>
      ) : null}

      {/* A FAILED READ SAYS SO AND DRAWS NO LIST — never "they have never been
          here", which would be this screen telling an owner something false
          about a member because a request dropped (:8267/:8343). */}
      {state.status === 'failed' ? (
        <p className="text-sm mt-2" style={{ color: '#ef4444' }}>
          {state.error}
        </p>
      ) : null}

      {state.status === 'ready' ? (
        days.length === 0 ? (
          <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
            No visits recorded for them yet.
          </p>
        ) : (
          <>
            <ul className="mt-2 flex flex-col gap-1">
              {days.map((row) => (
                <li key={row.day} className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    {row.label}
                  </span>
                  {row.times.map((chip, i) => (
                    <span
                      key={`${row.day}-${i}-${chip.markedAt}`}
                      className="text-2xs px-1.5 py-0.5 rounded-md"
                      style={{ background: 'rgba(255,138,31,0.12)', color: '#FFB347' }}
                    >
                      {chip.time}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            {/* SAID RATHER THAN SILENTLY TRUNCATED — a list that simply stopped
                would read as "this is all of it". */}
            {state.more ? (
              <p className="text-xs mt-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Showing their most recent visits.
              </p>
            ) : null}
          </>
        )
      ) : null}
    </div>
  );
}

export default function ConsoleAttendance() {
  const { orgSlug } = useParams();
  const { loading, error, org, notFound, reload } = useConsoleOrg(orgSlug);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleLoading label="Loading your gym…" />
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleFailed message={error} onRetry={reload} />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleCard>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            We couldn&apos;t find that gym.
          </p>
        </ConsoleCard>
      </div>
    );
  }

  // KEYED ON THE GYM, and it is the whole of :20712's class fix rather than a
  // detail. `/console/:orgSlug/attendance` is ONE route, so moving between two
  // gyms changes the parameter WITHOUT remounting anything — and this screen
  // holds a day, a filter, accumulated pages and an open member. Without the
  // key, gym A's loaded people would sit under gym B's heading while B's read
  // was in flight, and the person drawer would read a member out of the gym the
  // owner had just left. Keying throws the whole screen away instead, which
  // covers every field anybody adds later without that author having to know
  // this was ever a problem. The prefix is round 4's requirement (:20867): a
  // bare id shared with a sibling makes React drop a fiber without scheduling
  // its deletion.
  return <AttendanceDay key={`attendance-${org.id}`} org={org} />;
}

function AttendanceDay({ org }) {
  const gymId = org.id;
  const timezone = org.timezone;

  // THE DAY STARTS AT THE GYM'S TODAY, NOT THE READER'S (trap #8). An owner in
  // one zone looking at a gym in another must open the gym's own day; `gymToday`
  // is the same reader the hours screens use.
  const [day, setDay] = useState(() => gymToday(timezone));
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(null);

  /** THE EXCEPTIONS FILTER WAS REMOVED BY KD ON 2026-09-03 and the parameter is
   *  kept as an explicit `undefined` rather than deleted from the read.
   *
   *  **The route still accepts `statuses` and still filters** — that is server
   *  behaviour this card did not touch, and the day it gets a second reader
   *  (Reports, or the phone) it must not have quietly rotted. What is gone is
   *  the CONTROL, which is what he pointed at: with the door now shut outside
   *  opening hours, the rows it filtered to can only be history. */
  const statusesParam = undefined;
  /** Bumped by Try again. It is part of the key below rather than a dependency
   *  of its own so that ONE mechanism does both jobs: a retry is a new question
   *  as far as this screen is concerned, so the held error stops being fresh,
   *  the spinner appears, and the effect re-runs — which is the console store's
   *  rule 1 (somebody waiting on purpose can see that they were heard). Keying
   *  the retry off the day or the filter alone cannot work: neither changes when
   *  a person presses Try again, so the effect would never run a second time. */
  const [attempt, setAttempt] = useState(0);
  /** WHAT THE ANSWER ON SCREEN IS AN ANSWER TO. A day, a filter and an attempt
   *  together are one question, and this names it. */
  const readKey = `${day}|${statusesParam ?? ''}|${attempt}`;

  // THE ANSWER IS STAMPED WITH THE QUESTION IT WAS FETCHED FOR — the console
  // store's own rule 3, applied to a day instead of a user.
  //
  // **This replaced a synchronous reset at the top of the effect below**, which
  // was a cascading render (`react-hooks/set-state-in-effect`) and, worse, two
  // sources of truth: the held people belonged to the OLD day for as long as the
  // new read was in flight, and only the reset's timing kept them off screen.
  // Stamping makes staleness a property of the data rather than of when a setter
  // happened to run, so a read that lands late cannot be drawn under the wrong
  // day's heading.
  //
  // PAGES ARE ACCUMULATED, THE SUMMARY IS NOT. `summary` and `totals` describe
  // the whole day and are identical on every page, so a Show more appends to
  // `people` and touches nothing else — which is what stops a count moving when
  // an owner pages.
  const [state, setState] = useState({
    status: 'loading',
    forKey: null,
    day: null,
    error: null,
    retryable: true,
    people: [],
    nextCursor: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);

  // ONE READ ON MOUNT, ONE WHEN THE DAY CHANGES, ONE WHEN THE FILTER CHANGES —
  // and nothing else. No focus listener, no interval: see the header.
  useEffect(() => {
    let cancelled = false;
    const params = statusesParam === undefined ? { day } : { day, statuses: statusesParam };
    void orgService
      .getAttendanceDay(gymId, params)
      .then((res) => {
        if (cancelled) return;
        const answer = res.data?.attendance;
        setState({
          status: 'ready',
          forKey: readKey,
          day: answer ?? null,
          error: null,
          retryable: true,
          people: answer?.people ?? [],
          nextCursor: answer?.nextCursor ?? null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: 'failed',
          forKey: readKey,
          day: null,
          error: errorText(err, "We couldn't load who came in."),
          // A REFUSAL IS NOT A RETRY (T3 round 1, L-2). The refusal this screen
          // meets is `attendance.read` having been unticked, and no amount of
          // pressing re-grants a privilege — `isRetryable` answers false on a
          // 403 and on the permanent 409s. The SENTENCE is still the server's
          // own and still true; what would be false is the button's implied
          // promise. Same predicate and same reasoning as the Overview's two
          // panes.
          retryable: isRetryable(err),
          people: [],
          nextCursor: null,
        });
      });
    return () => {
      cancelled = true;
    };
    // `readKey` IS THE IDENTITY OF THIS READ; `day` and `statusesParam` are
    // already inside it and neither can move without moving it. They are listed
    // because the effect READS them to build the request and
    // `react-hooks/exhaustive-deps` requires every value it reads — not because
    // either is load-bearing on its own (T3 round 1, L-4). Removing one would
    // change nothing about when this runs and would fail lint.
  }, [gymId, readKey, day, statusesParam]);

  // AN ANSWER TO A DIFFERENT QUESTION IS NOT AN ANSWER. Until the read for the
  // current day and filter lands, this screen is loading — it never draws the
  // previous day's people under today's heading.
  const fresh = state.forKey === readKey;
  const people = fresh ? state.people : [];
  const nextCursor = fresh ? state.nextCursor : null;

  /** SHOW MORE — a deliberate press, never an effect and never a scroll
   *  listener. Kd's ruling 14: *"paged, never infinite"*, and an effect that
   *  paged itself would also be a loop against a 600/hour bucket. */
  const showMore = useCallback(() => {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    const params =
      statusesParam === undefined
        ? { day, cursor: nextCursor }
        : { day, statuses: statusesParam, cursor: nextCursor };
    void orgService
      .getAttendanceDay(gymId, params)
      .then((res) => {
        const answer = res.data?.attendance;
        // APPENDED, and the SUMMARY IS NOT TOUCHED: this page's counts describe
        // the same whole day, so replacing them would be a no-op at best and a
        // flicker at worst. Only the people grow.
        //
        // **GUARDED ON THE STAMP.** A page that lands after the owner has moved
        // to another day belongs to the question they were asking BEFORE, and
        // appending it would put one day's people under another day's heading —
        // the same defect the stamp above exists to prevent, arriving by the
        // other door.
        setState((held) => {
          if (held.forKey !== readKey) return held;
          return {
            ...held,
            people: [...held.people, ...(answer?.people ?? [])],
            nextCursor: answer?.nextCursor ?? null,
          };
        });
      })
      .catch(() => {
        // A FAILED "SHOW MORE" LEAVES WHAT IS ON SCREEN ALONE. The rows already
        // drawn are true; blanking them over a follow-up read would report a
        // failure that did not happen to the data being shown. The cursor stays,
        // so pressing again retries.
      })
      .finally(() => {
        setLoadingMore(false);
      });
  }, [gymId, day, statusesParam, readKey, nextCursor, loadingMore]);

  const answer = fresh ? state.day : null;
  const clockFormat = answer?.clockFormat ?? org.clockFormat ?? '24h';
  const zone = answer?.timezone ?? timezone;
  const shown = people.filter((p) => matchesName(p, search));
  const everybodyLoaded = searchCoversEverybody(nextCursor);

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
          Attendance
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
          Who came in, by day. Times are your gym&apos;s own.
        </p>
      </div>

      {/* ── THE DAY, AND THE WAY BETWEEN DAYS ─────────────────────────────────
          The same control as "closed on a date" on the hours screen, down to
          the whole box opening the calendar — Kd, 2026-09-01: *"for date i have
          to hand type men"*. **NO `min` AND NO `max`**, which the hours card
          learned the hard way: an HTML `min` is a CONSTRAINT, not a hint, and a
          date outside it makes the field silently refuse with no event and no
          sentence. Attendance is a history, so the past is the normal
          direction.

          **THE CALENDAR IS ANNOUNCED RATHER THAN HIDDEN, AND THAT IS KD AT THE
          SCREEN (2026-09-02, the attendance smoke).** He ran the sheet, then
          said the arrows confused him and asked for them removed — and the real
          cause was the opposite of what it looked like: *"oh its there working i
          did not see that"*. **The calendar had been reachable all along, behind
          a bare box with no affordance**, so the two arrows beside it read as
          the only way to move and the middle control read as decoration.
          **Removing the arrows was put to him with its cost — "what about
          yesterday?" is an owner's commonest question and one click today — and
          he chose to make the box obvious instead** (*"make it obvious"*).
          So: a calendar ICON inside it, a pointer cursor, and the whole thing
          wrapped in a `<label>` so a click anywhere in it reaches the input and
          opens the picker.
          **STANDING, and it is why this is written here rather than in a commit
          message: a control nobody can SEE is indistinguishable from one that
          does not exist, and the first fix a person asks for will be aimed at
          whatever they CAN see.** The arrows were never the defect. */}
      <ConsoleCard>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setDay((d) => addDays(d, -1))}
            aria-label="Previous day"
            className="rounded-xl p-2"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.75)' }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {/* A LABEL, not a div: clicking the icon or the padding is forwarded
              to the input as a click, so the whole control opens the calendar
              rather than only the few pixels of the native indicator. */}
          <label
            className="rounded-xl px-3 py-2 flex items-center gap-2 cursor-pointer"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.10)',
            }}
          >
            <CalendarDays
              className="w-4 h-4 flex-shrink-0"
              style={{ color: '#FF8A1F' }}
              aria-hidden="true"
            />
            <input
              type="date"
              value={day}
              /* **AN EMPTY BOX IS REFUSED AT THE SOURCE, AND THAT IS THE WHOLE
                 FIX** (T3 round 1, C/H-2). A `type="date"` clears on Backspace
                 in Chrome and has an explicit ✕ in Firefox, so `''` is one
                 keystroke away — and every consumer of `day` breaks on it at
                 once: `addDays('', ±1)` answers `''` unchanged (`hoursView`
                 returns the input on an unparseable date), so BOTH arrows go
                 dead; the read sends `?day=` which
                 `attendanceDayQuerySchema`'s regex refuses, so the screen
                 prints the server's `day: invalid_string` — a schema field
                 name and a zod issue code, in front of the person this app is
                 written for (K1). Try again re-sends the same failing request
                 for ever, and the only way out is retyping into the box Kd had
                 just told us he could not see (:29410).
                 Keeping `day` a valid calendar string is what keeps the arrows,
                 the retry and the read all working, so the guard belongs here
                 rather than as four guards downstream. React restores the
                 previous value into a controlled input whose onChange declined
                 the new one, so the box shows the day it still holds.
                 **This is deliberately NOT `OpeningHoursPanel`'s shape**
                 (`closureDay === ''` guards at its two call sites): there an
                 empty box is a legitimate starting state for a form nobody has
                 filled in, and here `day` is seeded from `gymToday` and must
                 never be empty at all. */
              onChange={(e) => {
                if (e.target.value !== '') setDay(e.target.value);
              }}
              aria-label="Day"
              onClick={(e) => {
                try {
                  e.currentTarget.showPicker();
                } catch {
                  /* older browser, or not user-activated — typing still works */
                }
              }}
              className="bg-transparent border-0 p-0 text-sm outline-none cursor-pointer"
              style={{ color: '#fff', colorScheme: 'dark' }}
            />
          </label>
          <button
            type="button"
            onClick={() => setDay((d) => addDays(d, 1))}
            aria-label="Next day"
            className="rounded-xl p-2"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.75)' }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="text-sm ml-1" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {closureDateLabel(day)}
          </span>
        </div>
      </ConsoleCard>

      {/* THE THREE ARMS ALL ASK `fresh` FIRST. A held answer that belongs to
          the previous day or the previous filter is not an answer to what is on
          screen now, so it is drawn as loading rather than as itself. */}
      {!fresh || state.status === 'loading' ? (
        <ConsoleLoading label="Loading who came in…" />
      ) : null}

      {/* THE SERVER'S OWN SENTENCE WHERE IT HAS ONE — a refusal here is
          `attendance.read` having been unticked, and inventing a friendlier
          reason would be guessing at which. */}
      {fresh && state.status === 'failed' ? (
        <ConsoleFailed
          message={state.error}
          onRetry={state.retryable ? () => setAttempt((a) => a + 1) : undefined}
        />
      ) : null}

      {fresh && state.status === 'ready' && answer !== null ? (
        <>
          {/* ── THE SHAPE OF THE DAY, BEFORE ANY NAMES ────────────────────────
              Ruling 14's first requirement and the thing that stops the pile-up:
              a gym with three sessions reads its whole day in three lines.
              EVERY NUMBER HERE IS THE SERVER'S, counted over the whole day in
              SQL — never over the page below, which is the specific breakage
              the ruling names. */}
          {/* ── THE PEOPLE, ONE ROW EACH ─────────────────────────────────────
              KD, 2026-09-03: *"remove these things not needed and doing nothing:
              The day, 2 visits outside opening hours … Show only these, add the
              drop down in Who came"*. **So this screen is now ONE section**, and
              the dropdown he asked for is on it.

              ~~**IT IS `forceOpen`, WHICH MEANS OPEN AND STILL FOLDABLE.**~~
              **FALSE, AND KD FOUND IT BY CLICKING** (*"the drop down is not
              working i clcik here bu it does not open close"*). `forceOpen`
              PINS a section open — `isOpen` is `open || forceOpen`, so the tap
              flipped `open` and the `||` put it straight back. It exists for
              the anti-silence rule and is the wrong tool for "start open".
              **`defaultOpen` seeds the state instead**, so this arrives open
              and the heading toggles like any other. */}
          <ConsoleSection title="Who came" aside={dayTotalsLine(answer.totals)} defaultOpen>
            <div className="flex items-center justify-end gap-3 flex-wrap">
              <label className="flex items-center gap-2 rounded-xl px-3 py-1.5"
                style={{ background: 'rgba(255,255,255,0.05)' }}>
                <Search className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.45)' }} />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name"
                  aria-label="Search by name"
                  className="bg-transparent text-sm outline-none"
                  style={{ color: '#fff' }}
                />
              </label>
            </div>

            {people.length === 0 ? (
              /* THE THREE EMPTY CASES ARE THREE DIFFERENT SENTENCES, and only
                 one of them is a problem (:8267/:8343). A FAILED read never
                 reaches here — it is drawn above. */
              <EmptyDay
                reason={emptyDayReason({
                  manualAttendanceEnabled: org.manualAttendanceEnabled,
                  totals: answer.totals,
                  // THE EXCEPTIONS FILTER IS GONE (Kd, 2026-09-03), so no list
                  // on this screen can be emptied by one. The parameter stays in
                  // `emptyDayReason` because the reason it exists — two of these
                  // can be true at once and the ORDER decides which sentence an
                  // owner reads — is the finding, not the filter.
                  filtered: false,
                })}
              />
            ) : (
              <>
                <ul className="mt-1 flex flex-col">
                  {shown.map((person) => (
                    <li key={person.userId}>
                      <PersonRow
                        person={person}
                        timezone={zone}
                        clockFormat={clockFormat}
                        picked={picked?.userId === person.userId}
                        onPick={(p) =>
                          setPicked((held) => (held?.userId === p.userId ? null : p))
                        }
                      />
                      {/* THE HISTORY OPENS UNDER THE PERSON IT IS ABOUT, and it
                          is KEYED on them so switching from one member to
                          another rebuilds it rather than showing the previous
                          member's visits under the new name while the read is in
                          flight — the sibling of the screen-level key above. */}
                      {picked?.userId === person.userId ? (
                        <PersonHistory
                          key={`history-${person.userId}`}
                          gymId={gymId}
                          person={person}
                          onClose={() => setPicked(null)}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>

                {/* A SEARCH THAT FOUND NOBODY SAYS WHAT IT ACTUALLY SEARCHED.
                    The server has no name filter, so this covers the people
                    LOADED — and a "nobody by that name" for a member sitting on
                    page three would be the same lie as counting a page and
                    calling it the day. The Show more button is right below. */}
                {shown.length === 0 ? (
                  <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    {everybodyLoaded
                      ? 'Nobody by that name came in on this day.'
                      : 'Nobody by that name in the people loaded so far — load the rest to search them too.'}
                  </p>
                ) : null}

                {/* PAGED, NEVER INFINITE-SCROLLED (ruling 14). A deliberate
                    press: a scroll listener that paged itself would also be a
                    loop against a shared 600/hour bucket. */}
                {nextCursor !== null ? (
                  <button
                    type="button"
                    onClick={showMore}
                    disabled={loadingMore}
                    className="mt-3 rounded-xl px-3.5 py-2 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-40"
                    style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)' }}
                  >
                    {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Show more people
                  </button>
                ) : null}
              </>
            )}
          </ConsoleSection>
        </>
      ) : null}
    </div>
  );
}

/** THE EMPTY DAY, IN THREE SENTENCES. They look identical in the data and only
 *  one of them is a problem — the class this project has shipped once. */
function EmptyDay({ reason }) {
  if (reason === 'switch-off') {
    return (
      <div className="mt-2">
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
          Nobody can mark themselves in — the button is switched off for your gym.
        </p>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.55)' }}>
          Turn it back on in Settings, under &ldquo;Marking attendance&rdquo;.
        </p>
      </div>
    );
  }
  if (reason === 'filtered') {
    return (
      <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
        Nobody arrived outside opening hours on this day.
      </p>
    );
  }
  return (
    <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
      Nobody has marked themselves in on this day yet.
    </p>
  );
}
