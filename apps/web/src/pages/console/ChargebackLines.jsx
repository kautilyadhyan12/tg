import { Link, useInRouterContext } from 'react-router-dom';
import { SQUARE_DISPUTES_URL } from './chargebackView';
import { placeFor } from './consolePlaces';
import { viewerPrivileges } from './consoleView';

// A chargeback under its payment or sale (ROADMAP 18d-iv-e-i). The gym answers in Square, so the one button opens Square's own page.
export default function ChargebackLines({ lines }) {
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {lines.map((line) => (
        <div key={line.id} className="flex flex-col gap-1.5 pl-3" style={{ borderLeft: `2px solid ${line.over ? 'var(--raise-line)' : 'var(--warn)'}` }} data-testid="chargeback">
          <span className="c-s13 c-w6" style={line.over ? undefined : { color: 'var(--warn)' }}>
            {line.title}
          </span>
          <span className="c-s13 c-t2">{line.detail}</span>
          <a className="c-btn c-btn-s c-btn-sm self-start" href={SQUARE_DISPUTES_URL} target="_blank" rel="noreferrer">
            {line.button}
          </a>
        </div>
      ))}
    </div>
  );
}

/** The person whose chargeback holds this bill back, where that is somebody else: their page holds it. */
export function ChargeStopHolder({ holder, gym }) {
  const routed = useInRouterContext();
  const to = routed && holder !== null ? placeFor(gym?.slug, viewerPrivileges(gym), 'members') : null;
  if (to === null) return null;
  return (
    <Link to={`${to}?person=${encodeURIComponent(holder.entryId)}`} className="c-s13 c-w6 c-t1" style={{ textDecoration: 'underline' }}>
      {`Open ${holder.name}'s page`}
    </Link>
  );
}
