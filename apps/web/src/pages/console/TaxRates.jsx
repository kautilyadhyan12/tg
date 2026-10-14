import { useId, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { registerService } from '../../api/registerApi';
import { errorText } from '../../api/orgsApi';
import { ConfirmInline } from '../../components/console/ConsoleStates';
import { Refusal } from './MemberListTags';
import { SavedNote } from './SellProducts';
import {
  RATE_CHANGE_NOTE,
  RATE_HINT,
  TOO_MANY_RATES,
  chargeChoices,
  chargedWords,
  draftFromRate,
  emptyRateDraft,
  rateBody,
  rateLabel,
  rateProblems,
  rateRemoveBlock,
  rateUses,
  taxLine,
  taxModes,
} from './sellView';
import { TAX_RATES_MAX } from '@app/shared';

// TAX (spec Part 3 §14.3; ROADMAP 18b-iii): the gym's named tax rates and whether its prices
// hold the tax, one box drawn on Sell and on Memberships, since products and memberships
// both charge them. Changed by staff who may change prices; everybody else reads it.
// `addAsk` is a number a button elsewhere raises to open the Add form. `use` is what this
// page sells, and what each rate's Choose box ticks: the products on Sell, the membership
// types on Memberships. A rate just added opens that box by itself (Kd's click-through: a
// rate added and charged on nothing read as if it were done).

const LINE = { borderTop: '1px solid var(--line)' };
const BAD = { color: 'var(--bad)' };

/** `nested`: drawn inside another form, so it is a group, not a form of its own, and Enter
 *  saves the rate rather than the form around it. */
function RateForm({ draft, setDraft, busy, error, onSave, onCancel, nested = false }) {
  const problems = draft.pressed ? rateProblems(draft) : {};
  const id = useId();
  const set = (patch) => setDraft((was) => ({ ...was, ...patch }));
  const Box = nested ? 'div' : 'form';
  const how = nested
    ? {
        role: 'group',
        onKeyDown: (e) => {
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            onSave();
          }
        },
      }
    : {
        onSubmit: (e) => {
          e.preventDefault();
          onSave();
        },
      };
  return (
    <Box className="flex flex-col gap-4 p-4" style={{ border: '1px solid var(--line)', borderRadius: 12 }} aria-label={draft.id === null ? 'Add a tax rate' : 'Change tax rate'} {...how}>
      <div className="c-field">
        <label className="c-label" htmlFor={`${id}-name`}>
          Tax name
        </label>
        <input id={`${id}-name`} className="c-input" style={{ maxWidth: 280 }} value={draft.name} maxLength={60} disabled={busy} onChange={(e) => set({ name: e.target.value })} placeholder="GST" />
        {problems.name ? <p className="c-s14 m-0" style={BAD}>{problems.name}</p> : null}
      </div>
      <div className="c-field">
        <label className="c-label" htmlFor={`${id}-rate`}>
          Rate, in percent
        </label>
        <input id={`${id}-rate`} className="c-input" style={{ maxWidth: 160 }} inputMode="decimal" value={draft.rate} disabled={busy} onChange={(e) => set({ rate: e.target.value })} placeholder="18" />
        {problems.rate ? <p className="c-s14 m-0" style={BAD}>{problems.rate}</p> : null}
      </div>
      <p className="c-s13 c-t3 m-0">{draft.id === null ? RATE_HINT : RATE_CHANGE_NOTE}</p>
      <div className="flex flex-wrap gap-2">
        <button type={nested ? 'button' : 'submit'} className="c-btn c-btn-p c-btn-lg" disabled={busy} onClick={nested ? onSave : undefined}>
          {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {busy ? 'Saving…' : draft.id === null ? 'Add tax rate' : 'Save tax rate'}
        </button>
        <button type="button" className="c-btn c-btn-s c-btn-lg" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error !== null ? <Refusal>{error}</Refusal> : null}
    </Box>
  );
}

/** A tax rate added from inside another form (a product's, a membership type's): the box
 *  opens where Add a tax rate was pressed, and the new rate is picked there at once.
 *  `onPage` takes the Sell page the server answers with; `onAdded` the new rate. */
export function NewRateInline({ gymId, onPage = null, onAdded, onCancel }) {
  const [draft, setDraft] = useState(emptyRateDraft);
  const [state, setState] = useState({ busy: false, error: null });
  const save = async () => {
    if (Object.keys(rateProblems(draft)).length > 0) {
      setDraft((was) => ({ ...was, pressed: true }));
      return;
    }
    const body = rateBody(draft);
    setState({ busy: true, error: null });
    try {
      const page = await registerService.addTaxRate(gymId, body);
      const made = page.tax.rates.find((r) => r.name.toLowerCase() === body.name.toLowerCase());
      if (onPage !== null) onPage(page);
      setState({ busy: false, error: null });
      if (made !== undefined) onAdded(made);
    } catch (err) {
      setState({ busy: false, error: errorText(err, "We couldn't add that tax rate. Try again.") });
    }
  };
  return <RateForm nested draft={draft} setDraft={setDraft} busy={state.busy} error={state.error} onSave={() => void save()} onCancel={onCancel} />;
}

/** Tick what charges one rate: the gym's membership types, or its products. */
function ChargeBox({ gymId, page, rate, use, onPage, onDone, onCancel }) {
  const choices = chargeChoices(page, rate, use);
  const [ticked, setTicked] = useState(() => new Set(choices.filter((c) => c.on).map((c) => c.id)));
  const [state, setState] = useState({ busy: false, error: null });
  const what = use === 'memberships' ? 'memberships' : 'products';
  const toggle = (id) =>
    setTicked((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const save = async () => {
    setState({ busy: true, error: null });
    try {
      const ids = choices.filter((c) => ticked.has(c.id)).map((c) => c.id);
      const now = await registerService.chargeTaxRate(gymId, rate.id, { use, ids });
      onPage(now);
      onDone(chargedWords(rate, choices.filter((c) => ticked.has(c.id)).map((c) => c.name), use));
    } catch (err) {
      setState({ busy: false, error: errorText(err, "We couldn't save that. Try again.") });
    }
  };
  return (
    <div className="flex flex-col gap-3 p-4" style={{ border: '1px solid var(--line)', borderRadius: 12 }} role="group" aria-label={`What charges ${rateLabel(rate)}`}>
      <p className="c-s15 c-w6 c-t1 m-0">{`Which ${what} charge ${rateLabel(rate)}?`}</p>
      {choices.length === 0 ? (
        <p className="c-s14 c-t2 m-0">{use === 'memberships' ? 'You have no membership types yet. Add one to the price list above first.' : 'You have no products yet. Add one under Products first.'}</p>
      ) : (
        <ul className="list-none m-0 p-0 flex flex-col">
          {choices.map((c) => (
            <li key={c.id}>
              <label className="flex items-start gap-3 c-s15 c-t1 py-2" style={{ minHeight: 44 }}>
                <input type="checkbox" className="mt-1" checked={ticked.has(c.id)} disabled={state.busy} onChange={() => toggle(c.id)} />
                <span className="flex flex-col">
                  {c.name}
                  {c.note !== null ? <span className="c-s13 c-t3">{c.note}</span> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {use === 'memberships' ? <p className="c-s13 c-t3 m-0">Members who already hold a membership keep the tax it was sold with. New memberships charge what you tick here.</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="c-btn c-btn-p c-btn-lg" disabled={state.busy || choices.length === 0} onClick={() => void save()}>
          {state.busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {state.busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="c-btn c-btn-s c-btn-lg" disabled={state.busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {state.error !== null ? <Refusal>{state.error}</Refusal> : null}
    </div>
  );
}

function TaxMode({ gymId, page, locked, onPage }) {
  const was = page.tax.included ? 'included' : 'added';
  const [mode, setMode] = useState(was);
  const [state, setState] = useState({ saving: false, error: null, saved: false });
  const group = useId();
  const changed = mode !== was;
  const save = async () => {
    setState({ saving: true, error: null, saved: false });
    try {
      const now = await registerService.saveTaxMode(gymId, { included: mode === 'included' });
      setState({ saving: false, error: null, saved: true });
      onPage(now);
    } catch (err) {
      setState({ saving: false, error: errorText(err, "We couldn't save that. Try again."), saved: false });
    }
  };
  return (
    <div className="flex flex-col gap-3 pt-4" style={LINE}>
      <fieldset className="flex flex-col gap-1" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="c-label">How the tax is charged</legend>
        {taxModes(page.currency, page.tax.rates[0] ?? null).map((m) => (
          <label key={m.value} className="flex items-start gap-3 c-s15 c-t1 py-2">
            <input
              type="radio"
              className="mt-1"
              name={group}
              value={m.value}
              checked={mode === m.value}
              disabled={locked || state.saving}
              onChange={() => {
                setMode(m.value);
                setState({ saving: false, error: null, saved: false });
              }}
            />
            <span className="flex flex-col">
              {m.label}
              <span className="c-s13 c-t3">{m.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="c-btn c-btn-p c-btn-lg" disabled={locked || !changed || state.saving} onClick={() => void save()}>
          {state.saving ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {state.saving ? 'Saving…' : 'Save'}
        </button>
        <p className="c-s13 c-t3 m-0" role="status">
          {state.saved && !changed ? 'Saved. New sales and bills use this; the ones already made keep theirs.' : changed ? 'Not saved yet.' : ''}
        </p>
      </div>
      {state.error !== null ? <Refusal>{state.error}</Refusal> : null}
    </div>
  );
}

export default function TaxRates({ gymId, page, locked, lockedNote = null, addAsk = 0, use = 'products', onPage }) {
  const canManage = page.canManage;
  const rates = page.tax.rates;
  const full = rates.length >= TAX_RATES_MAX;
  const [draft, setDraft] = useState(null);
  const [state, setState] = useState({ busy: false, error: null, done: null });
  const [asking, setAsking] = useState(null);
  const [choosing, setChoosing] = useState(null);
  // The rate the last sentence said is about: it is said under that rate, where its box was.
  const [noteAt, setNoteAt] = useState(null);
  const chooseWord = use === 'memberships' ? 'Choose memberships' : 'Choose products';

  // A button elsewhere on the page asked for the Add form: open it once for each ask.
  const [asked, setAsked] = useState(0);
  if (addAsk !== asked) {
    setAsked(addAsk);
    if (draft === null && canManage && !locked && !full) setDraft(emptyRateDraft());
  }

  const clear = () => {
    setNoteAt(null);
    setState({ busy: false, error: null, done: null });
  };
  const run = async (work, done) => {
    setNoteAt(null);
    setState({ busy: true, error: null, done: null });
    try {
      onPage(await work());
      setState({ busy: false, error: null, done });
      return true;
    } catch (err) {
      setState({ busy: false, error: errorText(err, "We couldn't save that. Try again."), done: null });
      registerService.get(gymId).then(onPage, () => undefined);
      return false;
    }
  };
  const save = async () => {
    if (draft === null) return;
    if (Object.keys(rateProblems(draft)).length > 0) {
      setDraft((was) => ({ ...was, pressed: true }));
      return;
    }
    const body = rateBody(draft);
    const label = rateLabel(body);
    if (draft.id === null) {
      // A new rate charges nothing yet: its Choose box opens under it straight away.
      setState({ busy: true, error: null, done: null });
      try {
        const now = await registerService.addTaxRate(gymId, body);
        onPage(now);
        const made = now.tax.rates.find((r) => r.name.toLowerCase() === body.name.toLowerCase());
        setState({ busy: false, error: null, done: `${label} added. Now tick what charges it.` });
        setDraft(null);
        setNoteAt(made === undefined ? null : made.id);
        if (made !== undefined) setChoosing(made.id);
      } catch (err) {
        setState({ busy: false, error: errorText(err, "We couldn't save that. Try again."), done: null });
      }
      return;
    }
    const ok = await run(() => registerService.changeTaxRate(gymId, draft.id, body), `${label} saved. ${RATE_CHANGE_NOTE}`);
    if (ok) setDraft(null);
  };
  const cancel = () => {
    setDraft(null);
    clear();
  };

  return (
    <section className="c-card p-4 md:p-5 flex flex-col gap-4" aria-label="Tax" id="tax">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="c-h2">Tax</h2>
        {canManage && draft === null ? (
          <button type="button" className="c-btn c-btn-s c-btn-lg" disabled={locked || full || state.busy} onClick={() => { setDraft(emptyRateDraft()); setAsking(null); clear(); }}>
            <Plus aria-hidden="true" className="w-4 h-4" />
            Add a tax rate
          </button>
        ) : null}
      </div>
      <p className="c-s14 c-t2 m-0">{taxLine(page.tax)}</p>
      {canManage && locked && lockedNote !== null ? <p className="c-s14 c-t3 m-0">{lockedNote}</p> : null}
      {canManage && full ? <p className="c-s14 c-t3 m-0">{TOO_MANY_RATES}</p> : null}

      {draft !== null && draft.id === null ? <RateForm draft={draft} setDraft={setDraft} busy={state.busy} error={state.error} onSave={() => void save()} onCancel={cancel} /> : null}
      {state.done !== null && noteAt === null ? <SavedNote>{state.done}</SavedNote> : null}
      {state.error !== null && draft === null ? <Refusal>{state.error}</Refusal> : null}

      {rates.length > 0 ? (
        <ul className="list-none m-0 p-0">
          {rates.map((rate) => {
            const block = rateRemoveBlock(rate);
            return (
              <li key={rate.id} className="flex flex-col gap-3 py-3" style={LINE} data-testid="tax-rate-row">
                {draft !== null && draft.id === rate.id ? (
                  <RateForm draft={draft} setDraft={setDraft} busy={state.busy} error={state.error} onSave={() => void save()} onCancel={cancel} />
                ) : (
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-col min-w-0">
                      <p className="c-s15 c-w6 c-t1 m-0">{rateLabel(rate)}</p>
                      <p className="c-s14 c-t2 m-0">{rateUses(rate)}</p>
                    </div>
                    {canManage ? (
                      <div className="flex flex-wrap gap-2 flex-shrink-0">
                        <button type="button" className="c-btn c-btn-s c-btn-sm" disabled={locked || state.busy || draft !== null} onClick={() => { setChoosing(rate.id); setAsking(null); clear(); }} aria-label={`${chooseWord} for ${rate.name}`}>
                          {chooseWord}
                        </button>
                        <button type="button" className="c-btn c-btn-s c-btn-sm" disabled={locked || state.busy || draft !== null} onClick={() => { setDraft(draftFromRate(rate)); setAsking(null); setChoosing(null); clear(); }} aria-label={`Change ${rate.name}`}>
                          Change
                        </button>
                        <button type="button" className="c-btn c-btn-s c-btn-sm" disabled={locked || state.busy || draft !== null} onClick={() => { setAsking(rate.id); setChoosing(null); clear(); }} aria-label={`Remove ${rate.name}`}>
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
                {state.done !== null && noteAt === rate.id ? <SavedNote>{state.done}</SavedNote> : null}
                {choosing === rate.id && canManage && !locked ? (
                  <ChargeBox
                    gymId={gymId}
                    page={page}
                    rate={rate}
                    use={use}
                    onPage={onPage}
                    onDone={(words) => {
                      setChoosing(null);
                      setNoteAt(rate.id);
                      setState({ busy: false, error: null, done: words });
                    }}
                    onCancel={() => setChoosing(null)}
                  />
                ) : null}
                {asking === rate.id ? (
                  block !== null ? (
                    <div className="flex flex-col gap-2">
                      <Refusal>{block}</Refusal>
                      <button type="button" className="c-btn c-btn-s c-btn-sm self-start" onClick={() => setAsking(null)}>
                        OK
                      </button>
                    </div>
                  ) : (
                    <ConfirmInline
                      newLook
                      question={`Remove ${rate.name}? Nothing charges it now. Sales and bills already made keep it.`}
                      confirmLabel="Remove"
                      busy={state.busy}
                      onConfirm={() => {
                        setAsking(null);
                        void run(() => registerService.removeTaxRate(gymId, rate.id), `${rate.name} removed.`);
                      }}
                      onCancel={() => setAsking(null)}
                    />
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {canManage ? <TaxMode gymId={gymId} page={page} locked={locked} onPage={onPage} /> : null}
    </section>
  );
}
