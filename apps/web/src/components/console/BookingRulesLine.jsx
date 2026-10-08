import { useEffect, useState } from 'react';
import { orgService } from '../../api/orgsApi';
import { bookingRulesLine, bookingRulesOwnLine } from '../../pages/console/bookingsEndView';
import { canOpenPlace, placeTo } from '../../pages/console/consolePlaces';
import PlaceLink from './PlaceLink';

// THE GYM'S BOOKING RULES, SAID WHERE THEY APPLY (ROADMAP 17e-ii, Kd's click-through: "Class
// bookings rules are hidden in settings how will a business see them ?"). The Classes and
// Personal training pages say when members can book and cancel, with a button that opens
// the box in Settings for whoever may change them. Anybody else reads who can.

/** `freeCancelMinutes`: the one rule a page already holds for staff who may not read the
 *  rest (Personal training); null where it holds none. */
export default function BookingRulesLine({ org, orgSlug, privileges, freeCancelMinutes = null }) {
  const may = canOpenPlace(privileges, 'bookingRules');
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    if (!may) return undefined;
    let live = true;
    // A read that fails leaves the button, which opens the rules themselves.
    Promise.resolve()
      .then(() => orgService.getBookingSettings(org.id))
      .then((res) => {
        if (live) setSettings(res?.data?.settings ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [may, org.id]);

  if (!may) {
    const own = bookingRulesOwnLine(freeCancelMinutes);
    return own === null ? null : <p className="c-s14 c-t2 m-0">{own}</p>;
  }
  return (
    <p className="c-s14 c-t2 m-0 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="booking-rules-line">
      {settings !== null ? <span>{bookingRulesLine(settings)}</span> : null}
      <PlaceLink to={placeTo(orgSlug, 'bookingRules')} className="c-lk c-w6">
        Change booking rules
      </PlaceLink>
    </p>
  );
}
