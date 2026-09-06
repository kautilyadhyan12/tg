// Pure rules for "where do I stand with my gym" — no React, no network, tested
// directly. Same pattern as `consoleView.js` and `progressClamp.js`.
//
// TWO SOURCES ANSWER ONE QUESTION, which is why this file exists rather than a
// couple of `.map`s in the card:
//   · `/v1/orgs/applications/mine` — everything still PENDING, plus anything
//     REFUSED or EXPIRED in the last 14 days. Confirmed applications are
//     deliberately absent from it.
//   · `/v1/orgs/mine` — the gyms the person actually belongs to, AND (in its
//     own `formerOrgs` list) the ones that recently removed them. Kd ruled on
//     2026-08-20 that a removal has to be SAID: stopping the app calling a
//     removed member a stranger left it saying nothing at all, which is a
//     quieter defect rather than a fix.
//
// Reading either alone tells a lie by omission. Applications alone: a person
// who was just confirmed watches their "waiting" card vanish with nothing in
// its place, so the app never says they got in. Memberships alone: somebody
// waiting is shown nothing at all, as though they never asked.
//
// And read TOGETHER they can contradict each other, which is what the rules
// below settle. A refused application from Tuesday sits in the list for 14 days
// — so a person who was refused, asked again, and was let in has THREE rows
// about one gym, of which only the newest is true. **One gym, one row, and the
// most recent fact wins**: member beats waiting beats refused.
//
// **THE CHEER'S HELPERS AT THE BOTTOM ARE MEMBER-SIDE TOO, AND DELIBERATELY DO
// NOT FEED `gymStatusRows`.** `latestCheer` rides on the `/v1/orgs/mine` row and
// `My Gyms` reads that row WHOLE (`useMyGyms` → `memberOrgs`), so putting the
// cheer through the row-ranking above would be a second path to a field one
// screen already has. The rows above answer "where do I stand with this gym";
// a cheer is a message, and Kd ruled where messages live (:33091 — gym things
// are on `My Gyms`, and the dashboard keeps only the greeting).
import { cheerLine } from '../../utils/cheerPresets';

/** Rank of what we can say about a gym. Higher wins; the comparison is what
 *  stops a stale refusal outliving the membership that followed it.
 *
 *  `removed` sits at the BOTTOM, and that is not a judgement about how
 *  important it is — it is the recency order every reachable sequence produces.
 *  Removed then asked again is `waiting`, which is newer. Removed then refused
 *  is `refused`, which is newer. The opposite sequence — refused, then let in,
 *  then removed — cannot leave a refusal behind to beat it, because the SERVER
 *  now withholds a refusal that a later confirmation superseded (T3 round 1
 *  C/H-1). Rank is a proxy for recency and only holds while that stays true. */
const RANK = { member: 3, waiting: 2, refused: 1, expired: 1, removed: 0 };

/** The application statuses this screen has anything to say about. `pending`
 *  and the two refusal shapes are the only ones the endpoint returns; anything
 *  else — a status added later, or a body this client does not understand — is
 *  DROPPED rather than guessed at. A row the app cannot describe truthfully is
 *  a row it must not draw. */
function kindForApplication(status) {
  if (status === 'pending') return 'waiting';
  if (status === 'rejected') return 'refused';
  if (status === 'expired') return 'expired';
  return null;
}

/** One row per gym, ordered so the ones needing the person's attention come
 *  first: still waiting, then refused, then the gyms they are simply in.
 *
 *  Both arguments are allowed to be null — that is what a FAILED read passes,
 *  and a failed read must contribute nothing rather than being treated as "no
 *  gyms". The caller draws nothing at all when this returns an empty list, so
 *  absence never states anything false; it just says nothing.
 */
export function gymStatusRows({ applications, orgs, formerOrgs } = {}) {
  const byOrg = new Map();

  const offer = (row) => {
    const held = byOrg.get(row.orgId);
    if (held === undefined || RANK[row.kind] > RANK[held.kind]) byOrg.set(row.orgId, row);
  };

  for (const org of Array.isArray(orgs) ? orgs : []) {
    if (org?.isMember !== true) continue;
    const id = org?.id;
    const name = org?.name;
    if (typeof id !== 'string' || typeof name !== 'string') continue;
    offer({ kind: 'member', orgId: id, orgName: name });
  }

  // KD RULING 2026-08-20: a removal must be SAID. Silence was the hole left
  // when the server stopped calling a removed member a stranger — true, and
  // still not the truth. Same null-tolerance as the other two lists: a failed
  // read contributes nothing rather than being read as "nothing happened".
  for (const org of Array.isArray(formerOrgs) ? formerOrgs : []) {
    const id = org?.id;
    const name = org?.name;
    if (typeof id !== 'string' || typeof name !== 'string') continue;
    offer({ kind: 'removed', orgId: id, orgName: name });
  }

  for (const app of Array.isArray(applications) ? applications : []) {
    const kind = kindForApplication(app?.status);
    const id = app?.org?.id;
    const name = app?.org?.name;
    if (kind === null || typeof id !== 'string' || typeof name !== 'string') continue;
    // The APPLICATION's own id and its two clock fields ride along, because
    // "Remind them" addresses the application and not the gym.
    //
    // **CORRECTED (T3 round 1, Low-5): this said they were "undefined on every
    // other kind by construction", which is false of the two kinds that come
    // through THIS loop.** A refused or expired row is application-derived and
    // carries all three — the suite's own `appRow('refused', …)` asserts it.
    // Only `member` and `removed` lack them, and those are built by the two
    // loops above. What actually stops a button appearing on a refused row is
    // `nudgeState`'s `kind !== 'waiting'` test, not the shape of the row.
    offer({
      kind,
      orgId: id,
      orgName: name,
      applicationId: typeof app?.id === 'string' ? app.id : null,
      expiresAt: typeof app?.expiresAt === 'string' ? app.expiresAt : null,
      nudgedAt: typeof app?.nudgedAt === 'string' ? app.nudgedAt : null,
      // CAN THE GYM ACT ON THIS REQUEST RIGHT NOW? (Kd 2026-08-29, :24141 §1.)
      //
      // **ONLY AN EXPLICIT `false` MEANS NO.** The server sends true/false; an
      // api older than this bundle sends nothing and the shared schema defaults
      // it to null, which means "we could not ask" and never "no" — the same
      // three-state rule `consoleReadOnly` follows. Anything this code cannot
      // read is treated the same way, so an unreadable value can only ever cost
      // the extra sentence, never invent one.
      orgCanConfirm: app?.orgCanConfirm === false ? false : true,
    });
  }

  const rows = [...byOrg.values()];
  const order = { waiting: 0, refused: 1, expired: 1, removed: 1, member: 2 };
  return rows.sort((a, b) => order[a.kind] - order[b.kind]);
}

/** THE GYMS THIS PERSON ACTUALLY BELONGS TO — the member-side twin of
 *  `manageableOrgs` in `consoleView.js`, and the gate on Kd's ruling of
 *  2026-09-02: **My Gyms appears once a gym has APPROVED them**, never while
 *  they are waiting.
 *
 *  `/v1/orgs/mine` carries every gym the caller has any relationship with, so
 *  the filter is `isMember` and nothing else. **An owner who does not train at
 *  their own gym is not a member of it** and gets no section — which is right:
 *  everything in there is a member's own (their visits, their gym's hours), and
 *  the owner's view of the same gym is the console, behind the other door.
 *
 *  **`=== true` rather than truthiness**, matching `gymStatusRows` above: a
 *  field this client cannot read must never be promoted into a membership. */
export function memberOrgs(orgs) {
  return (Array.isArray(orgs) ? orgs : []).filter(
    (org) => org?.isMember === true && typeof org?.id === 'string' && typeof org?.name === 'string',
  );
}

/** CAN THIS PERSON REMIND THE GYM RIGHT NOW? (:11385 mechanic 3, once a day.)
 *
 *  **The server is the enforcement and this is only the button's state.** The
 *  rule lives in a database column compared inside the writing statement, so a
 *  screen that gets this wrong costs a refused tap and a truthful sentence —
 *  never a second reminder. That is the correct direction: R3.3's "UI hiding is
 *  never the enforcement", applied to a button rather than a permission.
 *
 *  A row with no application id can never be ready: there is nothing to nudge.
 *  An UNREADABLE `nudgedAt` is treated as never-nudged, deliberately — the
 *  server will refuse if it is wrong, whereas hiding the button on a value this
 *  code could not parse would strand a waiting person with no way to ask. */
export function nudgeState(row, now = Date.now()) {
  if (row?.kind !== 'waiting' || typeof row?.applicationId !== 'string') {
    return { ready: false, reason: 'none' };
  }
  const last = new Date(row?.nudgedAt ?? '');
  if (Number.isNaN(last.getTime())) return { ready: true, reason: 'never' };
  const ready = now - last.getTime() >= 24 * 60 * 60 * 1000;
  return { ready, reason: ready ? 'due' : 'recent' };
}

/** HOW LONG AGO THE GYM CHEERED, IN WORDS.
 *
 *  **ELAPSED TIME, NEVER A CALENDAR WORD, AND THE CONTRACT ASKED FOR IT THAT
 *  WAY.** `gymCheerSchema.sentAt` is an INSTANT and not a gym-day — deliberately
 *  the opposite of every attendance field beside it — because a visit belongs to
 *  the GYM's calendar while a cheer is read by the MEMBER, wherever they are.
 *  So there is no "today"/"yesterday" here at all, and `joinClock`'s standing
 *  rule (a day word compares calendar days, a duration measures elapsed time)
 *  is satisfied by this function only ever printing durations. `nudgedLabel` is
 *  the same shape one file over.
 *
 *  Null on anything unreadable, and null on an instant in the FUTURE: a clock
 *  skew must produce silence rather than "in 3 hours", which is the same rule
 *  every helper in `joinClock` follows. */
export function cheerAge(sentAt, now = Date.now()) {
  const at = new Date(typeof sentAt === 'string' ? sentAt : '');
  if (Number.isNaN(at.getTime()) || !Number.isFinite(now)) return null;
  const minutes = Math.floor((now - at.getTime()) / 60000);
  if (minutes < 0) return null;
  if (minutes < 60) return 'just now';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/** WHAT THE MEMBER'S GYM CARD SHOWS, or null.
 *
 *  **NOTHING IS EVER INVENTED HERE.** No cheer, an unreadable one, or a preset
 *  this bundle has no words for all produce null and the card draws nothing —
 *  silence claims nothing, where a placeholder would put words in a gym's mouth.
 *  That is the same rule the row-building loops above follow: a row the app
 *  cannot describe truthfully is a row it must not draw.
 *
 *  **`when` MAY BE NULL WHILE THE LINE IS NOT.** A readable preset with an
 *  unreadable instant is still a real cheer and the words are still true; only
 *  the "when" goes missing. Collapsing the two would throw away a message the
 *  gym actually sent over a timestamp nobody reads. */
export function cheerNote(latestCheer, now = Date.now()) {
  if (latestCheer === null || typeof latestCheer !== 'object') return null;
  const line = cheerLine(latestCheer.preset);
  if (line === null) return null;
  return { emoji: line.emoji, text: line.text, when: cheerAge(latestCheer.sentAt, now) };
}

/** HOW LONG A CHEER COUNTS AS NEW, for the nav item's dot.
 *
 *  **ONE DAY BECAUSE THAT IS THE CAP, and it is a DISPLAY rule that mirrors the
 *  server's rather than enforcing anything.** A dot that outlasted the cap would
 *  still be lit when the next cheer could already have arrived, and one that
 *  fell short would go dark on a message nobody had read.
 *
 *  **IT SAID SEVEN FOR A DAY AFTER THE SEVEN WENT.** Kd reversed his own cap to
 *  one per member per day at :35762; the paragraph here went on arguing for a
 *  week, citing the ruling it had replaced — so a member cheered on Monday
 *  carried the dot until Sunday, and a member cheered daily never saw it go
 *  dark at all. :20587 is the rule: every copy of a number moves together, and
 *  this one was not in the ruling's own measured touch list.
 *  **Part 3 §4.1's `rate-limit 1/member/7d` is the AT-RISK NUDGE, a different
 *  feature** (:35762 §1), and quoting it here is what made seven look justified.
 *
 *  **IT IS A ROLLING 24 HOURS WHERE THE SERVER'S CAP IS A CALENDAR GYM-DAY, and
 *  that is deliberate rather than an approximation nobody noticed.** `sentAt` is
 *  an INSTANT and never a gym-day — `gymCheerSchema` in `@app/shared` says why:
 *  a cheer is read by the MEMBER, wherever in the world they are, so *"2 hours
 *  ago"* on the card below is the only rendering true for both of them, and a
 *  dot going dark at a foreign midnight while that card still says "2 hours ago"
 *  would be the two disagreeing about one fact.
 *
 *  **WHAT THE ROLLING WINDOW BUYS: on an ordinary day the gym's next midnight is
 *  at most 24 hours away, so the dot stays lit for the whole of the gym-day its
 *  cheer belongs to and is never lit for more than a day.** It can therefore
 *  outlive the cap by up to a day — the safe direction, since the cost is a dot a
 *  member has already read and the alternative is a cheer that never announced
 *  itself.
 *
 *  ~~**and can never fall short of it**~~ **— STRUCK 2026-09-06, T3 round 2 L-7:
 *  a clock-change day is not 24 hours.** Where a zone puts its clocks BACK the
 *  gym-day is 25 hours long, so a cheer early in it loses the dot up to an hour
 *  before that day ends. `joinClock.js`'s `waitingForLabel` carries the same
 *  class MEASURED in the other direction — `America/New_York`, 7 Mar 23:59 to
 *  9 Mar 00:01 is 23h02m across a spring-forward — and it is why the floor there
 *  is load-bearing. **Not fixed, because fixing it means giving the dot the gym's
 *  zone, which is the one thing the paragraph above rules out**: the card beside
 *  it says *"2 hours ago"* in the member's own zone and the two must not
 *  disagree. An hour twice a year at the tail of an already-read dot is the
 *  cheaper side of that trade, and it is now written down rather than claimed
 *  away.
 *
 *  **WHAT THE CUT FROM SEVEN DAYS TO ONE COSTS, and it is a chat's call carrying
 *  its own price** (:27992's habit): the dot is RECENCY, not read-state, so a
 *  member who opens `My gyms` twice a week now misses most of the cheers they are
 *  sent — where a seven-day dot would still have been waiting, a one-day dot has
 *  gone dark. **The cheer itself is not lost**: it stays on the gym's card as
 *  *"3 days ago"* with its words, and the dot only ever decided whether the nav
 *  item nudged them to look. Mirroring the cap is what keeps the dot honest — Kd
 *  ruled one cheer per gym-day, so a dot lasting a week would announce as new a
 *  message six newer ones could have replaced.
 *
 *  Named here rather than typed at the call site, so moving it is one edit
 *  (:20587). */
export const CHEER_FRESH_DAYS = 1;

/** SHOULD THE `My Gyms` ITEM CARRY A DOT? — a chat's call with its cost, taken
 *  at this card's gate and approved by Kd 2026-09-05.
 *
 *  **WHY IT EXISTS: NOTHING IN THIS PRODUCT SENDS ANYTHING.** No mailer, no
 *  SMTP, no notifications table — measured at :29961 §4 — so a cheer is STORED
 *  and waits on a screen, and a member who never opens `My gyms` never learns it
 *  happened. The dot is the whole of the arrival.
 *
 *  **ITS COST, stated rather than discovered: it is RECENCY and not read-state,
 *  so it stays lit for the day whether or not they looked.** The alternative is
 *  a second table and a second write path for a dot, which
 *  `CARD-gym-overview-people.md` §3.2 refused deliberately.
 *
 *  Reads the same `latestCheer` the card below draws — one field answering one
 *  question, so the dot and the card cannot disagree about whether a cheer
 *  exists. */
export function hasFreshCheer(orgs, now = Date.now()) {
  const cutoff = CHEER_FRESH_DAYS * 24 * 60 * 60 * 1000;
  return (Array.isArray(orgs) ? orgs : []).some((org) => {
    const sentAt = org?.latestCheer?.sentAt;
    const at = new Date(typeof sentAt === 'string' ? sentAt : '');
    if (Number.isNaN(at.getTime()) || !Number.isFinite(now)) return false;
    const age = now - at.getTime();
    return age >= 0 && age < cutoff;
  });
}
