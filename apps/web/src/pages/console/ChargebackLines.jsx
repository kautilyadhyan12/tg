import { useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { chargebacksService } from '../../api/chargebacksApi';
import { errorText } from '../../api/orgsApi';
import { START_NAMES_SHOWN, SQUARE_DISPUTES_URL, chargebackStartBox, chargebackStartedWords } from './chargebackView';
import { placeFor } from './consolePlaces';
import { viewerPrivileges } from './consoleView';

/** After a lost chargeback: the box names who will be charged, and only its own button starts anything. */
function StartCharges({ gymId, id, onStarted }) {
  const [preview, setPreview] = useState(null);
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const [error, setError] = useState(null);
  const open = async () => {
    setOpening(true);
    setError(null);
    try {
      setPreview(await chargebacksService.startPreview(gymId, id));
    } catch (err) {
      setError(errorText(err, 'That could not be opened. Try again.'));
    } finally {
      setOpening(false);
    }
  };
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await chargebacksService.start(gymId, id);
      await onStarted({ id, line: chargebackStartedWords(preview) });
    } catch (err) {
      setError(errorText(err, 'Automatic payments were not resumed. Try again.'));
      setBusy(false);
    }
  };
  if (preview === null) {
    return (
      <div className="flex flex-col gap-1.5">
        <button type="button" className="c-btn c-btn-s c-btn-sm self-start" disabled={opening} onClick={open}>
          Resume automatic payments
        </button>
        {error !== null ? <span className="c-s13" style={{ color: 'var(--warn)' }} role="alert">{error}</span> : null}
      </div>
    );
  }
  const box = chargebackStartBox(preview);
  const shown = all ? box.people : box.people.slice(0, START_NAMES_SHOWN);
  const more = box.people.length - shown.length;
  return (
    <div className="flex flex-col gap-2 rounded-lg p-3" style={{ border: '1px solid var(--line)' }} data-testid="chargeback-start-box">
      <span className="c-s13 c-w6 c-t1">{box.title}</span>
      <span className="c-s13 c-t2">{box.lead}</span>
      {shown.map((person, at) => (
        <span key={`${String(at)} ${person}`} className="c-s13 c-t1">
          {person}
        </span>
      ))}
      {more > 0 ? (
        <button type="button" className="c-s13 c-w6 c-t1 self-start" style={{ textDecoration: 'underline' }} onClick={() => setAll(true)}>
          {`and ${String(more)} more. See all`}
        </button>
      ) : null}
      {box.note !== null ? <span className="c-s13 c-t2">{box.note}</span> : null}
      {error !== null ? <span className="c-s13" style={{ color: 'var(--warn)' }} role="alert">{error}</span> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="c-btn c-btn-p c-btn-sm" disabled={busy} onClick={start}>
          {box.button}
        </button>
        <button type="button" className="c-btn c-btn-s c-btn-sm" disabled={busy} onClick={() => setPreview(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// A chargeback under its payment or sale (ROADMAP 18d-iv-e-i). The gym answers in Square, so its button opens Square's own page.
// `gymId` and `onStarted`: staff who may charge cards can start automatic charges again after a lost one.
export default function ChargebackLines({ lines, gymId = null, onStarted = null, said = null }) {
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
          {line.canStart && gymId !== null && onStarted !== null ? <StartCharges gymId={gymId} id={line.id} onStarted={onStarted} /> : null}
          {said?.id === line.id ? (
            <span className="c-s14 c-w5" style={{ color: 'var(--good)' }} role="status" data-testid="chargeback-started">
              {said.line}
            </span>
          ) : null}
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
