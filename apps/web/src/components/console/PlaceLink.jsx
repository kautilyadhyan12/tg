import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';

// A BUTTON THAT OPENS ANOTHER PLACE IN THE CONSOLE (ROADMAP 23d), for a sentence that
// sends somebody there. `to` comes from `consolePlaces.js`; with none, nothing is drawn.
//
// `beside` opens it in a new tab, for a form or a box that would lose what is typed or
// ticked if the page were left (as Add member's "Set up memberships" does).

export default function PlaceLink({ to, beside = false, className = 'c-btn c-btn-s c-btn-sm self-start', onClick, children, ...rest }) {
  if (typeof to !== 'string' || to === '') return null;
  if (beside) {
    return (
      <a href={to} target="_blank" rel="noreferrer" className={className} onClick={onClick} {...rest}>
        {children}
        <ExternalLink aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    );
  }
  return (
    <Link to={to} className={className} onClick={onClick} {...rest}>
      {children}
    </Link>
  );
}
