import { useEffect, useState } from 'react';
import { orgService } from '../../api/orgsApi';
import {
  NOBODY_BOOKED,
  bookedHeading,
  bookingRow,
  lateHeading,
  listRefusal,
  waitlistHeading,
} from '../../pages/console/classBookingsListView';

// WHO IS BOOKED ON ONE CLASS (spec Part 3 §13.6; ROADMAP 17c-iii), under the class the
// Calendar opened: who holds a place, the waitlist in its order, and the late cancels.
// `version` changes when the class was saved, so the list is read again.

function People({ heading, rows, numbered = false }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className="c-s13 c-w6 c-t3">{heading}</div>
      <ol className="m-0 p-0 list-none flex flex-col gap-1.5">
        {rows.map((booking, index) => {
          const row = bookingRow(booking);
          return (
            <li key={booking.bookingId} className="min-w-0 flex gap-2">
              {numbered ? <span className="c-s14 c-t3 c-num">{index + 1}.</span> : null}
              <span className="min-w-0">
                <span className="c-s15 c-t1 block c-ell">{row.name}</span>
                {row.detail === '' ? null : <span className="c-s13 c-t3 block c-ell">{row.detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function ClassBookingsList({ gymId, sessionId, version = 0 }) {
  /** The answer, and the class and version it is of: never drawn under another. */
  const [read, setRead] = useState(null);
  const key = `${sessionId}:${String(version)}`;

  useEffect(() => {
    let live = true;
    orgService.getClassBookings(gymId, sessionId).then(
      (res) => {
        if (live) setRead({ key, list: res.data, failed: null });
      },
      (err) => {
        if (live) setRead({ key, list: null, failed: listRefusal(err) });
      },
    );
    return () => {
      live = false;
    };
  }, [gymId, sessionId, key]);

  const shown = read !== null && read.key === key ? read : null;
  if (shown === null) return <p className="c-s14 c-t3 m-0">Loading who is booked…</p>;
  if (shown.failed !== null) {
    return (
      <p className="c-s14 c-t2 m-0" data-testid="class-bookings-refused">
        {shown.failed}
      </p>
    );
  }
  const { list } = shown;
  const empty = list.booked.length === 0 && list.waitlisted.length === 0 && list.lateCancelledTotal === 0;
  return (
    <div
      role="group"
      aria-label="Who is booked"
      data-testid="class-bookings"
      className="flex flex-col gap-4 pt-3"
      style={{ borderTop: '1px solid var(--line)', maxHeight: 360, overflowY: 'auto' }}
    >
      {empty ? <p className="c-s14 c-t2 m-0">{NOBODY_BOOKED}</p> : null}
      {empty ? null : <People heading={bookedHeading(list)} rows={list.booked} />}
      {list.waitlisted.length > 0 ? <People heading={waitlistHeading(list)} rows={list.waitlisted} numbered /> : null}
      {list.lateCancelledTotal > 0 ? <People heading={lateHeading(list)} rows={list.lateCancelled} /> : null}
    </div>
  );
}
