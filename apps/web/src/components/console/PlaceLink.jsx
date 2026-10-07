import { useState } from 'react';
import { Link } from 'react-router-dom';

// A BUTTON THAT OPENS ANOTHER PLACE IN THE CONSOLE (ROADMAP 23d), for a sentence that
// sends somebody there. `to` comes from `consolePlaces.js`; with none, nothing is drawn.
//
// It opens in this same tab, as a link inside an app does (Kd at 23d's click-through: new
// tabs "become a pile of tabs"). `guard`: the button sits in a form or a box holding
// something typed that leaving would lose, so the press asks first, in place.

export default function PlaceLink({ to, guard = false, className = 'c-btn c-btn-s c-btn-sm self-start', children, ...rest }) {
  const [asking, setAsking] = useState(false);
  if (typeof to !== 'string' || to === '') return null;
  if (!guard) {
    return (
      <Link to={to} className={className} {...rest}>
        {children}
      </Link>
    );
  }
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className={className} {...rest}>
        {children}
      </button>
    );
  }
  return (
    <span className="flex flex-col gap-2 self-start" role="group" aria-label="Leave this page?">
      <span className="c-s14 c-t1">You&apos;ll leave this page, and what you typed here won&apos;t be saved.</span>
      <span className="flex flex-wrap gap-2">
        <Link to={to} className="c-btn c-btn-s c-btn-sm">
          Leave this page
        </Link>
        <button type="button" onClick={() => setAsking(false)} className="c-btn c-btn-s c-btn-sm">
          Stay here
        </button>
      </span>
    </span>
  );
}
