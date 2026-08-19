// Pure rules for "where do I stand with my gym" — no React, no network, tested
// directly. Same pattern as `consoleView.js` and `progressClamp.js`.
//
// TWO SOURCES ANSWER ONE QUESTION, which is why this file exists rather than a
// couple of `.map`s in the card:
//   · `/v1/orgs/applications/mine` — everything still PENDING, plus anything
//     REFUSED or EXPIRED in the last 14 days. Confirmed applications are
//     deliberately absent from it.
//   · `/v1/orgs/mine` — the gyms the person actually belongs to.
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
 *  stops a stale refusal outliving the membership that followed it. */
const RANK = { member: 3, waiting: 2, refused: 1, expired: 1 };

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
export function gymStatusRows({ applications, orgs } = {}) {
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

  for (const app of Array.isArray(applications) ? applications : []) {
    const kind = kindForApplication(app?.status);
    const id = app?.org?.id;
    const name = app?.org?.name;
    if (kind === null || typeof id !== 'string' || typeof name !== 'string') continue;
    offer({ kind, orgId: id, orgName: name });
  }

  const rows = [...byOrg.values()];
  const order = { waiting: 0, refused: 1, expired: 1, member: 2 };
  return rows.sort((a, b) => order[a.kind] - order[b.kind]);
}
