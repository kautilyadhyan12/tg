// Delete account for a gym's own owner (19b-ii; Kd, 2026-11-04): the open gyms that stop the deletion
// until they are handed over, and where the box's button goes.

/** The open gyms this person owns, from the server's own answer, which sends `handOver` to a gym's
 *  own owner alone. */
export function ownedForDelete(orgs) {
  return (orgs ?? []).filter((org) => org.handOver).map((org) => ({ id: org.id, name: org.name, url: org.handOver.url, askedName: org.handOver.askedName }));
}

/** The Staff tab's address on this site, from the server's full one. */
export function inAppPath(url) {
  try {
    const at = new URL(url);
    return `${at.pathname}${at.search}`;
  } catch {
    return null;
  }
}
