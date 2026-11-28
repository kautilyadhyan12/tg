import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { orgWords } from '@app/shared';
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { orgService, errorText, isRetryable } from '../../api/orgsApi';
import { useConsoleOrg } from './useConsoleOrg';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
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
import { consoleIsReadOnly } from './billingView';
import { viewerPrivileges } from './consoleView';
import { canCheckPeopleIn, personKey } from './checkinLogView';
import { CheckedInToday, CheckSomeoneIn, FoldBox } from './AttendanceCheckIn';
import { useLiveNews } from './liveNews';

/** Check-in history reads again on live news at most this often. */
const DAY_READ_GAP_MS = 15_000;
/** While the live line cannot open, Check-in history checks for itself this often. */
const WITHOUT_LINE_MS = 30_000;

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
// this screen prints the server's sentence if one arrives.

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
      <button type="button" onClick={() => onPick(person)} aria-expanded={picked} className="c-attend-who">
        <span className="grow">
          <span className="c-s15 c-w6 c-t1 break-words">{person.displayName}</span>
          {/* KD RULED THE EMAIL IN on 2026-09-03 — a knowing deviation from
              Part 3 §2.4, whose join-door disclosure changed in the same
              commit. Under the name rather than beside it: it is how a gym
              CONTACTS somebody, not how it recognises them, so it must not
              compete with the name on a four-hundred-row day. */}
          {/* NO LINE FOR AN ABSENT ADDRESS. The contract defaults `email` to an
              empty string so an api older than this bundle cannot kill the
              screen (:12660, and see the field's own note) — and an empty line
              here would be a blank row under every name on such a server. */}
          {person.email ? <span className="c-s14 c-t2 break-words">{person.email}</span> : null}
        </span>
        {/* KD, 2026-09-03: *"besides people say A visited 2 times"*. In WORDS,
            beside the name, and only when it is more than one — see
            `repeatVisitLabel`. The chips below still carry the times. */}
        {repeatVisitLabel(person) === '' ? null : <span className="c-s14 c-t2">{repeatVisitLabel(person)}</span>}
        <span className="c-attend-times">
          {chips.map((chip, i) => (
            // KEYED BY THE INSTANT AND ITS POSITION. Two visits cannot share a
            // minute in one session (the UNIQUE sees to that), but two sessions
            // in one day can both start at a minute that formats the same on a
            // 12-hour clock — and a duplicate sibling key silently drops a fiber
            // (:20867, the guard in `test-setup.js`).
            <span
              key={`${personKey(person)}-${i}-${chip.markedAt}`}
              className={`c-tag ${isExceptionStatus(chip.hoursStatus) ? 'c-tag-plain' : 'c-tag-soft'}`}
            >
              {chip.time}
              {isExceptionStatus(chip.hoursStatus) ? (chip.hoursStatus === 'closed_day' ? ' · closed day' : ' · outside hours') : null}
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
      .getAttendanceHistory(gymId, person.userId === null ? { entryId: person.entryId } : { userId: person.userId })
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
  }, [gymId, person.userId, person.entryId]);

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
  // Newest day first: a visit staff added later arrives in the order it was added.
  days.sort((a, b) => (a.day === b.day ? 0 : a.day < b.day ? 1 : -1));

  return (
    <div className="c-inbox c-attend-hist flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <p className="c-s15 c-w6 c-t1 min-w-0 break-words">{person.displayName} — when they came</p>
        <button type="button" onClick={onClose} aria-label="Close" className="c-icon-btn flex-shrink-0">
          <X aria-hidden="true" className="w-4 h-4" />
        </button>
      </div>

      {state.status === 'loading' ? (
        <p className="c-s14 c-t2 flex items-center gap-2">
          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
          Loading their visits…
        </p>
      ) : null}

      {/* A FAILED READ SAYS SO AND DRAWS NO LIST — never "they have never been
          here", which would be this screen telling an owner something false
          about a member because a request dropped (:8267/:8343). */}
      {state.status === 'failed' ? (
        <p className="c-s14 c-w6" role="alert" style={{ color: 'var(--bad)' }}>
          {state.error}
        </p>
      ) : null}

      {state.status === 'ready' ? (
        days.length === 0 ? (
          <p className="c-s14 c-t2">No visits recorded for them yet.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {days.map((row) => (
                <li key={row.day} className="c-attend-hist-day">
                  <span className="c-s14 c-t2">{row.label}</span>
                  {row.times.map((chip, i) => (
                    <span
                      key={`${row.day}-${i}-${chip.markedAt}`}
                      className={`c-tag ${isExceptionStatus(chip.hoursStatus) ? 'c-tag-plain' : 'c-tag-soft'}`}
                    >
                      {chip.time}
                      {isExceptionStatus(chip.hoursStatus) ? (chip.hoursStatus === 'closed_day' ? ' · closed day' : ' · outside hours') : null}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            {/* SAID RATHER THAN SILENTLY TRUNCATED — a list that simply stopped
                would read as "this is all of it". */}
            {state.more ? <p className="c-s14 c-t2">Showing their most recent visits.</p> : null}
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
      <div className="c-page">
        <ConsoleLoading label="Loading your organisation…" newLook />
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="c-page">
        <ConsoleFailed message={error} onRetry={reload} newLook />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="c-page">
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">We couldn&apos;t find that organisation.</p>
        </section>
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
  // The words this screen speaks (roadmap 2b).
  const words = orgWords(org.orgType);

  // THE DAY STARTS AT THE GYM'S TODAY, NOT THE READER'S (trap #8). An owner in
  // one zone looking at a gym in another must open the gym's own day; `gymToday`
  // is the same reader the hours screens use.
  const [day, setDay] = useState(() => gymToday(timezone));
  const mayCheckIn = canCheckPeopleIn(viewerPrivileges(org));
  const [checkedIn, setCheckedIn] = useState(0);
  /** Counts visits removed from Today's check-ins, so the last check-in's answer is cleared. */
  const [removed, setRemoved] = useState(0);
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
  /** Live updates (Stage 4 item 18): a visit added or removed anywhere, at the desk or by staff in
   *  another window, reads the day on screen again, QUIETLY: the same question, so its people stay
   *  on screen until the answer lands, and Check-in history never disagrees with Today's check-ins.
   *  At most once every 15 seconds: this read and a person's history share one allowance of 600
   *  an hour, so a busy desk never uses up the history. News after a quiet spell reads at once. */
  const [heard, setHeard] = useState(0);
  const lastHeard = useRef(0);
  const heardSoon = useRef(null);
  /** Whether the live line could not open: Check-in history then checks for itself until it is back. */
  const [withoutLine, setWithoutLine] = useState(false);
  /** One read again, at once after a quiet spell, else when the 15 seconds are up. */
  const readAgain = useCallback(() => {
    if (heardSoon.current !== null) return;
    heardSoon.current = setTimeout(
      () => {
        heardSoon.current = null;
        lastHeard.current = Date.now();
        setHeard((n) => n + 1);
      },
      Math.max(0, lastHeard.current + DAY_READ_GAP_MS - Date.now()),
    );
  }, []);
  useLiveNews(gymId, (message) => {
    if (message.what === 'refused') setWithoutLine(true);
    if (message.what === 'ready') setWithoutLine(false);
    if (message.what === 'visits' || message.what === 'people' || message.what === 'ready' || message.what === 'cameBack') readAgain();
  });
  useEffect(() => () => clearTimeout(heardSoon.current), []);
  useEffect(() => {
    if (!withoutLine) return undefined;
    const timer = setInterval(readAgain, WITHOUT_LINE_MS);
    return () => clearInterval(timer);
  }, [withoutLine, readAgain]);

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
  /** How many pages of this day are on screen: a read again on news reads as many, so a list that
   *  was paged with Show more is not folded back to its first page. */
  const pagesShown = useRef({ forKey: null, pages: 1 });
  /** Counts the day's reads that landed: a Show more asked before one of them is dropped, since it
   *  continues a list that has been read again. */
  const landed = useRef(0);

  // ONE READ ON MOUNT, ONE WHEN THE DAY CHANGES, ONE WHEN THE FILTER CHANGES,
  // and one when the server says a visit changed. No focus listener, no interval.
  useEffect(() => {
    let cancelled = false;
    const params = statusesParam === undefined ? { day } : { day, statuses: statusesParam };
    const pages = pagesShown.current.forKey === readKey ? pagesShown.current.pages : 1;
    const readPages = async () => {
      const first = await orgService.getAttendanceDay(gymId, params);
      const answer = first.data?.attendance;
      let people = answer?.people ?? [];
      let nextCursor = answer?.nextCursor ?? null;
      for (let page = 1; page < pages && nextCursor !== null && !cancelled; page += 1) {
        const more = await orgService.getAttendanceDay(gymId, { ...params, cursor: nextCursor });
        people = [...people, ...(more.data?.attendance?.people ?? [])];
        nextCursor = more.data?.attendance?.nextCursor ?? null;
      }
      return { answer, people, nextCursor };
    };
    void readPages()
      .then(({ answer, people, nextCursor }) => {
        if (cancelled) return;
        landed.current += 1;
        pagesShown.current = { forKey: readKey, pages };
        setState({
          status: 'ready',
          forKey: readKey,
          day: answer ?? null,
          error: null,
          retryable: true,
          people,
          nextCursor,
          stale: false,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        // A quiet read again that fails leaves the same day's people on screen, and says it could
        // not refresh; it is tried again shortly.
        setState((held) => (held.forKey === readKey && held.status === 'ready' ? { ...held, stale: true } : {
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
        }));
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
  }, [gymId, readKey, day, statusesParam, heard]);

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
    const after = landed.current;
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
        if (landed.current !== after) return;
        const shownBefore = pagesShown.current.forKey === readKey ? pagesShown.current.pages : 1;
        pagesShown.current = { forKey: readKey, pages: shownBefore + 1 };
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
  /** A quiet read again failed: the people shown are the last that could be read. */
  const staleDay = fresh && state.stale === true;
  useEffect(() => {
    if (!staleDay) return undefined;
    const timer = setTimeout(readAgain, DAY_READ_GAP_MS);
    return () => clearTimeout(timer);
  }, [staleDay, state, readAgain]);
  const clockFormat = answer?.clockFormat ?? org.clockFormat ?? '24h';
  const zone = answer?.timezone ?? timezone;
  const shown = people.filter((p) => matchesName(p, search));
  const everybodyLoaded = searchCoversEverybody(nextCursor);

  const checkIn = mayCheckIn ? (
        <CheckSomeoneIn
          gymId={gymId}
          words={words}
          keepsList={viewerPrivileges(org).includes('members.confirm')}
          timezone={timezone}
          clearSignal={removed}
          onCheckedIn={() => {
            setCheckedIn((n) => n + 1);
            // The day list is read again when it shows today, so the person is in it.
            if (day === gymToday(timezone)) setAttempt((a) => a + 1);
          }}
          // A visit added for the day on screen shows in its list.
          onAdded={(added) => {
            if (day === added) setAttempt((a) => a + 1);
          }}
        />
      ) : null;

  const today = (
      <CheckedInToday
        gymId={gymId}
        words={words}
        refreshSignal={checkedIn}
        canFix={mayCheckIn && !consoleIsReadOnly(org)}
        onRemoved={() => {
          setRemoved((n) => n + 1);
          if (day === gymToday(timezone)) setAttempt((a) => a + 1);
        }}
      />
  );

  return (
    <div className="c-page c-attend flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <p className="c-eyebrow">Today</p>
        <h1 className="c-h1">Attendance</h1>
        <p className="c-sub">
          {mayCheckIn ? 'Check people in, and see who came in, by day.' : 'Who came in, by day.'} Times are your{' '}
          {words.it}&apos;s own.
        </p>
      </div>

      {/* Check in beside Today's check-ins on a laptop, one under the other on a tablet or a phone. */}
      {checkIn !== null ? (
        <div className="c-split">
          {checkIn}
          {today}
        </div>
      ) : (
        today
      )}

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
      <FoldBox
        title="Check-in history"
        note={
          staleDay ? (
            <span className="c-s14 c-t2 flex items-center gap-2">
              <span className="c-dot c-dot-warn" aria-hidden="true" />
              Couldn&apos;t refresh — trying again
            </span>
          ) : fresh && state.status === 'ready' && answer !== null && dayTotalsLine(answer.totals) !== '' ? (
            <span className="c-s14 c-t2">{dayTotalsLine(answer.totals)}</span>
          ) : null
        }
        aside={
          fresh && state.status === 'ready' && answer !== null && people.length > 0 ? (
            <div className="c-search c-attend-find">
              <Search aria-hidden="true" className="w-4 h-4" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name"
                aria-label="Search by name"
                className="c-input"
              />
            </div>
          ) : null
        }
      >
        <div className="c-attend-day">
          <button type="button" onClick={() => setDay((d) => addDays(d, -1))} aria-label="Previous day" className="c-icon-btn">
            <ChevronLeft aria-hidden="true" className="w-4 h-4" />
          </button>
          {/* A LABEL, not a div: a click on the icon or the padding reaches the input, so the whole box
              opens the calendar (Kd, 2026-09-02: *"make it obvious"*). */}
          <label className="c-attend-date">
            <CalendarDays aria-hidden="true" className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--link)' }} />
            <input
              type="date"
              value={day}
              /* An empty box is refused here (T3 round 1, C/H-2): `day` must stay a calendar date, or
                 both arrows, the read and Try again all break. React puts the held day back. No `min`
                 or `max`: attendance is a history, and an HTML `min` refuses silently. */
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
            />
          </label>
          <button type="button" onClick={() => setDay((d) => addDays(d, 1))} aria-label="Next day" className="c-icon-btn">
            <ChevronRight aria-hidden="true" className="w-4 h-4" />
          </button>
          <span className="c-s15 c-t2">{closureDateLabel(day)}</span>
        </div>

        {/* THE THREE ARMS ALL ASK `fresh` FIRST. A held answer that belongs to
            the previous day is not an answer to what is on screen now, so it is
            drawn as loading rather than as itself. */}
        {!fresh || state.status === 'loading' ? <ConsoleLoading label="Loading who came in…" newLook /> : null}

        {/* THE SERVER'S OWN SENTENCE WHERE IT HAS ONE — a refusal here is
            `attendance.read` having been unticked. */}
        {fresh && state.status === 'failed' ? (
          <ConsoleFailed newLook message={state.error} onRetry={state.retryable ? () => setAttempt((a) => a + 1) : undefined} />
        ) : null}

        {fresh && state.status === 'ready' && answer !== null ? (
          people.length === 0 ? (
            /* THE EMPTY CASES ARE DIFFERENT SENTENCES, and only one of them is a
               problem (:8267/:8343). A FAILED read never reaches here. The
               exceptions filter is gone (Kd, 2026-09-03), so `filtered` is false. */
            <EmptyDay reason={emptyDayReason({ totals: answer.totals, filtered: false })} />
          ) : (
            <>
              {/* ONE ROW PER PERSON (ruling 12); a name opens their visits under it. */}
              <ul className="c-attend-bleed flex flex-col">
                {shown.map((person) => (
                  <li key={personKey(person)}>
                    <PersonRow
                      person={person}
                      timezone={zone}
                      clockFormat={clockFormat}
                      picked={picked !== null && personKey(picked) === personKey(person)}
                      onPick={(p) => setPicked((held) => (held !== null && personKey(held) === personKey(p) ? null : p))}
                    />
                    {/* KEYED on the person, so switching from one member to another
                        never shows the previous member's visits under the new name. */}
                    {picked !== null && personKey(picked) === personKey(person) ? (
                      <PersonHistory
                        key={`history-${personKey(person)}`}
                        gymId={gymId}
                        person={person}
                        onClose={() => setPicked(null)}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>

              {/* A SEARCH THAT FOUND NOBODY SAYS WHAT IT ACTUALLY SEARCHED: the
                  people loaded, never the whole day, while there are more. */}
              {shown.length === 0 ? (
                <p className="c-inbox c-s15 c-t1">
                  {everybodyLoaded
                    ? 'Nobody by that name came in on this day.'
                    : 'Nobody by that name in the people loaded so far — load the rest to search them too.'}
                </p>
              ) : null}

              {/* PAGED, NEVER INFINITE-SCROLLED (ruling 14): a deliberate press. */}
              <div className="flex flex-wrap items-center gap-3">
                {nextCursor !== null ? (
                  <button type="button" onClick={showMore} disabled={loadingMore} className="c-btn c-btn-s c-btn-sm">
                    {loadingMore ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
                    Show more people
                  </button>
                ) : null}
                <span className="c-s14 c-t2">Press a name to see when they came.</span>
              </div>
            </>
          )
        ) : null}
      </FoldBox>
    </div>
  );
}

/** THE EMPTY DAY, IN TWO SENTENCES. They look identical in the data. */
function EmptyDay({ reason }) {
  if (reason === 'filtered') {
    return <p className="c-inbox c-s15 c-t1">Nobody arrived outside opening hours on this day.</p>;
  }
  return <p className="c-inbox c-s15 c-t1">Nobody has checked in on this day yet.</p>;
}
