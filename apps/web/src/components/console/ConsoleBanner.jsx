import { useState } from 'react';
import { AlertTriangle, Clock, CreditCard, Users, X } from 'lucide-react';
import { bannerFor, bannerIsDismissed, dismissBanner } from '../../pages/console/billingView';
import { viewerPrivileges } from '../../pages/console/consoleView';
import { PLAN_SECTION, placeFor } from '../../pages/console/consolePlaces';
import PlaceLink from './PlaceLink';

// Part 3 §4.2's "persistent trial/renewal banner slot [that] sits above all
// screens" (`03-part3-org-console.md:159`). It lives in `ConsoleLayout` for that
// reason and not on any one screen: a trial ending is not a fact about the
// Overview, and an owner who happens to be reading the roster is exactly the
// person it needs to reach.
//
// EVERY WORD IT DRAWS COMES FROM `billingView.js`, which is where the states,
// their order and the reason each sentence is complete without a button are
// written down. This file is colour and a close control.
//
// IT DRAWS NOTHING FOR AN UNKNOWN STATE, and that is the whole of its error
// handling. There is no loading spinner and no failure card here: the shell
// deliberately owns neither (its own comment says the screen inside reads the
// same store and owns the error), and a banner is not the place to report that a
// read failed. No answer means no strip — the screen below says what happened.

/** The three tones §4.2 distinguishes: red for something that has already
 *  happened and is costing the gym now, amber for a deadline or a wall, plain
 *  for something an owner merely wants to know. Kept here rather than in the
 *  view module because a colour is not a decision about what is true.
 *
 *  Each is a class of `console.css` whose colours are the look's own names
 *  (spec Part 3 §17.3), so the banner reads in the light look as in the dark. */
const TONES = {
  danger: 'c-banner-danger',
  warn: 'c-banner-warn',
  info: 'c-banner-info',
};

/** Its picture, as the board `Banners` draws each: a warning for a gym shut, a card for a payment,
 *  a clock for the trial, people for a nearly full plan. */
const ICONS = {
  read_only: AlertTriangle,
  past_due: CreditCard,
  trial_urgent: Clock,
  seat_pressure: Users,
  trial_info: Clock,
};

export default function ConsoleBanner({ org }) {
  // A dismissal is remembered in per-user storage, so this state exists only to
  // re-render the moment it is pressed. Seeded from storage on mount, which is
  // what makes the banner stay away across a navigation within the same day.
  const [closedAt, setClosedAt] = useState(0);

  const banner = bannerFor(org);
  if (banner === null) return null;

  const gymId = org?.id ?? null;
  if (
    banner.dismissible &&
    gymId !== null &&
    // `closedAt` is read so this re-computes after the press; the answer itself
    // comes from storage, which is the copy that survives a navigation.
    (closedAt > 0 || bannerIsDismissed(gymId, banner.key))
  ) {
    return null;
  }

  const tone = TONES[banner.tone] ?? TONES.info;
  const Icon = ICONS[banner.key] ?? AlertTriangle;

  // A rounded box at the top of the page, its words beside its picture and its buttons at the end;
  // on a phone the button goes under the words (the board `Banners`, V5-c).
  return (
    <div className="c-banner-at">
      <div role="status" data-testid="console-banner" className={`c-banner ${tone}`}>
        <Icon aria-hidden="true" className="c-banner-ic" />
        <p className="c-banner-text c-s14 c-t1 m-0">{banner.text}</p>
        {banner.place || (banner.dismissible && gymId !== null) ? (
          <div className="c-banner-acts">
            {/* A sentence that sends the reader to Plan has a button that opens it (23d). */}
            {banner.place ? (
              <PlaceLink
                to={placeFor(org?.slug, viewerPrivileges(org), banner.place)}
                className="c-btn c-btn-sm c-btn-s"
                // Already on the Overview, at this address: the address does not change, so
                // nothing would move. The plan is brought into view by the press itself.
                onClick={() => document.getElementById(PLAN_SECTION)?.scrollIntoView?.({ block: 'start' })}
              >
                Open Plan
              </PlaceLink>
            ) : null}
            {banner.dismissible && gymId !== null ? (
              <button
                type="button"
                /* "Dismiss" and not "Close": it comes back tomorrow (§4.2's
                   "dismissible/day"), and a label promising it is gone for good would
                   be the small false thing this console keeps being audited for. */
                aria-label="Dismiss until tomorrow"
                onClick={() => {
                  dismissBanner(gymId, banner.key);
                  setClosedAt(Date.now());
                }}
                className="c-icon-btn c-t2"
              >
                <X aria-hidden="true" className="w-5 h-5" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
