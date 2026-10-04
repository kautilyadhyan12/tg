import { useEffect, useState } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import DatePick from '../../components/console/DatePick';
import { Tick } from './MemberListUpload';
import { termLine } from './membershipTypesView';
import {
  askWords,
  classesLine,
  datesLine,
  doneWords,
  givePreview,
  isLive,
  paymentLine,
  startRange,
  statusTag,
} from './heldMembershipsView';

// A PERSON'S MEMBERSHIPS, on their page (spec Part 3 §13.2; ROADMAP 17a-ii): what they
// hold from the gym's price list, each with the one or two buttons its state calls for,
// and Add membership. Every date and every "can" is the server's, worked out on the gym's
// own day; a press asks first, in a box under the membership it is about, naming the person.
//
// Drawn only where there is something to show: a gym with no membership types, and a
// person who holds none, see no box at all (a gym that keeps its other software uses
// none of this).
//
// The page draws it with the person as its `key`, so another person is a fresh box: no
// question, notice or form of the one before stays. An answer is kept with the record it
// is about and drawn only for that record.

const TAG_TONES = { green: 'c-tag-good', orange: 'c-tag-warn', plain: 'c-tag-plain' };
const MAIN = 'c-btn c-btn-p';
const PLAIN = 'c-btn c-btn-s';
const SMALL = 'c-btn c-btn-s c-btn-sm';
const DANGER = 'c-btn c-btn-danger';

/** A key the server takes one membership for, however often the request arrives. */
function newRequestKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
}

export default function MemberMemberships({ gymId, entryId, name, readOnly }) {
  /** The answer on screen, and the record it is about: never shown under another. */
  const [held, setHeld] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  /** What is open: null, { what: 'add' } or { what, id } for a question on one membership. */
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    let live = true;
    orgService.getHeldMemberships(gymId, entryId).then(
      (res) => {
        if (live) setHeld({ entryId, ...res.data });
      },
      (err) => {
        if (live) setLoadError(errorText(err, "We couldn't load this person's memberships."));
      },
    );
    return () => {
      live = false;
    };
  }, [gymId, entryId, attempt]);

  const shown = held !== null && held.entryId === entryId ? held : null;

  if (loadError !== null && shown === null) {
    return (
      <section className="c-card px-4 py-3 md:px-5 md:py-4 flex flex-col gap-2" data-testid="held-memberships">
        <h3 className="c-h2">Memberships</h3>
        <p className="c-s14 c-t2 m-0">{loadError}</p>
        <div>
          <button
            type="button"
            className={SMALL}
            onClick={() => {
              setLoadError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      </section>
    );
  }
  if (shown === null) return null;
  /** The gym's price list, as it was when these memberships were read. */
  const types = shown.types;
  // A gym that sells nothing here, and a person holding nothing: no box.
  if (types.length === 0 && shown.memberships.length === 0) return null;

  const today = shown.today;
  const live = shown.memberships.filter(isLive);
  const over = shown.memberships.filter((m) => !isLive(m));
  const canAct = !readOnly && !shown.past;

  /** A write: its answer is kept for the person it was asked about. */
  const run = async (what, m, work) => {
    const asked = entryId;
    setBusy(true);
    setNotice(null);
    setRefusal(null);
    try {
      const res = await work();
      setHeld({ entryId: asked, ...res.data });
      setOpen(null);
      setForm(null);
      setNotice(doneWords(what, m));
    } catch (err) {
      setRefusal(errorText(err, "We couldn't save that. Please try again."));
      // Somebody else changed it first: show it as it is now.
      if (errorCode(err) === 'held_membership_changed' || errorCode(err) === 'membership_type_not_found') {
        setOpen(null);
        setAttempt((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  const change = (what, m, path, body) => run(what, m, () => orgService.changeHeldMembership(gymId, entryId, m.id, path, body));

  const ask = (what, m) => {
    setNotice(null);
    setRefusal(null);
    setOpen({ what, id: m.id });
  };

  const startAdd = () => {
    setNotice(null);
    setRefusal(null);
    setForm({ requestKey: newRequestKey(), typeId: types.length === 1 ? types[0].id : '', startsOn: today, paid: false });
    setOpen({ what: 'add' });
  };

  const close = () => {
    setRefusal(null);
    setOpen(null);
    setForm(null);
  };

  const renderAsk = (m) => {
    const words = askWords(open.what, m, name, today);
    if (words === null) return null;
    const act = {
      paid: () => change('paid', m, 'paid', { paidPeriods: m.view.can.markPaid.paidPeriods }),
      undoPaid: () => change('undoPaid', m, 'paid', { paidPeriods: m.view.can.undoPaid.paidPeriods }),
      freeze: () => change('freeze', m, 'freeze'),
      unfreeze: () => change('unfreeze', m, 'unfreeze'),
      cancel: () => change('cancel', m, 'cancel', { when: 'today' }),
    }[open.what];
    const cancelling = open.what === 'cancel';
    return (
      <div className="rounded-[14px] p-3 flex flex-col gap-2" style={{ background: 'var(--raise)' }} data-testid={`held-ask-${open.what}`}>
        <p className="c-s15 c-w6 c-t1 m-0">{words.question}</p>
        <p className="c-s14 c-t2 m-0">{words.detail}</p>
        <div className="flex flex-wrap gap-2">
          {cancelling && words.laterButton !== null ? (
            <button type="button" className={MAIN} disabled={busy} onClick={() => void change('cancelLater', m, 'cancel', { when: 'period_end' })}>
              {words.laterButton}
            </button>
          ) : null}
          <button type="button" className={cancelling ? DANGER : MAIN} disabled={busy} onClick={() => void act()}>
            {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            {words.button}
          </button>
          <button type="button" className={PLAIN} disabled={busy} onClick={close}>
            {cancelling ? 'Keep it' : 'Back'}
          </button>
        </div>
      </div>
    );
  };

  const renderOne = (m) => {
    const tag = statusTag(m);
    const pay = paymentLine(m, today);
    const classes = classesLine(m);
    const asking = open !== null && open.id === m.id;
    const can = m.view.can;
    return (
      <li key={m.id} className="py-3 flex flex-col gap-1.5" style={{ borderTop: '1px solid var(--line)' }} data-testid="held-membership">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="c-s15 c-w6 c-t1 break-words min-w-0">{m.typeName}</span>
          <span className={`c-tag ${TAG_TONES[tag.tone]} whitespace-nowrap`}>{tag.tag}</span>
        </div>
        <span className="c-s14 c-t2">{termLine(m)}</span>
        <span className="c-s14 c-t2">{[datesLine(m), classes].filter((part) => part !== null).join(' · ')}</span>
        {pay !== null ? (
          <span className="c-s14 c-w5" style={{ color: pay.due ? 'var(--warn)' : 'var(--t1)' }} data-testid="held-payment">
            {pay.text}
          </span>
        ) : null}
        {asking ? (
          renderAsk(m)
        ) : canAct && isLive(m) ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {can.markPaid !== null ? (
              <button type="button" className={SMALL} disabled={busy} onClick={() => ask('paid', m)}>
                Mark paid
              </button>
            ) : null}
            {can.freeze ? (
              <button type="button" className={SMALL} disabled={busy} onClick={() => ask('freeze', m)}>
                Freeze
              </button>
            ) : null}
            {can.unfreeze ? (
              <button type="button" className={SMALL} disabled={busy} onClick={() => ask('unfreeze', m)}>
                Unfreeze
              </button>
            ) : null}
            {can.cancel ? (
              <button type="button" className={SMALL} disabled={busy} onClick={() => ask('cancel', m)}>
                Cancel membership
              </button>
            ) : null}
            {can.undoPaid !== null ? (
              <button type="button" className="c-btn c-btn-link c-btn-sm" disabled={busy} onClick={() => ask('undoPaid', m)}>
                Undo mark paid
              </button>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  };

  const renderAdd = () => {
    const type = types.find((t) => t.id === form.typeId) ?? null;
    const preview = givePreview(type, form.startsOn, form.paid, today);
    const range = startRange(today);
    const ready = type !== null && preview.problem === null;
    return (
      <form
        noValidate
        className="rounded-[14px] p-3 flex flex-col gap-3"
        style={{ background: 'var(--raise)' }}
        data-testid="held-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || busy) return;
          void run('give', null, () =>
            orgService.giveHeldMembership(gymId, entryId, {
              requestKey: form.requestKey,
              typeId: form.typeId,
              startsOn: form.startsOn,
              paid: type.priceMinor === 0 ? false : form.paid,
            }),
          );
        }}
      >
        <p className="c-s15 c-w6 c-t1 m-0">Add a membership for {name}</p>
        {types.length === 0 ? (
          <p className="c-s14 c-t2 m-0">You have no membership types yet. Add them in Settings, under Memberships.</p>
        ) : (
          <>
            <label className="c-field">
              <span className="c-label">Membership type</span>
              <select className="c-sel" value={form.typeId} onChange={(e) => setForm((f) => ({ ...f, typeId: e.target.value }))}>
                {types.length > 1 ? <option value="">Choose one</option> : null}
                {types.map((t) => (
                  <option key={t.id} value={t.id}>{`${t.name} · ${termLine(t)}`}</option>
                ))}
              </select>
            </label>
            <div className="c-field">
              <span className="c-label">Start date</span>
              <DatePick
                newLook
                label="Start date"
                value={form.startsOn}
                min={range.min}
                max={range.max}
                today={today}
                yearSelect
                onChange={(day) => setForm((f) => ({ ...f, startsOn: day }))}
              />
              {preview.line !== null ? (
                <span className="c-hint" data-testid="held-add-line">
                  {preview.line}
                </span>
              ) : null}
              {preview.problem !== null ? (
                <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
                  {preview.problem}
                </span>
              ) : null}
            </div>
            {preview.paidLabel !== null ? (
              <div className="flex flex-col">
                <Tick checked={form.paid} onChange={(paid) => setForm((f) => ({ ...f, paid }))}>
                  {preview.paidLabel}
                </Tick>
                <span className="c-hint">Leave it unticked if they still owe it. You can mark it paid later.</span>
              </div>
            ) : null}
          </>
        )}
        <div className="flex flex-wrap gap-2">
          {types.length > 0 ? (
            <button
              type="submit"
              disabled={busy || !ready}
              className={ready ? MAIN : 'c-btn'}
              style={ready ? undefined : { background: 'var(--card)', color: 'var(--t3)', opacity: 1 }}
            >
              {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Check aria-hidden="true" className="w-4 h-4" />}
              Add membership
            </button>
          ) : null}
          <button type="button" className={PLAIN} disabled={busy} onClick={close}>
            Back
          </button>
        </div>
      </form>
    );
  };

  return (
    <section className="c-card px-4 py-3 md:px-5 md:py-4 flex flex-col gap-2" data-testid="held-memberships">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="c-h2 flex-1 min-w-0">Memberships</h3>
        {canAct && open === null ? (
          <button type="button" className={SMALL} onClick={startAdd} disabled={busy}>
            <Plus aria-hidden="true" className="w-4 h-4" />
            Add membership
          </button>
        ) : null}
      </div>
      {shown.past && shown.memberships.length > 0 ? (
        <p className="c-s14 c-t2 m-0" data-testid="held-past-note">
          {`${name.charAt(0).toUpperCase()}${name.slice(1)} is a past member, so these are not in use. Put them back on your list to use them again.`}
        </p>
      ) : null}
      {notice !== null ? (
        <p className="c-s14 c-w5 m-0 flex items-center gap-2" style={{ color: 'var(--good)' }} role="status">
          <Check aria-hidden="true" className="w-4 h-4" />
          {notice}
        </p>
      ) : null}
      {refusal !== null ? (
        <p className="c-s14 c-t1 m-0 rounded-[14px] p-3" style={{ background: 'var(--bad-bg)' }} role="alert">
          {refusal}
        </p>
      ) : null}
      {open !== null && open.what === 'add' && form !== null ? renderAdd() : null}
      {live.length === 0 && over.length === 0 && open === null ? <p className="c-s14 c-t3 m-0">No membership yet.</p> : null}
      {live.length > 0 ? <ul className="m-0 p-0 list-none flex flex-col">{live.map(renderOne)}</ul> : null}
      {over.length > 0 ? (
        <div className="flex flex-col">
          <button
            type="button"
            className="c-btn c-btn-link c-btn-sm self-start"
            aria-expanded={showPast}
            onClick={() => setShowPast((v) => !v)}
          >
            {showPast ? 'Hide' : 'Show'}{' '}
            {over.length + shown.earlierNotShown === 1 ? '1 earlier membership' : `${String(over.length + shown.earlierNotShown)} earlier memberships`}
          </button>
          {showPast ? <ul className="m-0 p-0 list-none flex flex-col">{over.map(renderOne)}</ul> : null}
          {showPast && shown.earlierNotShown > 0 ? (
            <p className="c-s13 c-t3 m-0" data-testid="held-older">
              {shown.earlierNotShown === 1 ? '1 older one is not shown.' : `${String(shown.earlierNotShown)} older ones are not shown.`}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
