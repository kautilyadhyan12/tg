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
    });
  }

  const rows = [...byOrg.values()];
  const order = { waiting: 0, refused: 1, expired: 1, removed: 1, member: 2 };
  return rows.sort((a, b) => order[a.kind] - order[b.kind]);
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
