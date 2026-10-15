import { Gift } from 'lucide-react';
import { friendGiftNote } from '@app/shared';

// REFER A FRIEND'S GIFT, FILLED IN (spec Part 3 §16.3; ROADMAP 20e-ii-b-i): the friend never
// holds a code, so the business adds it for them. Drawn the same on Add member, a person's
// Add membership and Sell: what the gift is, who invited them, and Remove (or Put it back).
// `fits` is false where it cannot be used on what is picked, with `what` naming that thing.

export function FriendGiftNote({ gift, applied, fits = true, what = null, onRemove, onPutBack, disabled }) {
  const title = !fits ? "Friend's gift" : applied ? "Friend's gift filled in" : "Friend's gift removed";
  return (
    <div className="rounded-[12px] p-3 flex items-start gap-3" style={{ background: 'var(--good-bg)' }} data-testid="friend-gift">
      <Gift aria-hidden="true" className="w-5 h-5 shrink-0" style={{ color: 'var(--good)' }} />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <p className="c-s14 c-w6 c-t1 m-0">{title}</p>
        <p className="c-s14 c-t2 m-0">{`${gift.words}. ${friendGiftNote(gift)}`}</p>
        {!fits && what !== null ? <p className="c-s14 c-t2 m-0">{`It doesn't apply to ${what}.`}</p> : null}
      </div>
      {fits ? (
        <button type="button" className="c-btn c-btn-s c-btn-sm" disabled={disabled} onClick={applied ? onRemove : onPutBack}>
          {applied ? 'Remove' : 'Put it back'}
        </button>
      ) : null}
    </div>
  );
}
