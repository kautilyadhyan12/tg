import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, Search } from 'lucide-react';
import { registerService } from '../../api/registerApi';
import { orgService, errorStatus, errorText } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import PlaceLink from '../../components/console/PlaceLink';
import { useConsoleOrg } from './useConsoleOrg';
import { canRemoveMembers, orgWords, viewerPrivileges } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import { placeFor } from './consolePlaces';
import MemberListPerson from './MemberListPerson';
import { Refusal } from './MemberListTags';
import SellDiscounts from './SellDiscounts';
import SellProducts from './SellProducts';
import TaxRates from './TaxRates';
import ReceiptBox from '../../components/console/ReceiptBox';
import DatePick from '../../components/console/DatePick';
import MoreMenu from '../../components/console/MoreMenu';
import { SaleRefundBox, SaleRefundLines } from './SaleRefunds';
import { SALE_MENU_WORDS } from './saleRefundView';
import { RECEIPT_BUTTON, receiptButtonLabel } from './receiptView';
import { applyPromoCode, discountOption, discountsFor, offeredDiscounts, oldMoneySaleLine, promoCodeNote } from './sellDiscountsView';
import { FriendGiftNote, MemberGiftNote } from './FriendGift';
import { MEMBER_GIFT_SALE_NAME, memberGiftOff } from '@app/shared';
import {
  NO_SELLING_LINE,
  PAY_CHOICES,
  SALE_HINT,
  SELL_REFUSED,
  canOpenSell,
  canSellMemberships,
  discountMinorFor,
  personOption,
  productOption,
  quantityMax,
  saleProblem,
  saleSummary,
  soldWords,
  takingsHeading,
  takingsNotes,
  takingsRows,
  takingsWords,
  SALE_VOID_CHOICES,
  saleVoidedWords,
  voidSaleQuestion,
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
function SaleRecorded({ words, note, onNew, children, below = null }) {
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
      {below}
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
function ProductSale({ gymId, org, page: gymPage, locked, firstPerson, addMemberTo, canAdd, onAddProduct, onPage }) {
  const [productId, setProductId] = useState('');
  const [quantityText, setQuantityText] = useState('1');
  const [who, setWho] = useState(firstPerson === null ? 'walkin' : 'member');
  const [person, setPerson] = useState(firstPerson);
  const [method, setMethod] = useState(PAY_CHOICES[0]?.value ?? 'cash');
  const [key, setKey] = useState(newKey);
  const [state, setState] = useState({ busy: false, error: null, done: null });
  const [discountId, setDiscountId] = useState('');
  const [code, setCode] = useState({ text: '', note: null, appliedId: null });
  /** Refer a friend's gift for the person picked, where they are a friend a member invited
   *  (20e-ii-b-i): filled in on the sale, with Remove. */
  const [giftRead, setGiftRead] = useState(null);
  /** The buyer's own Refer a friend gift (20e-ii-b-ii-a), filled in where no discount is
   *  picked, unless staff press Remove. */
  const [giftRemoved, setGiftRemoved] = useState(false);
  const buyerId = who === 'member' && person !== null ? person.entryId : null;
  const gift = giftRead !== null && giftRead.buyerId === buyerId ? giftRead.gift : null;
  const memberGift = giftRead !== null && giftRead.buyerId === buyerId ? giftRead.memberGift : null;
  useEffect(() => {
    if (buyerId === null) return undefined;
    let live = true;
    registerService.friendGift(gymId, buyerId).then(
      (res) => {
        if (!live) return;
        const found = res.friendGift !== null && res.friendGift.discount.forProducts ? res.friendGift : null;
        setGiftRead({ buyerId, gift: found, memberGift: res.memberGift ?? null });
        setGiftRemoved(false);
        // Only where staff have picked no discount of their own for this sale.
        if (found !== null) setDiscountId((picked) => (picked === '' ? found.discount.id : picked));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gymId, buyerId]);
  // The gift is offered for its own friend only; any other discount as the gym set it.
  const page = gift === null ? gymPage : { ...gymPage, friendGiftId: gift.discount.id };
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
  const hasCodes = offeredDiscounts(page).some((d) => d.code !== null);
  // The buyer's own gift takes a discount's place: used where no discount is picked and it
  // fits this price; else kept for their next payment.
  const giftFits = memberGift !== null && product !== null && Number.isInteger(quantity) && memberGiftOff(memberGift, product.priceMinor * quantity, product.currency) > 0;
  const giftUsed = giftFits && discount === null && !giftRemoved ? memberGift : null;
  const offShown = discount ?? (giftUsed === null ? null : { ...giftUsed, name: MEMBER_GIFT_SALE_NAME });
  const summary = Number.isInteger(quantity) ? saleSummary(product, quantity, page.tax, offShown) : null;
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
        ...(giftUsed === null ? {} : { memberGift: { id: giftUsed.id, offMinor: discountMinorFor(product, quantity, offShown) } }),
      });
      const sold = answer.register.sales.find((s) => s.id === answer.saleId);
      setState({ busy: false, error: null, done: sold === undefined ? 'Sold.' : soldWords(sold), receiptNumber: sold?.receiptNumber ?? null, receiptOpen: false });
      setKey(newKey());
      setProductId('');
      setQuantityText('1');
      setWho('walkin');
      setPerson(null);
      setDiscountId('');
      setGiftRemoved(false);
      setGiftRead(null);
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
    const number = state.receiptNumber ?? null;
    return (
      <SaleRecorded
        words={state.done}
        note="It is in today's list below. If it was a mistake, press ⋯ on its row, then Void sale."
        onNew={() => setState({ busy: false, error: null, done: null })}
        below={number !== null && state.receiptOpen ? <ReceiptBox gymId={gymId} gym={org} number={number} onClose={() => setState((was) => ({ ...was, receiptOpen: false }))} /> : null}
      >
        {number !== null ? (
          <button
            type="button"
            className="c-btn c-btn-s c-btn-lg"
            aria-expanded={state.receiptOpen === true}
            aria-label={receiptButtonLabel(number, 'this sale')}
            onClick={() => setState((was) => ({ ...was, receiptOpen: !was.receiptOpen }))}
          >
            {RECEIPT_BUTTON}
          </button>
        ) : null}
      </SaleRecorded>
    );
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
      {product !== null && gift !== null ? (
        <FriendGiftNote
          gift={gift}
          applied={discount !== null && discount.id === gift.discount.id}
          fits={usable.some((d) => d.id === gift.discount.id)}
          what={product.name}
          onRemove={() => {
            setDiscountId('');
            touched();
          }}
          onPutBack={() => {
            setDiscountId(gift.discount.id);
            touched();
          }}
          disabled={locked || state.busy}
        />
      ) : null}
      {product !== null && memberGift !== null ? (
        <MemberGiftNote
          gift={memberGift}
          applied={giftUsed !== null}
          fits={giftFits}
          what={product.name}
          onRemove={() => {
            setGiftRemoved(true);
            touched();
          }}
          onPutBack={() => {
            setGiftRemoved(false);
            setDiscountId('');
            setCode((was) => ({ ...was, note: null, appliedId: null }));
            touched();
          }}
          disabled={locked || state.busy}
        />
      ) : null}
      {product !== null && offeredDiscounts(page).length > 0 ? (
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

/** Memberships are sold on the member's own page (Kd, 2026-10-14): find them here, and
 *  their page opens with Add membership already open. */
function MembershipFinder({ gymId, words, locked, addMemberTo, onOpen }) {
  const [person, setPerson] = useState(null);
  return (
    <section className="c-card p-4 md:p-5 flex flex-col gap-4" aria-label="Sell a membership">
      <div className="flex flex-col gap-1">
        <h2 className="c-h2">Sell a membership</h2>
        <p className="c-s14 c-t2 m-0">Memberships are sold on the {words.person}&apos;s own page, where you pick the membership, a discount if there is one, and how they paid.</p>
      </div>
      <WhoPicker gymId={gymId} who="member" setWho={() => undefined} person={person} setPerson={setPerson} mustPick disabled={locked} addMemberTo={addMemberTo} />
      {person !== null ? (
        <button
          type="button"
          className="c-btn c-btn-p c-btn-lg self-start"
          disabled={locked}
          onClick={() => {
            onOpen(person.entryId);
            setPerson(null);
          }}
        >
          {`Add a membership for ${person.name}`}
        </button>
      ) : null}
    </section>
  );
}

/** The day's product sales and membership payments, newest first, with the day's total: today,
 *  or an earlier day picked to find a sale to refund (18p). */
function Takings({ gymId, org, page, locked, canOpenPeople, onOpenPerson, onPage, onReload }) {
  /** The day picked; null is today. Another day's list is read here, apart from the page. */
  const [pick, setPick] = useState(null);
  const [other, setOther] = useState({ day: null, page: null, error: null });
  const onToday = pick === null || pick === page.today;
  const shownPage = onToday ? page : other.day === pick ? other.page : null;
  const [asking, setAsking] = useState(null);
  /** The Void sale box's reason, and whether Void sale was pressed with none picked. */
  const [voidReason, setVoidReason] = useState({ reason: '', tried: false });
  /** The sale whose Refund sale box is open, by its row's key. */
  const [refunding, setRefunding] = useState(null);
  /** The row whose receipt is open under it, by its key. */
  const [receiptFor, setReceiptFor] = useState(null);
  const [state, setState] = useState({ busy: false, error: null, done: null });
  const [all, setAll] = useState(false);

  const loadOther = useCallback(
    (day) =>
      registerService.get(gymId, day).then(
        (next) => setOther({ day, page: next, error: null }),
        (err) => setOther({ day, page: null, error: errorText(err, "We couldn't load that day's sales.") }),
      ),
    [gymId],
  );
  useEffect(() => {
    if (pick !== null && pick !== page.today) void loadOther(pick);
  }, [pick, page.today, loadOther]);

  const showDay = (day) => {
    setPick(day === page.today ? null : day);
    setAsking(null);
    setRefunding(null);
    setReceiptFor(null);
    setAll(false);
    setState({ busy: false, error: null, done: null });
  };
  /** What a refund or a void of a refund did, said where it was done; the list is read again. */
  const doneHere = (key) => (words) => {
    setRefunding(null);
    setState({ busy: false, error: null, done: { key, words } });
    // Today's list says the refunds noted today, whichever day's sale they were for.
    void onReload();
    if (!onToday) void loadOther(pick);
  };

  const askVoid = (key) => {
    setVoidReason({ reason: '', tried: false });
    setRefunding(null);
    setAsking(key);
  };

  const voidSale = async (row) => {
    if (voidReason.reason === '') {
      setVoidReason((v) => ({ ...v, tried: true }));
      return;
    }
    setState({ busy: true, error: null, done: null });
    try {
      onPage(await registerService.voidSale(gymId, row.sale.id, { reason: voidReason.reason }));
      setState({ busy: false, error: null, done: { key: row.key, words: saleVoidedWords(row.sale) } });
    } catch (err) {
      setState({ busy: false, error: errorText(err, "We couldn't void that sale. Try again."), done: null });
    }
    setAsking(null);
  };

  const rows = shownPage === null ? [] : takingsRows(shownPage, org.timezone, org.clockFormat);
  const hasPayments = rows.some((r) => r.kind === 'payment');
  const shown = all ? rows : rows.slice(0, TAKINGS_FOLDED);

  return (
    <section className="c-card" aria-label={onToday ? "Today's takings" : 'Takings on another day'}>
      <div className="flex flex-col gap-1 p-4 md:p-5">
        <h2 className="c-h2">{shownPage === null ? '…' : takingsHeading(shownPage)}</h2>
        {/* The calendar opens in place, pushing the list down: this card clips what sticks out. */}
        <div className="flex flex-wrap items-end gap-2 pb-1">
          <div className="c-field">
            <span className="c-label">See another day's sales</span>
            <DatePick label="See another day's sales" value={pick ?? page.today} min="2000-01-01" max={page.today} today={page.today} onChange={(day) => showDay(day)} newLook />
          </div>
          {!onToday ? (
            <button type="button" className="c-btn c-btn-s" onClick={() => showDay(page.today)}>
              Back to today
            </button>
          ) : null}
        </div>
        {shownPage === null ? (
          other.error !== null ? (
            <Refusal>{other.error}</Refusal>
          ) : (
            <p className="c-s14 c-t2 m-0">Loading that day…</p>
          )
        ) : (
          <>
            <p className="c-s15 c-w6 c-t1 m-0" data-testid="takings-line">
              {takingsWords(shownPage)}
            </p>
            {takingsNotes(shownPage).map((note) => (
              <p key={note} className="c-s13 c-t3 m-0">
                {note}
              </p>
            ))}
          </>
        )}
        {state.error !== null ? <Refusal>{state.error}</Refusal> : null}
      </div>
      {rows.length > 0 ? (
        <ul className="list-none m-0 p-0">
          {shown.map((row) => {
            const items = [];
            if (row.canRefund) {
              items.push({
                ...SALE_MENU_WORDS.refund,
                onPick: () => {
                  setAsking(null);
                  setRefunding(row.key);
                },
              });
            }
            if (row.canUndo) items.push({ ...SALE_MENU_WORDS.voidSale, danger: true, onPick: () => askVoid(row.key) });
            return (
              <li key={row.key} className="flex flex-col gap-2 p-4" style={LINE} data-testid="takings-row">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-col min-w-0">
                    <p className="c-s15 c-w6 c-t1 m-0">
                      <span style={row.undone ? { textDecoration: 'line-through' } : undefined}>{`${row.title} · ${row.amount}`}</span>
                      {row.undone ? <span className="c-tag c-tag-plain ml-2">Voided</span> : null}
                      {row.refundTag !== null ? <span className="c-tag c-tag-warn ml-2">{row.refundTag}</span> : null}
                    </p>
                    <p className="c-s14 c-t2 m-0">{row.facts}</p>
                    {row.voided !== null ? <p className="c-s13 c-t3 m-0">{row.voided}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                    {row.person !== null && canOpenPeople ? (
                      <button type="button" className="c-btn c-btn-s c-btn-sm" onClick={() => onOpenPerson(row.person.entryId)} aria-label={`Open ${row.person.name}'s page`}>
                        Open their page
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="c-btn c-btn-s c-btn-sm"
                      aria-expanded={receiptFor === row.key}
                      aria-label={receiptButtonLabel(row.receiptNumber, row.title)}
                      onClick={() => setReceiptFor((was) => (was === row.key ? null : row.key))}
                    >
                      {RECEIPT_BUTTON}
                    </button>
                    {items.length > 0 && !locked ? <MoreMenu label={null} alignRight ariaLabel={`More for the sale of ${row.title}`} items={items} disabled={state.busy} /> : null}
                  </div>
                </div>
                {state.done !== null && state.done.key === row.key ? (
                  <p className="c-s14 c-t1 c-w6 m-0" role="status">
                    {state.done.words}
                  </p>
                ) : null}
                {receiptFor === row.key ? <ReceiptBox gymId={gymId} gym={org} number={row.receiptNumber} onClose={() => setReceiptFor(null)} /> : null}
                {refunding === row.key && row.sale !== null ? (
                  <SaleRefundBox gymId={gymId} sale={row.sale} who={row.sale.person?.name ?? null} onDone={doneHere(row.key)} onClose={() => setRefunding(null)} />
                ) : null}
                {asking === row.key && row.sale !== null ? (
                  <form
                    noValidate
                    className="flex flex-col gap-3"
                    data-testid="void-sale"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!state.busy) void voidSale(row);
                    }}
                  >
                    <p className="c-s14 c-t1 m-0">{voidSaleQuestion(row.sale)}</p>
                    <label className="c-field">
                      <span className="c-label">Why are you voiding it?</span>
                      <select className="c-sel" value={voidReason.reason} onChange={(e) => setVoidReason({ reason: e.target.value, tried: false })}>
                        <option value="">Choose one</option>
                        {SALE_VOID_CHOICES.map((reason) => (
                          <option key={reason.value} value={reason.value}>
                            {reason.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {voidReason.tried ? (
                      <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
                        Pick why you are voiding it.
                      </span>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="submit" disabled={state.busy} className="c-btn c-btn-sm c-btn-danger">
                        Void sale
                      </button>
                      <button type="button" onClick={() => setAsking(null)} disabled={state.busy} className="c-btn c-btn-sm c-btn-s">
                        Keep it
                      </button>
                    </div>
                  </form>
                ) : null}
                {row.sale !== null ? <SaleRefundLines gymId={gymId} gym={org} sale={row.sale} canAct={!locked && page.canSell} onDone={doneHere(row.key)} /> : null}
              </li>
            );
          })}
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
          To void or refund a membership payment, open the member&apos;s page.
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
  const [addAsk, setAddAsk] = useState(0);
  const [personId, setPersonId] = useState(null);
  /** Their page opens with Add membership open: it was opened to sell one. */
  const [personAdds, setPersonAdds] = useState(false);
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

  const openPerson = (entryId, adds = false) => {
    setPersonId(entryId);
    setPersonAdds(adds);
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
                <ProductSale
                  key={`product-${gymId}`}
                  gymId={gymId}
                  org={org}
                  page={page}
                  locked={readOnly}
                  firstPerson={firstPerson}
                  addMemberTo={placeFor(orgSlug, privileges, 'addMember')}
                  canAdd={page.canManage}
                  onAddProduct={addProduct}
                  onPage={setPage}
                />
            </section>
          ) : (
            <section className="c-card p-5 md:p-6">
              <p className="c-s15 c-t2">{NO_SELLING_LINE}</p>
            </section>
          )}

          {page.canSell && sellsMemberships ? <MembershipFinder gymId={gymId} words={words} locked={readOnly} addMemberTo={placeFor(orgSlug, privileges, 'addMember')} onOpen={(entryId) => openPerson(entryId, true)} /> : null}

          {page.canSell ? <Takings gymId={gymId} org={org} page={page} locked={readOnly} canOpenPeople={sellsMemberships} onOpenPerson={openPerson} onPage={setPage} onReload={load} /> : null}

          <div ref={productsRef}>
            <SellProducts key={`products-${gymId}`} gymId={gymId} page={page} locked={readOnly} lockedNote={readOnlyNote(org.orgType)} countryTo={placeFor(orgSlug, privileges, 'country')} addAsk={addAsk} onPage={setPage} />
          </div>
          <TaxRates key={`tax-${gymId}`} gymId={gymId} page={page} locked={readOnly} lockedNote={readOnlyNote(org.orgType)} onPage={setPage} />
          <SellDiscounts
            key={`discounts-${gymId}`}
            gymId={gymId}
            page={page}
            locked={readOnly}
            lockedNote={readOnlyNote(org.orgType)}
            membershipsTo={placeFor(orgSlug, privileges, 'memberships')}
            otherTo={placeFor(orgSlug, privileges, 'memberships')}
            referralTo={placeFor(orgSlug, privileges, 'referrals')}
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
          addMembership={personAdds}
          onClose={() => setPersonId(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
}
