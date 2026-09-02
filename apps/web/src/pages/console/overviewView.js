// THE GYM'S NUMBERS, away from the screen — `attendanceView`'s and `hoursView`'s
// shape, and the same reason: every sentence and every "should this be drawn at
// all" question is answerable without a browser.
//
// **NOTHING HERE COMPUTES A FIGURE A PERSON READS.** Kd's ruling 14 (:27992 §3)
// names the exact breakage — a screen that counts what it downloaded is right on
// a fixture of six and reports the first PAGE on a gym of four hundred — and
// `getOrgOverview` was built so a client never has to: the tiles, the eight
// weekly buckets and even the adoption PERCENTAGE all arrive computed
// (`service.ts`'s "the only arithmetic on this path is the percentage, and it is
// done here"). The only arithmetic in this file is `chartGeometry`, which turns
// counts into PIXELS. A pixel is not a number anybody reads off a screen, and it
// is the one thing a server cannot send.
//
// **THE TILES COUNT VISITS AND NOT WORKOUTS** — Kd's :29961 ruling 1, a knowing
// deviation from Part 3 §4.1 that he was shown and took: a workout exists only
// if the member ALSO logged their training, so a workout tile can read zero on a
// day forty people came through the door.
//
// **EVERY DAY HERE IS THE GYM'S DAY.** `today` and every `weekStart` arrive as
// `YYYY-MM-DD` already resolved in `gyms.timezone`, and nothing in this file
// turns one into an instant. That is not fussiness: `new Date('2026-08-18')` is
// UTC midnight and `toLocaleDateString` renders it in whoever is READING, so an
// owner in Austin looking at their own Assam gym would read the previous Monday
// (:8156's trap, trap #8, and the defect `closureDateLabel` was hand-built to
// avoid one card ago).
import { OVERVIEW_MONTH_DAYS, OVERVIEW_WEEKS } from '@app/shared';
import { dayTotalsLine, peopleLabel, visitsLabel } from './attendanceView';
import { MONTH_SHORT } from './hoursView';

/** A count off the wire, or 0. **Not a default that invents an answer** — every
 *  caller here has already established that the read SUCCEEDED, so a missing
 *  integer is a contract failure the parser would have caught, and this only
 *  stops one malformed field blanking a whole panel. */
function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** `18 Aug` — the Monday a bar belongs to, short enough for an axis.
 *
 *  **BUILT FROM THE STRING'S OWN PARTS, WITH NO `Date` ANYWHERE IN IT.** See the
 *  file header: a gym's Monday has no instant in it, and resolving one through a
 *  zone is how the label comes to disagree with the bar above it. The month
 *  names are `hoursView`'s — the console already spells a month in exactly one
 *  place and this is not the file to add a second table.
 *
 *  An unreadable value comes back as itself rather than as a guess or a blank,
 *  which is `closureDateLabel`'s rule and for its reason: a raw `2026-08-18` on
 *  an axis is ugly, and a silently dropped bar is a lie about the shape of the
 *  chart. */
export function weekAxisLabel(weekStart) {
  if (typeof weekStart !== 'string') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart);
  if (m === null) return weekStart;
  const [, , month, date] = m;
  const name = MONTH_SHORT[Number(month) - 1];
  if (name === undefined) return weekStart;
  return `${String(Number(date))} ${name}`;
}

/** HAS ANYBODY COME AT ALL, in any window this payload covers?
 *
 *  **IT ASKS EACH WINDOW SEPARATELY AND NEVER ADDS THEM UP.** Today is inside
 *  this week, this week is inside the eight, and the month is a DISTINCT count of
 *  people rather than a count of visits — so a total assembled from these fields
 *  would be four kinds of double-counting answering a question nobody asked
 *  (:29961 §6.2). All that is wanted is "is any of it non-zero". */
export function hasAnyActivity(overview) {
  const tiles = overview?.tiles;
  if (count(tiles?.today?.visits) > 0) return true;
  if (count(tiles?.week?.visits) > 0) return true;
  if (count(tiles?.week?.prevVisits) > 0) return true;
  if (count(tiles?.month?.visitors) > 0) return true;
  const weeks = Array.isArray(overview?.weeks) ? overview.weeks : [];
  return weeks.some((w) => count(w?.visits) > 0);
}

/** WHICH OF THE FOUR THINGS THIS ZONE IS TODAY, and they are four different
 *  sentences rather than four shades of zero (:8267, :8343, :26736).
 *
 *  - `none`       — no payload. The screen's own read arm draws the failure card
 *                   with its Try again; this function is never the thing that
 *                   explains a dropped request.
 *  - `no-members` — nobody has joined and nobody has ever come, so there is
 *                   nothing to say. **Part 3 §4.1's own edge:** *"org with 0
 *                   members ever → Overview IS the checklist + poster CTA (no sad
 *                   empty charts)"*. The join-code card below is that screen.
 *  - `nobody`     — the gym HAS members and nothing has been recorded.
 *  - `ready`      — draw the numbers.
 *
 *  **A GYM WITH NO MEMBERS BUT SOME ACTIVITY IS `ready`, AND THAT ORDER IS THE
 *  WHOLE FUNCTION.** `month.members` counts CURRENT, non-complimentary members,
 *  so a gym whose only seat is the owner's complimentary one reads 0 — and if
 *  that owner has marked themselves in, "2 people came today" is TRUE. Hiding a
 *  true number to honour an empty-state rule is the same defect the rule exists
 *  to prevent, pointed the other way. */
export function numbersState(overview) {
  if (overview === null || typeof overview !== 'object') return 'none';
  if (hasAnyActivity(overview)) return 'ready';
  if (count(overview?.tiles?.month?.members) === 0) return 'no-members';
  return 'nobody';
}

/** WHY THE ZONE IS EMPTY WHEN THE GYM HAS MEMBERS — and the two cases have
 *  different next moves, which is why they are different sentences
 *  (`emptyDayReason`'s rule, one screen over).
 *
 *  **THE WINDOW IS NAMED AND THE WORD "yet" IS NOT USED.** This payload covers
 *  eight weeks; it cannot answer "has anybody EVER come", and :8343 is this
 *  project's recorded cost of writing a sentence about a history the server was
 *  never asked about. "Nobody has marked attendance yet" would be false for a
 *  gym that was busy nine weeks ago — so the sentence says what is known.
 *
 *  **The switch outranks it**, because a gym whose button is off has no members
 *  who COULD have marked, and telling that owner "nobody came" points them at
 *  their members when the answer is in Settings. */
export function nothingRecordedSentence(manualAttendanceEnabled) {
  if (manualAttendanceEnabled === false) {
    return 'Nobody can mark attendance — the switch is off in Settings.';
  }
  return `Nobody has marked attendance in the last ${OVERVIEW_WEEKS} weeks.`;
}

/** TODAY, SO FAR — and it is `dayTotalsLine`, not a second spelling of it.
 *
 *  The Attendance screen already answers "how many came, and did anybody come
 *  twice" for a day, off a different endpoint, in `34 people · 37 visits`. This
 *  is the same question and must not get its own wording: two screens describing
 *  one day two ways is the defect that file's own header names. The field names
 *  differ (`visitors`/`visits` here, `people`/`visits` there) and the QUESTION
 *  does not, so the mapping happens here and the sentence stays in one place. */
export function todayLine(today) {
  return dayTotalsLine({ people: count(today?.visitors), visits: count(today?.visits) });
}

/** THIS WEEK, SO FAR. Same shape as `todayLine` and for the same reason. */
export function weekLine(week) {
  return dayTotalsLine({ people: count(week?.visitors), visits: count(week?.visits) });
}

/** THE ▲▼, AND THE SENTENCE WITHOUT WHICH IT WOULD BE A LIE.
 *
 *  **THE COMPARISON IS UNEVEN AND THE SCREEN MUST SAY SO** — a build requirement
 *  the server half's review moved into `CARD-gym-overview-numbers.md` §4b after
 *  finding it lived only in a comment in `packages/shared`, which is not
 *  somewhere the screen's author reads. `week.visits` is this gym-week SO FAR;
 *  `week.prevVisits` is the WHOLE of the week before. **On a Tuesday that is two
 *  days against seven, so a bare arrow tells a healthy gym it is collapsing** —
 *  :5807 on its face, a number on screen that is wrong.
 *
 *  So `direction` never travels without `text`, and `text` always names both
 *  ends of the comparison.
 *
 *  **A COMPARISON AGAINST ZERO GETS NO ARROW.** "Up from nothing" is not a
 *  trend, and an arrow drawn over a gym's first week would be the same false
 *  confidence in the other direction. */
export function weekComparison(week) {
  const prev = count(week?.prevVisits);
  if (prev === 0) return { direction: null, text: 'Nothing was recorded last week.' };
  const now = count(week?.visits);
  const direction = now > prev ? 'up' : now < prev ? 'down' : 'same';
  return { direction, text: `so far, against ${visitsLabel(prev)} in the whole of last week` };
}

/** THE LAST 30 DAYS — how many of the gym's members came, and what share that
 *  is. `null` when there is no share to state.
 *
 *  **`adoptionPct` IS NULL AND NOT ZERO FOR A GYM WITH NO MEMBERS, and the
 *  server is what decides that** (`service.ts`: *"a gym nobody has joined has no
 *  adoption to state, and 0% would tell an owner on their first day that their
 *  members are ignoring them"*). This reads the null; it does not re-derive the
 *  rule, and it never divides — R3.1, and the reason the percentage is served at
 *  all is that a client rounding it its own way would disagree with every other
 *  surface that ever prints adoption.
 *
 *  **THE POPULATION IS SAID OUT LOUD, and that is not padding.** `month.visitors`
 *  counts CURRENT, non-complimentary members while `today.visitors` counts every
 *  attendee — both true, different populations, and the shared contract's own
 *  comment names the screen this produces: an owner who marked themselves in
 *  reads *"2 people came today"* beside *"1 member came this month"*. Saying
 *  "members" here and "people" above is what stops those two reading as a
 *  contradiction. */
export function adoptionLine(month) {
  const pct = month?.adoptionPct;
  if (!Number.isInteger(pct)) return null;
  const members = count(month?.members);
  const visitors = count(month?.visitors);
  return {
    pct,
    text: `${visitors} of ${members === 1 ? '1 member' : `${members} members`} came in the last ${OVERVIEW_MONTH_DAYS} days`,
  };
}

/** A TILE'S FIGURE, SPLIT INTO THE NUMBER AND THE WORDS UNDER IT.
 *
 *  **KD, 2026-09-03, LOOKING AT THE SHIPPED SCREEN: *"the problem is design …
 *  its not looking good"*.** The first version put the whole sentence
 *  — `1 person · 2 visits` — where the figure goes, so the thing an owner is
 *  meant to read at a glance was a line of prose with two numbers in it and no
 *  hierarchy between them. **A dashboard tile is a NUMBER and a caption.**
 *
 *  **PEOPLE IS THE HEADLINE AND VISITS IS THE CAPTION, which is his own
 *  wording** — *"it should be like this many people came"*. `visits` is still
 *  drawn, and still ONLY when it differs, which is `dayTotalsLine`'s rule
 *  preserved: on the ordinary day where they are equal, printing both is noise
 *  that trains an owner to stop reading the tile.
 *
 *  Nothing here counts anything — both figures arrive counted. */
export function tileCounts(figures) {
  const people = count(figures?.visitors);
  const visits = count(figures?.visits);
  return {
    value: people,
    unit: people === 1 ? 'person' : 'people',
    detail: visits !== people ? visitsLabel(visits) : null,
  };
}

/** THE FEW NAMES THAT FIT UNDER THE NUMBERS — Kd's *"if wants to see details can
 *  see this person with name … and if marked again then show came two times"*.
 *
 *  **THE LIST IS A PREVIEW AND THE COUNT IS NOT TAKEN FROM IT.** The screen
 *  draws `totals.people`, which the server counted over the whole day, and this
 *  hands back only the rows to show — so a gym of four hundred still reads the
 *  right number above a list of five (:27992 §3's exact breakage).
 *
 *  **The server's order is kept.** It groups the day; the screen reads top to
 *  bottom. */
export const OVERVIEW_PEOPLE_PREVIEW = 5;

export function previewPeople(people, max = OVERVIEW_PEOPLE_PREVIEW) {
  const rows = Array.isArray(people) ? people.filter((p) => p !== null && typeof p === 'object') : [];
  return rows.slice(0, max);
}

/** Is there anybody the preview is not showing? Answered from the server's own
 *  whole-day count against what is on screen — never from `nextCursor` alone,
 *  which is null on a day whose people all fit in one page but not in five
 *  rows. */
export function hiddenPeopleCount(totals, shown) {
  const all = count(totals?.people);
  const on = Array.isArray(shown) ? shown.length : 0;
  return all > on ? all - on : 0;
}

/** Two letters for a face nobody has uploaded — the initials circle beside a
 *  name. Non-Latin scripts keep their first character rather than being
 *  transliterated or blanked. */
export function initials(displayName) {
  const parts = String(displayName ?? '').trim().split(/\s+/).filter((w) => w !== '');
  if (parts.length === 0) return '?';
  if (parts.length === 1) return [...parts[0]].slice(0, 2).join('').toUpperCase();
  return `${[...parts[0]][0]}${[...parts[parts.length - 1]][0]}`.toUpperCase();
}

/** THE SENTENCE THAT STOPS TWO TRUE NUMBERS READING AS A CONTRADICTION.
 *
 *  **FOUND ON KD'S OWN SCREEN, 2026-09-03, and the shared contract had predicted
 *  the exact sentence pair.** His console drew *"Today · 1 person"* directly
 *  beside *"Last 30 days · 0% — 0 of 2 members came in the last 30 days"*. Both
 *  figures are correct and they count DIFFERENT POPULATIONS: `today.visitors`
 *  is every attendee, while `month.visitors` and its denominator are current
 *  members the gym is charged for — so the person who came was the owner, on a
 *  complimentary seat, and is deliberately not in the share.
 *
 *  **A reader cannot know that, and what they see is a screen disagreeing with
 *  itself** — :5807's test is not "is it on screen", it is "is it on screen AND
 *  wrong", and a pair of true numbers arranged into a false impression is the
 *  same defect wearing two hats. `orgs.ts`'s own comment named it before the
 *  screen existed: *"a screen that draws them side by side WITHOUT SAYING SO"*.
 *
 *  **It appears ONLY when the two actually disagree**, which is the difference
 *  between an explanation and noise: somebody has come recently, the gym HAS
 *  countable members, and none of them is who came. */
export function crowdNote(tiles) {
  const members = count(tiles?.month?.members);
  if (members === 0) return null;
  if (count(tiles?.month?.visitors) > 0) return null;
  const cameRecently = count(tiles?.today?.visitors) > 0 || count(tiles?.week?.visitors) > 0;
  if (!cameRecently) return null;
  return 'Free seats — the owner’s, and anyone the gym isn’t charged for — are counted above but not in this share.';
}

/** IS THERE A TREND TO DRAW YET?
 *
 *  Part 3 §4.1's own chart state: *"empty (< 1 wk data): friendly 'first week
 *  collecting' state"*. **Read off the buckets rather than off a date**, because
 *  nothing in this payload says when the gym opened and inventing that from
 *  `weekStart` would be a claim the server never made: if every week BEFORE the
 *  current one is empty, there is no past to plot, whatever the reason.
 *
 *  **The current week is the LAST bucket by the server's construction** — the
 *  series is generated from `date_trunc('week', today)` backwards — and this
 *  file deliberately does not recompute which Monday today falls in. The repo
 *  states the reason at the query: *"a second implementation in JavaScript is a
 *  second answer to 'which Monday'"*. */
export function chartState(weeks) {
  const rows = Array.isArray(weeks) ? weeks : [];
  if (rows.length === 0) return 'collecting';
  const past = rows.slice(0, -1);
  return past.some((w) => count(w?.visits) > 0) ? 'ready' : 'collecting';
}

/** The chart's own coordinate space. A `viewBox` rather than measured pixels, so
 *  the drawing scales to whatever width the card gives it and needs no layout
 *  pass — which also means it renders identically in a test, where nothing has a
 *  width at all. */
export const CHART_COLUMN = 40;
export const CHART_HEIGHT = 120;
const BAR_GAP = 7;

/** BARS FOR VISITS, A LINE FOR HOW MANY DIFFERENT PEOPLE — Part 3 §4.1's chart,
 *  with §4.1's "workouts" reading "visits" per Kd's ruling.
 *
 *  **BOTH SERIES ARE DRAWN ON ONE SCALE, and that is a truth requirement rather
 *  than a style choice.** `visitors` is a DISTINCT count over the same rows
 *  `visits` counts, so it can never exceed it; on a shared scale the line
 *  therefore sits on or under the bar tops, which is what the two numbers
 *  actually mean. Two independent scales would let the line ride above the bars
 *  and show an owner more people than visits — a picture that cannot happen.
 *
 *  Returns `null` for an empty series so a caller draws no `<svg>` at all rather
 *  than an empty frame. */
export function chartGeometry(weeks) {
  const rows = (Array.isArray(weeks) ? weeks : []).filter((w) => w !== null && typeof w === 'object');
  if (rows.length === 0) return null;

  // The floor of 1 is only ever reached by an all-zero series, where every bar
  // is height 0 and the divisor is arbitrary. It exists so the arithmetic cannot
  // divide by zero, never to scale a real number.
  const max = Math.max(1, ...rows.map((w) => Math.max(count(w?.visits), count(w?.visitors))));
  const barWidth = CHART_COLUMN - BAR_GAP * 2;

  const bars = rows.map((row, index) => {
    const visits = count(row?.visits);
    const visitors = count(row?.visitors);
    const height = Math.round((visits / max) * CHART_HEIGHT);
    return {
      key: typeof row?.weekStart === 'string' ? row.weekStart : String(index),
      label: weekAxisLabel(row?.weekStart),
      visits,
      visitors,
      x: index * CHART_COLUMN + BAR_GAP,
      y: CHART_HEIGHT - height,
      width: barWidth,
      height,
      cx: index * CHART_COLUMN + CHART_COLUMN / 2,
      cy: CHART_HEIGHT - Math.round((visitors / max) * CHART_HEIGHT),
      // See `chartState`: the newest bucket is the current, PARTIAL week, by the
      // server's construction and not by a date this file worked out.
      isCurrent: index === rows.length - 1,
    };
  });

  return {
    width: rows.length * CHART_COLUMN,
    height: CHART_HEIGHT,
    max,
    bars,
    linePoints: bars.map((b) => `${b.cx},${b.cy}`).join(' '),
  };
}

/** WHAT ONE BAR SAYS WHEN YOU HOVER OR A SCREEN READER REACHES IT — the whole
 *  bar in one sentence, because an axis label plus a height is not readable to
 *  anybody who cannot see the picture.
 *
 *  The current week says so: its bar is SHORT because the week is not over, and
 *  a chart whose last column is always the runt teaches an owner to read a
 *  weekly collapse that is not there. Same defect as the bare arrow, one panel
 *  down. */
export function barTitle(bar) {
  const when = bar?.isCurrent ? 'This week so far' : `Week of ${bar?.label ?? ''}`;
  return `${when}: ${visitsLabel(count(bar?.visits))}, ${peopleLabel(count(bar?.visitors))}`;
}
