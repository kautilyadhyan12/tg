import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import {
  ENDING_NOT_TOLD,
  endingChangeLine,
  endingConfirmLabel,
  endingKeptLine,
  endingMore,
  endingPersonLine,
  endingTitle,
} from '../../pages/console/bookingsEndView';

// WHO IS BOOKED, BEFORE A CLASS GOES (ROADMAP 17c-ii-a; CLAUDE.md §4's screen rule): the
// box that asks before a change ends people's bookings. It names who changes (the first
// few, "and N more", See all a hundred at a time in its own frame), what happens to them,
// and who does not change. In place, like `ConfirmInline`, never over the page.
//
// `ending` is the server's answer (409 `class_has_bookings`); `scope` is what See all
// asks for: `{ by: 'session' | 'slot' | 'class', id, from? }`. `kind` is the change:
// 'cancel' (one class), 'slot' (a time slot cancelled), 'class' (archived) or 'move'.

export default function BookingsEndBox({ gymId, ending, scope, kind, clockFormat, busy = false, cancelLabel = 'Keep it', onConfirm, onCancel }) {
  // The whole list once See all is pressed: the pages read so far, and the next cursor.
  const [all, setAll] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(null);

  const list = all === null ? ending.people : all.people;
  const more = endingMore(ending, list.length);
  const canLoad = all === null ? more > 0 : all.next !== null;

  const loadMore = async () => {
    setLoading(true);
    setFailed(null);
    try {
      const res = await orgService.getEndingBookings(gymId, { ...scope, after: all === null ? undefined : all.next });
      const page = Array.isArray(res.data?.people) ? res.data.people : [];
      setAll({ people: all === null ? page : [...all.people, ...page], next: res.data?.next ?? null });
    } catch (err) {
      setFailed(errorText(err, "We couldn't load the list."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="group"
      aria-label="People booked on these classes"
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: 'var(--raise)', border: '1px solid var(--card-line)' }}
    >
      <p className="c-s15 c-w6 c-t1">{endingTitle(ending)}</p>
      <p className="c-s14 c-t2">{endingChangeLine(ending)}</p>
      <ul
        data-testid="ending-people"
        className="flex flex-col gap-2"
        style={all === null ? undefined : { maxHeight: 260, overflowY: 'auto', paddingRight: 4 }}
      >
        {list.map((person) => {
          const line = endingPersonLine(person, clockFormat);
          return (
            <li key={person.seq} className="min-w-0">
              <div className="c-s15 c-t1 c-ell">{line.name}</div>
              <div className="c-s13 c-t3 c-ell">{line.detail}</div>
            </li>
          );
        })}
      </ul>
      {canLoad ? (
        <p className="c-s14 c-t2">
          {more > 0 ? `and ${more.toLocaleString('en')} more · ` : null}
          <button type="button" onClick={() => void loadMore()} disabled={loading} className="c-btn-link c-w6">
            {loading ? 'Loading…' : all === null ? 'See all' : 'Show more'}
          </button>
        </p>
      ) : null}
      {failed === null ? null : (
        <p className="c-s14 c-w5" style={{ color: 'var(--bad)' }}>
          {failed}
        </p>
      )}
      <p className="c-s14 c-t2">{endingKeptLine(kind, scope?.from)}</p>
      <p className="c-s14 c-w5" style={{ color: 'var(--warn)' }}>
        {ENDING_NOT_TOLD}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onConfirm} disabled={busy} className="c-btn c-btn-sm c-btn-danger">
          {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {endingConfirmLabel(kind, ending)}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="c-btn c-btn-sm c-btn-s">
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
