import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { Check, Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { viewerPrivileges } from './consoleView';
import { placeFor } from './consolePlaces';
import { consoleIsReadOnly } from './billingView';
import { useLiveNews } from './liveNews';
import { canMatchPayments } from './paymentsToMatchAccess';
import { SQUARE_LINKS_TITLE, linkLine, unlinkBoxLines, unlinkedLine } from './memberSquareLinksView';

// SQUARE CUSTOMER LIST, ON A PERSON'S PAGE (ROADMAP 18d-iii-b-ii-c-ii; spec Part 3 §14.8), for staff who match payments: the
// customers Match linked to this person, each with Unlink. Unlink opens a box under the button that says, before anything
// changes, who the customer is in Square, which waiting payments go back to Payments to match, the card that is stopped and
// what stays; the press carries the card the box named. What was done is said in that same place. Shown only where Match
// linked somebody: a person with none has nothing here. A link made by Match on another screen shows here by itself (live
// news about this person's payments), as their payments waiting do.

const PLAIN = 'c-btn c-btn-s';
const SMALL = 'c-btn c-btn-s c-btn-sm';
const BAD = { color: 'var(--bad)' };

/** Unlink asks first, under the button, with what changes read from the server. */
function UnlinkAsk({ ask, name, onYes, onBack }) {
  if (ask.box === null) {
    return (
      <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: 'var(--raise)' }} data-testid="unlink-ask">
        {ask.problem === null ? (
          <p className="c-s14 c-t2 m-0 flex items-center gap-2" role="status">
            <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
            Checking what changes…
          </p>
        ) : (
          <p className="c-s14 m-0" style={BAD} role="alert">
            {ask.problem}
          </p>
        )}
        <div>
          <button type="button" className={PLAIN} onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    );
  }
  const words = unlinkBoxLines(ask.box, name);
  return (
    <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: 'var(--raise)' }} data-testid="unlink-ask">
      <p className="c-s15 c-w6 c-t1 m-0">{words.question}</p>
      {words.lines.map((line) => (
        <p key={line} className="c-s14 c-t2 m-0">
          {line}
        </p>
      ))}
      {ask.problem !== null ? (
        <p className="c-s14 m-0" style={BAD} role="alert">
          {ask.problem}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="c-btn c-btn-danger" disabled={ask.busy} onClick={onYes}>
          {ask.busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Check aria-hidden="true" className="w-4 h-4" />}
          Unlink
        </button>
        <button type="button" className={PLAIN} disabled={ask.busy} onClick={onBack}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** `onUnlinked`: told once a customer is unlinked, so the page reads their card on file and payments again. */
export default function MemberSquareLinks({ gymId, gym, entryId, name, readOnly, onUnlinked = null }) {
  const privileges = viewerPrivileges(gym);
  const allowed = canMatchPayments(privileges);
  const routed = useInRouterContext();
  const toMatchTo = routed ? placeFor(gym?.slug, privileges, 'paymentsToMatch') : null;
  const [state, setState] = useState({ entryId: null, links: [], error: null });
  /** The Unlink box open, for this page's person alone: the customer, what changes, and the press's own key. */
  const [ask, setAsk] = useState(null);
  const [done, setDone] = useState(null);
  const who = name || 'this person';

  /** Each read's turn: an answer older than the one drawn never takes its place. */
  const readSeq = useRef(0);
  const drawnSeq = useRef(0);
  const read = useCallback(() => {
    const asked = ++readSeq.current;
    orgService.getSquareLinks(gymId, entryId).then(
      (res) => {
        if (asked <= drawnSeq.current) return;
        drawnSeq.current = asked;
        setState({ entryId, links: res.data.links, error: null });
      },
      (err) => {
        if (asked <= drawnSeq.current) return;
        drawnSeq.current = asked;
        setState({ entryId, links: [], error: errorText(err, "We couldn't load their Square customer list.") });
      },
    );
  }, [gymId, entryId]);
  useEffect(() => {
    if (allowed) read();
  }, [allowed, read]);
  useLiveNews(
    gymId,
    (message) => {
      if (message.what === 'ready' || message.what === 'cameBack' || (message.what === 'memberships' && message.entryId === entryId)) read();
    },
    allowed,
  );

  const readBox = useCallback(
    (customerId, problem = null) => {
      setAsk({ entryId, customerId, box: null, problem: null, busy: false, requestKey: globalThis.crypto.randomUUID() });
      orgService.getUnlinkBox(gymId, entryId, customerId).then(
        (res) => setAsk((a) => (a !== null && a.entryId === entryId && a.customerId === customerId ? { ...a, box: res.data, problem } : a)),
        (err) =>
          setAsk((a) => (a !== null && a.entryId === entryId && a.customerId === customerId ? { ...a, problem: errorText(err, "We couldn't check what Unlink changes. Try again.") } : a)),
      );
    },
    [gymId, entryId],
  );

  if (!allowed || state.entryId !== entryId) return null;
  if (state.links.length === 0 && state.error === null && (done === null || done.entryId !== entryId)) return null;
  const changing = !readOnly && !consoleIsReadOnly(gym);
  const opened = ask !== null && ask.entryId === entryId ? ask : null;

  const unlink = async () => {
    if (opened === null || opened.box === null) return;
    setAsk({ ...opened, busy: true, problem: null });
    try {
      const res = await orgService.unlinkSquareCustomer(gymId, entryId, opened.customerId, { requestKey: opened.requestKey, card: opened.box.card });
      drawnSeq.current = ++readSeq.current;
      setState({ entryId, links: res.data.links, error: null });
      setAsk(null);
      setDone({ entryId, line: unlinkedLine(res.data.unlinked, who), moved: res.data.unlinked.moved });
      onUnlinked?.();
    } catch (err) {
      // A card saved since the box was read: the box is read again, saying why.
      if (err?.response?.data?.error === 'square_unlink_changed') {
        readBox(opened.customerId, errorText(err, 'This has changed since you opened it. Check the box again, then unlink.'));
        return;
      }
      setAsk({ ...opened, busy: false, problem: errorText(err, "We couldn't unlink this customer. Try again.") });
    }
  };

  return (
    <section className="c-card px-4 py-3 md:px-5 md:py-4 flex flex-col gap-2" aria-label={SQUARE_LINKS_TITLE} data-testid="square-links">
      <h3 className="c-h2">{SQUARE_LINKS_TITLE}</h3>
      {state.error !== null ? <p className="c-s14 c-t2 m-0">{state.error}</p> : null}
      {done !== null && done.entryId === entryId ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="c-s14 c-t1 c-w6 m-0" role="status">
            {done.line}
          </p>
          {done.moved > 0 && toMatchTo !== null ? (
            <Link to={toMatchTo} className={SMALL}>
              Open Payments to match
            </Link>
          ) : null}
        </div>
      ) : null}
      {state.links.map((link) => (
        <div key={link.customerId} className="flex flex-col gap-2" data-testid="square-link">
          <p className="c-s15 c-t1 m-0">{linkLine(link, gym?.timezone)}</p>
          {opened?.customerId === link.customerId ? (
            <UnlinkAsk ask={opened} name={who} onYes={() => void unlink()} onBack={() => setAsk(null)} />
          ) : changing ? (
            <div>
              <button
                type="button"
                className={SMALL}
                onClick={() => {
                  setDone(null);
                  readBox(link.customerId);
                }}
              >
                Unlink
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}
