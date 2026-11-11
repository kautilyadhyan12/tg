// Overview's Cancelled in the app (ROADMAP 18l): who may read it, and its headline.

/** Staff who keep the member list, as the server gates it. */
export const canSeeAppCancels = (privileges) => Array.isArray(privileges) && privileges.includes('members.confirm');

/** "1 member cancelled in the app" or "3 members cancelled in the app". */
export function appCancelsHeadline(count) {
  return count === 1 ? '1 member cancelled in the app' : `${String(count)} members cancelled in the app`;
}
