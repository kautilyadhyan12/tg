import { inviteLines } from '@app/shared';

// THE INVITE PAGE'S WORDS (20e-ii-a), from the server's own sentences (`inviteLines`), each
// in its place on the page: who invited them (by first name), the welcome offer, the form's
// line and who set the offer. A business that gives the friend nothing promises nothing.

export function inviteView(invite) {
  const lines = inviteLines(invite.gymName, invite.friendGift, invite.inviterFirstName ?? null);
  if (invite.friendGift === null) return { invited: lines[0], offer: null, touch: lines[1], setBy: null };
  return { invited: lines[0], offer: lines[1], touch: lines[2], setBy: lines[3] };
}
