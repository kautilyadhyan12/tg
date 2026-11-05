// Delete account on the website (19b-ii; Kd, 2026-11-04): the open gyms that stop the deletion until
// they are handed over, the places a deletion leaves, and where a gym's Make owner is.

/** The open gyms this person owns, from the server's own answer, which sends `handOver` to a gym's
 *  own owner alone. */
export function ownedForDelete(orgs) {
  return (orgs ?? [])
    .filter((org) => org.handOver)
    .map((org) => ({ id: org.id, slug: org.slug, name: org.name, askedName: org.handOver.askedName ?? null }));
}

/** The places a deleted account leaves today: every gym they belong to or run, except the ones
 *  they own (the server keeps an owner's own row; users/repo.ts softDeleteUser). */
export function leavesOnDelete(orgs) {
  const ownsIt = (org) => org.staffRole === 'owner' && org.coOwner !== true;
  return (orgs ?? []).filter((org) => !ownsIt(org) && (org.isMember || org.staffRole !== null)).map((org) => org.name);
}

/** The Staff tab, which says at its top what to press to hand the gym over. */
export function handOverPath(slug) {
  return `/console/${encodeURIComponent(slug)}/members?view=staff&handOver=1`;
}

/** The console's own Delete account page. */
export function accountPath(slug) {
  return `/console/${encodeURIComponent(slug)}/account`;
}

/** "Iron House", "Iron House and Lotus Yoga", "Iron House, Lotus Yoga and Pulse". */
export function namesText(names) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
