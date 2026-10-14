import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, Search } from 'lucide-react';
import { registerService } from '../../api/registerApi';
import { orgService, errorStatus, errorText } from '../../api/orgsApi';
import { ConfirmInline, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import PlaceLink from '../../components/console/PlaceLink';
import { useConsoleOrg } from './useConsoleOrg';
import { canRemoveMembers, orgWords, viewerPrivileges } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import { placeFor } from './consolePlaces';
import { termLine } from './membershipTypesView';
import MemberListPerson from './MemberListPerson';
import { Refusal } from './MemberListTags';
import SellDiscounts from './SellDiscounts';
import SellProducts from './SellProducts';
import { NO_CODE, applyPromoCode, discountOption, discountsFor, membershipSummary, oldMoneySaleLine, pickedDiscount, promoCodeNote } from './sellDiscountsView';
import { MembershipDiscountPicker, MembershipTotal } from './MembershipDiscount';
import {
  NO_SELLING_LINE,
  PAY_CHOICES,
  SALE_HINT,
  SELL_REFUSED,
  canOpenSell,
  canSellMemberships,
  membershipSoldWords,
  personOption,
  productOption,
  quantityMax,
  saleProblem,
  saleSummary,
  soldWords,
  takingsNotes,
  takingsRows,
  takingsWords,
  undoSaleQuestion,
} from './sellView';

// SELL (spec Part 3 §14.3; ROADMAP 18b-i, 18b-ii-a): the desk's register. Staff pick what
// is sold, who it is for, a discount if there is one, and how it was paid, and press once. The menu draws the line for whoever
// may sell or change products; the address can be typed by anybody, so somebody without
// either tick is told, and nothing is asked for them.

const LINE = { borderTop: '1px solid var(--line)' };
const newKey = () => globalThis.crypto.randomUUID();
/** How many of today's rows are drawn before "Show all". The total above counts every one. */
const TAKINGS_FOLDED = 10;

/** Who is buying: a walk-in, or a member found by name. `mustPick`: a membership has to be
 *  somebody's. */
function WhoPicker({ gymId, who, setWho, person, setPerson, mustPick, disabled, addMemberTo }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState({ for: '', people: null, error: null });
  const group = useId();
  const searchId = useId();
  const asked = query.trim();

  useEffect(() => {
    if (asked.length < 2) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      registerService.findPeople(gymId, asked).then(
        (people) => live && setFound({ for: asked, people, error: null }),
        (err) => live && setFound({ for: asked, people: null, error: errorText(err, "We couldn't search your list. Try again.") }),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [gymId, asked]);

  const results = asked.length >= 2 && found.for === asked ? found : null;
  const member = mustPick || who === 'member';

  return (
    <fieldset className="flex flex-col gap-2" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="c-label">{mustPick ? 'Who is it for?' : 'Who is buying?'}</legend>
      {!mustPick ? (
        <div className="flex flex-col">
          <label className="flex items-center gap-3 c-s15 c-t1" style={{ minHeight: 44 }}>
            <input type="radio" name={group} checked={who === 'walkin'} disabled={disabled} onChange={() => setWho('walkin')} />
            Walk-in (not on your list)
          </label>
          <label className="flex items-center gap-3 c-s15 c-t1" style={{ minHeight: 44 }}>
            <input type="radio" name={group} checked={who === 'member'} disabled={disabled} onChange={() => setWho('member')} />
            A member
          </label>
        </div>
      ) : null}
      {member && person !== null ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="c-s15 c-w6 c-t1 m-0" data-testid="sell-person">
            {personOption(person)}
          </p>
          <button type="button" className="c-btn c-btn-s c-btn-sm" disabled={disabled} onClick={() => setPerson(null)}>
            Change
          </button>
        </div>
      ) : null}
      {member && person === null ? (
        <div className="flex flex-col gap-2">
          <label className="c-s14 c-t2" htmlFor={searchId}>
            Find them by name or member number
          </label>
          <div className="c-search">
            <Search aria-hidden="true" className="w-4 h-4" />
            <input id={searchId} className="c-input" value={query} disabled={disabled} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
          </div>
          {results !== null && results.error !== null ? <Refusal>{results.error}</Refusal> : null}
          {results !== null && results.people !== null && results.people.length > 0 ? (
            <ul className="list-none m-0 p-0 flex flex-col gap-1" aria-label="People found">
              {results.people.map((p) => (
                <li key={p.entryId}>
                  <button
                    type="button"
                    className="c-btn c-btn-s w-full justify-start text-left"
                    style={{ height: 'auto', minHeight: 44, padding: '8px 14px' }}
                    disabled={disabled}
                    onClick={() => {
                      setPerson(p);
                      setQuery('');
                    }}
                  >
                    {personOption(p)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {results !== null && results.people !== null && results.people.length === 0 ? (
            <div className="flex flex-col gap-2">
              <p className="c-s14 c-t2 m-0">
                {mustPick ? 'Nobody on your list matches. Add them to your list first.' : 'Nobody on your list matches. Add them to your list first, or choose Walk-in.'}
              </p>
              {addMemberTo !== null ? (
                <PlaceLink to={addMemberTo} guard>
                  Add a member
                </PlaceLink>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}

/** WHAT THE BOX SHOWS ONCE A SALE IS RECORDED (Kd's click-through, RULINGS 2026-10-12): the
 *  form is gone, so a second press cannot sell again, and the next sale starts with its
 *  own button. */
function SaleRecorded({ words, note, onNew, children }) {
  return (
    <div className="flex flex-col gap-3" role="status" data-testid="sale-done">
      <p className="c-s16 c-w7 c-t1 m-0 flex items-center gap-2">
        <CheckCircle2 aria-hidden="true" className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--good)' }} />
        Sale recorded
      </p>
      <p className="c-s15 c-t1 m-0">{words}</p>
      <p className="c-s14 c-t2 m-0">{note}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="c-btn c-btn-p c-btn-lg" onClick={onNew}>
          New sale
        </button>
        {children}
      </div>
    </div>
  );
}

function PayPicker({ method, setMethod, disabled }) {
  const id = useId();
  return (
    <div className="c-field">
      <label className="c-label" htmlFor={id}>
        How did they pay?
      </label>
      <select id={id} className="c-input" style={{ maxWidth: 280 }} value={method} disabled={disabled} onChange={(e) => setMethod(e.target.value)}>
        {PAY_CHOICES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A product, how many, who and how: one press records the sale. */
function ProductSale({ gymId, page, locked, firstPerson, addMemberTo, canAdd, onAddProduct, onPage }) {
  const [productId, setProductId] = useState('');
  const [quantityText, setQuantityText] = useState('1');
  const [who, setWho] = useState(firstPerson === null ? 'walkin' : 'member');
  const [person, setPerson] = useState(firstPerson);
  const [method, setMethod] = useState(PAY_CHOICES[0]?.value ?? 'cash');
  const [key, setKey] = useState(newKey);
  const [state, setState] = useState({ busy: false, error: null, done: null });
  const [discountId, setDiscountId] = useState('');
  const [code, setCode] = useState({ text: '', note: null, appliedId: null });
  const productSelect = useId();
  const quantityId = useId();
  const discountSelect = useId();
  const codeId = useId();

  const product = page.products.find((p) => p.id === productId) ?? null;
  const quantity = /^\d{1,2}$/.test(quantityText.trim()) ? Number(quantityText.trim()) : Number.NaN;
  // Only a discount that can be used on this product today is ever sent: one picked for
  // another product, or since used up, falls back to none.
  const usable = discountsFor(page, product);
  const discount = usable.find((d) => d.id === discountId) ?? null;
  const hasCodes = page.discounts.some((d) => d.code !== null);
  const summary = Number.isInteger(quantity) ? saleSummary(product, quantity, page.tax, discount) : null;
  const problem = saleProblem({ product, quantity, who, person, currency: page.currency, discount });
  // "Applied" is said only while the applied discount is the one on the sale.
  const codeNote = promoCodeNote(page, product, discount, code);
  const oldMoney = oldMoneySaleLine(page);
  const applyCode = () => {
    const found = applyPromoCode(page, product, code.text);
    if (found.discount !== null) setDiscountId(found.discount.id);
    setCode((was) => ({ ...was, note: found.note, appliedId: found.discount === null ? null : found.discount.id }));
    touched();
  };
  const touched = () => setState((was) => (was.error === null && was.done === null ? was : { ...was, error: null, done: null }));

  const sell = async () => {
    if (problem !== null || summary === null || product === null) return;
    setState({ busy: true, error: null, done: null });
    try {
      const answer = await registerService.sell(gymId, {
        requestKey: key,
        productId: product.id,
        quantity,
        entryId: who === 'member' && person !== null ? person.entryId : null,
        method,
        totalMinor: summary.totalMinor,
        discountId: discount === null ? null : discount.id,
      });
      const sold = answer.register.sales.find((s) => s.id === answer.saleId);
      setState({ busy: false, error: null, done: sold === undefined ? 'Sold.' : soldWords(sold) });
      setKey(newKey());
      setProductId('');
      setQuantityText('1');
      setWho('walkin');
      setPerson(null);
      setDiscountId('');
      setCode({ text: '', note: null, appliedId: null });
      onPage(answer.register);
    } catch (err) {
      setState({ busy: false, error: errorText(err, "We couldn't record that sale. Nothing was sold: try again."), done: null });
      // A refusal of this form's own key is final: the next press is a new sale.
      if (errorStatus(err) === 409) {
        setKey(newKey());
        registerService.get(gymId).then(onPage, () => undefined);
      }
    }
  };

  if (state.done !== null) {
    return <SaleRecorded words={state.done} note="It is in today's list below. To take it back, press Undo sale on its row." onNew={() => setState({ busy: false, error: null, done: null })} />;
  }

  if (page.products.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="c-s15 c-t2 m-0">You have no products yet. Add what you sell at the desk, such as water or a towel, and it appears here.</p>
        {canAdd ? (
          <button type="button" className="c-btn c-btn-p c-btn-lg self-start" disabled={locked} onClick={onAddProduct}>
            Add your first product
          </button>
        ) : (
          <p className="c-s14 c-t3 m-0">The owner, or staff who can change membership types and prices, can add products.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="c-field">
        <label className="c-label" htmlFor={productSelect}>
          Product
        </label>
        <select
          id={productSelect}
          className="c-input"
          value={productId}
          disabled={locked || state.busy}
          onChange={(e) => {
            setProductId(e.target.value);
            touched();
          }}
        >
          <option value="">Pick a product</option>
          {page.products.map((p) => (
            <option key={p.id} value={p.id}>
              {productOption(p)}
            </option>
          ))}
        </select>
      </div>
      <div className="c-field">
        <label className="c-label" htmlFor={quantityId}>
          How many
        </label>
        <input
          id={quantityId}
          className="c-input"
          style={{ maxWidth: 120 }}
          type="number"
          inputMode="numeric"
          min={1}
          max={quantityMax(product)}
          value={quantityText}
          disabled={locked || state.busy}
          onChange={(e) => {
            setQuantityText(e.target.value);
            touched();
          }}
        />
      </div>
      <WhoPicker
        gymId={gymId}
        who={who}
        setWho={(next) => {
          setWho(next);
          touched();
        }}
        person={person}
        setPerson={(next) => {
          setPerson(next);
          touched();
        }}
        mustPick={false}
        disabled={locked || state.busy}
        addMemberTo={addMemberTo}
      />
      {product !== null && page.discounts.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="c-field">
            <label className="c-label" htmlFor={discountSelect}>
              Discount
            </label>
            {usable.length === 0 ? (
              <p id={discountSelect} className="c-s14 c-t2 m-0">
                No discount applies to this product today.
              </p>
            ) : (
              <select
                id={discountSelect}
                className="c-input"
                value={discount === null ? '' : discount.id}
                disabled={locked || state.busy}
                onChange={(e) => {
                  setDiscountId(e.target.value);
                  setCode((was) => ({ ...was, note: null, appliedId: null }));
                  touched();
                }}
              >
                <option value="">No discount</option>
                {usable.map((d) => (
                  <option key={d.id} value={d.id}>
                    {discountOption(d)}
                  </option>
                ))}
              </select>
            )}
            {oldMoney !== null ? <p className="c-s14 c-t2 m-0">{oldMoney}</p> : null}
          </div>
          {hasCodes ? (
            <div className="c-field">
              <label className="c-label" htmlFor={codeId}>
                Promo code
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id={codeId}
                  className="c-input"
                  style={{ maxWidth: 220, textTransform: 'uppercase' }}
                  value={code.text}
                  maxLength={40}
                  autoComplete="off"
                  disabled={locked || state.busy}
                  onChange={(e) => setCode({ text: e.target.value, note: null, appliedId: null })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyCode();
                  }}
                />
                <button type="button" className="c-btn c-btn-s c-btn-lg" disabled={locked || state.busy} onClick={applyCode}>
                  Apply
                </button>
              </div>
              {codeNote !== null ? (
                <p className="c-s14 c-t2 m-0" role="status">
                  {codeNote}
                </p>
              ) : (
                <p className="c-s13 c-t3 m-0">If the customer gives a code, type it here and press Apply.</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      <PayPicker method={method} setMethod={setMethod} disabled={locked || state.busy} />

      {summary !== null ? (
        <dl className="flex flex-col gap-1 m-0 pt-3" style={LINE} data-testid="sale-summary">
          {summary.lines.map((line) => (
            <div key={line.label} className="flex justify-between gap-4" style={{ maxWidth: 360 }}>
              <dt className={line.strong ? 'c-s16 c-w7 c-t1' : 'c-s14 c-t2'}>{line.label}</dt>
              <dd className={`m-0 c-num ${line.strong ? 'c-s16 c-w7 c-t1' : 'c-s14 c-t2'}`}>{line.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="flex flex-col gap-2">
        <button type="button" className="c-btn c-btn-p c-btn-lg self-start" disabled={locked || state.busy || problem !== null || summary === null} onClick={() => void sell()}>
          {state.busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {state.busy ? 'Recording…' : summary !== null ? `Take payment · ${summary.total}` : 'Take payment'}
        </button>
        {problem !== null && productId !== '' ? <p className="c-s14 c-t2 m-0">{problem}</p> : null}
        <p className="c-s13 c-t3 m-0">{SALE_HINT}</p>
      </div>
      {state.error !== null ? <Refusal>{state.error}</Refusal> : null}
    </div>
  );
}

/** A membership given as paid: the notebook's own step, from the desk, with a discount
 *  if one applies. */
function MembershipSale({ gymId, page, locked, firstPerson, addMemberTo, membershipsTo, onOpenPerson, onPage }) {
  const [types, setTypes] = useState({ gymId: null, list: null, error: null });
  /** Raised to read the price list again: after a sale, and after a refusal. */
  const [typesAsk, setTypesAsk] = useState(0);
  const [typeId, setTypeId] = useState('');
  const [person, setPerson] = useState(firstPerson);
  const [method, setMethod] = useState(PAY_CHOICES[0]?.value ?? 'cash');
  const [key, setKey] = useState(newKey);
  const [state, setState] = useState({ busy: false, error: null, done: null });
  const [discountId, setDiscountId] = useState('');
  const [code, setCode] = useState(NO_CODE);
  const typeSelect = useId();

  useEffect(() => {
    let live = true;
    orgService.getMembershipTypes(gymId).then(
      (res) => live && setTypes({ gymId, list: res.data.types, error: null }),
      (err) => live && setTypes({ gymId, list: null, error: errorText(err, "We couldn't load your membership types.") }),
    );
    return () => {
      live = false;
    };
  }, [gymId, typesAsk]);

  if (types.gymId !== gymId) return <ConsoleLoading label="Loading your membership types…" newLook />;
  if (types.list === null) return <Refusal>{types.error}</Refusal>;
  if (types.list.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="c-s15 c-t2 m-0">You have no membership types yet. Add what you sell, such as a monthly membership or a day pass, and it appears here.</p>
        {membershipsTo !== null ? <PlaceLink to={membershipsTo}>Open Memberships</PlaceLink> : <p className="c-s14 c-t3 m-0">The owner can add membership types.</p>}
      </div>
    );
  }

  if (state.done !== null) {
    const bought = state.done.person;
    return (
      <SaleRecorded
        words={state.done.words}
        note="It is in today's list below. To undo or refund it, open the member's page."
        onNew={() => {
          setState({ busy: false, error: null, done: null });
          setTypesAsk((n) => n + 1);
        }}
      >
        <button type="button" className="c-btn c-btn-s c-btn-lg" onClick={() => onOpenPerson(bought.entryId)}>
          {`Open ${bought.name}'s page`}
        </button>
      </SaleRecorded>
    );
  }

  const type = types.list.find((t) => t.id === typeId) ?? null;
  const free = type !== null && type.priceMinor === 0;
  // Only a discount the server will take on this type today is ever sent.
  const discount = type === null ? null : pickedDiscount(page, type, discountId);
  const summary = membershipSummary(type, discount);
  const problem = type === null ? 'Pick a membership.' : person === null ? 'Find and pick the member it is for.' : person.past ? `${person.name} is a past member. Put them back on your list from their page, then give the membership.` : null;

  const give = async () => {
    if (problem !== null || type === null || person === null) return;
    setState({ busy: true, error: null, done: null });
    try {
      // The gym's own day as the server reads it now, never a day this page read when it
      // was opened: a tab left open overnight still starts the membership today.
      const fresh = await registerService.get(gymId);
      onPage(fresh);
      // The price sent is the one on the button: the server gives nothing at any other.
      await orgService.giveHeldMembership(gymId, person.entryId, {
        requestKey: key,
        typeId: type.id,
        startsOn: fresh.today,
        paid: !free,
        priceMinor: type.priceMinor,
        ...(free ? {} : { method }),
        ...(discount === null || summary === null || summary.offMinor === null ? {} : { discountId: discount.id, discountMinor: summary.offMinor }),
      });
      setState({ busy: false, error: null, done: { words: membershipSoldWords(type, person.name, method, discount), person } });
      setKey(newKey());
      setPerson(null);
      setTypeId('');
      setDiscountId('');
      setCode(NO_CODE);
      registerService.get(gymId).then(onPage, () => undefined);
    } catch (err) {
      setState({ busy: false, error: errorText(err, "We couldn't give that membership. Nothing was saved: try again."), done: null });
      // A refusal of this form's own key is final, and the price list may be why: read again.
      if (errorStatus(err) === 409) {
        setKey(newKey());
        setTypesAsk((n) => n + 1);
      }
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="c-field">
        <label className="c-label" htmlFor={typeSelect}>
          Membership
        </label>
        <select
          id={typeSelect}
          className="c-input"
          value={typeId}
          disabled={locked || state.busy}
          onChange={(e) => {
            setTypeId(e.target.value);
            setCode((was) => ({ ...was, note: null, appliedId: null }));
          }}
        >
          <option value="">Pick a membership</option>
          {types.list.map((t) => (
            <option key={t.id} value={t.id}>
              {`${t.name} · ${termLine(t)}`}
            </option>
          ))}
        </select>
        <p className="c-s13 c-t3 m-0">It starts today. To start it on another day, add it on the member&apos;s own page.</p>
      </div>
      <WhoPicker gymId={gymId} who="member" setWho={() => undefined} person={person} setPerson={setPerson} mustPick disabled={locked || state.busy} addMemberTo={addMemberTo} />
      {person !== null && person.past ? (
        <button type="button" className="c-btn c-btn-s c-btn-sm self-start" onClick={() => onOpenPerson(person.entryId)}>
          {`Open ${person.name}'s page`}
        </button>
      ) : null}
      {!free ? <MembershipDiscountPicker page={page} type={type} discountId={discountId} setDiscountId={setDiscountId} code={code} setCode={setCode} disabled={locked || state.busy} /> : null}
      {!free ? <PayPicker method={method} setMethod={setMethod} disabled={locked || state.busy} /> : null}
      <MembershipTotal summary={summary} />
      <div className="flex flex-col gap-2">
        <button type="button" className="c-btn c-btn-p c-btn-lg self-start" disabled={locked || state.busy || problem !== null || summary === null} onClick={() => void give()}>
          {state.busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {state.busy ? 'Recording…' : type === null || summary === null ? 'Take payment' : free ? 'Give membership' : `Take payment · ${summary.total}`}
        </button>
        {problem !== null && (typeId !== '' || person !== null) ? <p className="c-s14 c-t2 m-0">{problem}</p> : null}
        {!free ? <p className="c-s13 c-t3 m-0">{SALE_HINT}</p> : null}
      </div>
      {state.error !== null ? <Refusal>{state.error}</Refusal> : null}
    </div>
  );
}

/** Today's product sales and membership payments, newest first, with the day's total. */
function Takings({ gymId, org, page, locked, canOpenPeople, onOpenPerson, onPage }) {
  const rows = takingsRows(page, org.timezone, org.clockFormat);
  const [asking, setAsking] = useState(null);
  const [state, setState] = useState({ busy: false, error: null, done: null });
  const hasPayments = rows.some((r) => r.kind === 'payment');
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, TAKINGS_FOLDED);

  const undo = async (sale) => {
    setState({ busy: true, error: null, done: null });
    try {
      onPage(await registerService.undoSale(gymId, sale.id));
      setState({ busy: false, error: null, done: `Sale undone: ${String(sale.quantity)} × ${sale.itemName}. It no longer counts in today's total.` });
    } catch (err) {
      setState({ busy: false, error: errorText(err, "We couldn't undo that sale. Try again."), done: null });
    }
    setAsking(null);
  };

  return (
    <section className="c-card overflow-hidden" aria-label="Today's takings">
      <div className="flex flex-col gap-1 p-4 md:p-5">
        <h2 className="c-h2">Today</h2>
        <p className="c-s15 c-w6 c-t1 m-0" data-testid="takings-line">
          {takingsWords(page)}
        </p>
        {takingsNotes(page).map((note) => (
          <p key={note} className="c-s13 c-t3 m-0">
            {note}
          </p>
        ))}
        {state.done !== null ? (
          <p className="c-s14 c-t1 c-w6 m-0" role="status">
            {state.done}
          </p>
        ) : null}
        {state.error !== null ? <Refusal>{state.error}</Refusal> : null}
      </div>
      {rows.length > 0 ? (
        <ul className="list-none m-0 p-0">
          {shown.map((row) => (
            <li key={row.key} className="flex flex-col gap-2 p-4" style={LINE} data-testid="takings-row">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-col min-w-0">
                  <p className="c-s15 c-w6 c-t1 m-0">
                    <span style={row.undone ? { textDecoration: 'line-through' } : undefined}>{`${row.title} · ${row.amount}`}</span>
                    {row.undone ? <span className="c-tag c-tag-plain ml-2">Undone</span> : null}
                  </p>
                  <p className="c-s14 c-t2 m-0">{row.facts}</p>
                </div>
                <div className="flex flex-wrap gap-2 flex-shrink-0">
                  {row.person !== null && canOpenPeople ? (
                    <button type="button" className="c-btn c-btn-s c-btn-sm" onClick={() => onOpenPerson(row.person.entryId)} aria-label={`Open ${row.person.name}'s page`}>
                      Open their page
                    </button>
                  ) : null}
                  {row.canUndo && asking !== row.key ? (
                    <button type="button" className="c-btn c-btn-s c-btn-sm" disabled={locked || state.busy} onClick={() => setAsking(row.key)} aria-label={`Undo sale of ${row.title}`}>
                      Undo sale
                    </button>
                  ) : null}
                </div>
              </div>
              {asking === row.key && row.sale !== null ? (
                <ConfirmInline newLook question={undoSaleQuestion(row.sale)} confirmLabel="Undo sale" cancelLabel="Keep it" busy={state.busy} onConfirm={() => void undo(row.sale)} onCancel={() => setAsking(null)} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {rows.length > TAKINGS_FOLDED ? (
        <div className="p-4" style={LINE}>
          <button type="button" className="c-btn c-btn-s c-btn-lg w-full md:w-auto" aria-expanded={all} onClick={() => setAll((was) => !was)}>
            {all ? `Show only the newest ${String(TAKINGS_FOLDED)}` : `Show all ${String(rows.length)}`}
          </button>
        </div>
      ) : null}
      {hasPayments ? (
        <p className="px-4 py-3 c-s13 c-t3 m-0" style={LINE}>
          To undo or refund a membership payment, open the member&apos;s page.
        </p>
      ) : null}
    </section>
  );
}

export default function Sell() {
  const { orgSlug } = useParams();
  const location = useLocation();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const gymId = org?.id ?? null;
  const may = canOpenSell(viewerPrivileges(org));
  // Each answer carries the gym it was asked for, so another gym's sales are never drawn.
  const [state, setState] = useState({ gymId: null, error: null, refused: false, page: null });
  const [kind, setKind] = useState('product');
  const [addAsk, setAddAsk] = useState(0);
  const [personId, setPersonId] = useState(null);
  const [columns, setColumns] = useState(null);
  const productsRef = useRef(null);
  // A person's page can lead here with them already picked.
  const sent = location.state?.sellTo;
  const firstPerson = sent && typeof sent.entryId === 'string' && typeof sent.name === 'string' ? { entryId: sent.entryId, name: sent.name, email: null, memberNumber: null, past: sent.past === true } : null;

  const load = useCallback(() => {
    if (gymId === null || !may) return Promise.resolve();
    return registerService.get(gymId).then(
      (page) => setState({ gymId, error: null, refused: false, page }),
      (err) => setState((was) => ({ gymId, error: errorText(err, "We couldn't load this page."), refused: errorStatus(err) === 403, page: was.gymId === gymId ? was.page : null })),
    );
  }, [gymId, may]);

  useEffect(() => {
    load();
    // A desk leaves this tab open for days: "Today" is read again whenever it is looked at.
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [load]);

  const openPerson = (entryId) => {
    setPersonId(entryId);
    if (columns === null && gymId !== null) {
      orgService.getMemberList(gymId).then(
        (res) => setColumns(res.data.list),
        () => undefined,
      );
    }
  };

  if (orgLoading) {
    return (
      <div className="c-page">
        <ConsoleLoading label="Loading your organisation…" newLook />
      </div>
    );
  }
  if (orgError !== null) {
    return (
      <div className="c-page">
        <ConsoleFailed message={orgError} onRetry={reload} newLook />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="c-page">
        <section className="c-card p-5 md:p-6 flex flex-col gap-3">
          <p className="c-s15 c-t2">We couldn&apos;t find an organisation you run at this address.</p>
          <Link to="/console" className="c-s15 c-w6 c-lk self-start">
            Your organisations
          </Link>
        </section>
      </div>
    );
  }

  const privileges = viewerPrivileges(org);
  const words = orgWords(org.orgType);
  const readOnly = consoleIsReadOnly(org);
  const mine = state.gymId === gymId ? state : { gymId, error: null, refused: false, page: null };
  const refused = !may || mine.refused;
  const page = mine.page;
  const setPage = (next) => setState({ gymId, error: null, refused: false, page: next });
  const sellsMemberships = canSellMemberships(privileges);
  const addProduct = () => {
    setAddAsk((n) => n + 1);
    productsRef.current?.scrollIntoView?.({ block: 'start' });
  };

  return (
    <div className="c-page">
      <header className="flex flex-col gap-1.5 min-w-0">
        <h1 className="c-h1">Sell</h1>
        <p className="c-sub">{`Record what ${org.name} sells at the desk.`}</p>
      </header>

      {refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{SELL_REFUSED}</p>
        </section>
      ) : page === null ? (
        mine.error !== null ? (
          <ConsoleFailed message={mine.error} onRetry={load} newLook />
        ) : (
          <ConsoleLoading label="Loading this page…" newLook />
        )
      ) : (
        <>
          {mine.error !== null ? <ConsoleFailed message={mine.error} onRetry={load} newLook /> : null}
          {readOnly ? <p className="c-s14 c-t3">{readOnlyNote(org.orgType)}</p> : null}

          {page.canSell ? (
            <section className="c-card p-4 md:p-5 flex flex-col gap-4" aria-label="New sale">
              <h2 className="c-h2">New sale</h2>
              {sellsMemberships ? (
                <div className="flex flex-wrap gap-2" role="group" aria-label="What are you selling?">
                  <button type="button" className={`c-chip ${kind === 'product' ? 'c-chip-on' : ''}`} aria-pressed={kind === 'product'} onClick={() => setKind('product')}>
                    A product
                  </button>
                  <button type="button" className={`c-chip ${kind === 'membership' ? 'c-chip-on' : ''}`} aria-pressed={kind === 'membership'} onClick={() => setKind('membership')}>
                    A membership
                  </button>
                </div>
              ) : null}
              {kind === 'membership' && sellsMemberships ? (
                <MembershipSale
                  key={`membership-${gymId}`}
                  gymId={gymId}
                  page={page}
                  locked={readOnly}
                  firstPerson={firstPerson}
                  addMemberTo={placeFor(orgSlug, privileges, 'addMember')}
                  membershipsTo={placeFor(orgSlug, privileges, 'memberships')}
                  onOpenPerson={openPerson}
                  onPage={setPage}
                />
              ) : (
                <ProductSale
                  key={`product-${gymId}`}
                  gymId={gymId}
                  page={page}
                  locked={readOnly}
                  firstPerson={firstPerson}
                  addMemberTo={placeFor(orgSlug, privileges, 'addMember')}
                  canAdd={page.canManage}
                  onAddProduct={addProduct}
                  onPage={setPage}
                />
              )}
            </section>
          ) : (
            <section className="c-card p-5 md:p-6">
              <p className="c-s15 c-t2">{NO_SELLING_LINE}</p>
            </section>
          )}

          {page.canSell ? <Takings gymId={gymId} org={org} page={page} locked={readOnly} canOpenPeople={sellsMemberships} onOpenPerson={openPerson} onPage={setPage} /> : null}

          <div ref={productsRef}>
            <SellProducts key={`products-${gymId}`} gymId={gymId} page={page} locked={readOnly} lockedNote={readOnlyNote(org.orgType)} countryTo={placeFor(orgSlug, privileges, 'country')} addAsk={addAsk} onPage={setPage} />
          </div>
          <SellDiscounts
            key={`discounts-${gymId}`}
            gymId={gymId}
            page={page}
            locked={readOnly}
            lockedNote={readOnlyNote(org.orgType)}
            membershipsTo={placeFor(orgSlug, privileges, 'memberships')}
            onPage={setPage}
          />
        </>
      )}

      {personId !== null && gymId !== null ? (
        <MemberListPerson
          key={personId}
          gymId={gymId}
          gym={org}
          entryId={personId}
          list={columns}
          words={words}
          readOnly={readOnly}
          canRemove={canRemoveMembers(privileges)}
          onClose={() => setPersonId(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
}
