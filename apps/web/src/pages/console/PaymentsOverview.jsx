import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, ChevronRight, Clock3, CreditCard, Loader2, Plus, Wallet } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { registerService } from '../../api/registerApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import PlaceLink from '../../components/console/PlaceLink';
import { useConsoleOrg } from './useConsoleOrg';
import { viewerPrivileges } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import { canOpenPaymentsOverview, canOpenPlace, placeFor } from './consolePlaces';
import { membersPageName } from './consoleMenu';
import { attentionLines } from './attentionView';
import { rememberSquarePress } from './paymentsView';
import { useAttention } from './useAttention';
import { useCameBack } from './useCameBack';
import { moneyAttention, overviewIntro, overviewTiles, paymentLines, revenueByMethod, setupBox } from './paymentsOverviewView';

// PAYMENTS OVERVIEW (ROADMAP V1-f; spec Part 3 §17.11): Money's first page. It gathers and moves
// nothing: every figure is read from the route its own page reads, and every line opens that page
// or setting where it already is. Before Square is connected, the setup comes first. It reads again
// when staff come back to the window ("Pages stay current by themselves").

const goTo = (url) => window.location.assign(url);

const TILE_ICONS = { revenue: Wallet, 'payment-due': Clock3, failed: CreditCard, review: CheckCircle2, cards: CreditCard };
const TONE_CLASS = { good: 'c-pay-ic-good', warn: 'c-pay-ic-warn', bad: 'c-pay-ic-bad', plain: 'c-pay-ic-info', off: 'c-pay-ic-off' };
const FIGURE_CLASS = { warn: 'c-pay-warn', bad: 'c-pay-bad', off: 'c-t3' };
const STATE_CLASS = { good: 'c-pay-good', warn: 'c-pay-warn', bad: 'c-pay-bad', plain: 'c-t3' };

/** One figure across the top. */
function Tile({ tile }) {
  const Icon = TILE_ICONS[tile.key] ?? Wallet;
  return (
    <section className="c-card c-pay-tile" aria-label={tile.title} data-testid={`pay-tile-${tile.key}`}>
      <span className="flex items-center gap-2.5 min-w-0">
        <span className={`c-pay-ic ${TONE_CLASS[tile.tone] ?? TONE_CLASS.plain}`} aria-hidden="true">
          <Icon size={18} />
        </span>
        <span className="c-s14 c-t2">{tile.title}</span>
      </span>
      <span className={`c-big ${FIGURE_CLASS[tile.tone] ?? 'c-t1'}`}>{tile.figure}</span>
      <span className="c-s14 c-t3">
        {tile.note}
        {tile.to !== null ? (
          <>
            {' · '}
            <Link to={tile.to} className="c-lk c-w6">
              View
            </Link>
          </>
        ) : null}
      </span>
    </section>
  );
}

/** What leads the page until Square is connected: its steps, its button for whoever may press it,
 *  and who can for anybody else. */
function SetupBox({ box, readOnly, orgType, busy, error, onConnect }) {
  const pressable = box.press !== null && !readOnly;
  return (
    <section className="c-card c-pay-setup" aria-label="Payment setup" data-testid="payment-setup">
      <div className="flex flex-wrap items-start gap-4">
        <span className="c-pay-ic c-pay-ic-accent c-pay-ic-l" aria-hidden="true">
          <CreditCard size={22} />
        </span>
        <div className="flex flex-col gap-1.5 min-w-0" style={{ flex: '1 1 260px' }}>
          <p className="c-eyebrow">{box.label}</p>
          <h2 className="c-h2" style={{ fontSize: 22, lineHeight: '28px' }}>
            {box.title}
          </h2>
          {box.intro !== null ? <p className="c-s14 c-t2" style={{ maxWidth: 640 }}>{box.intro}</p> : null}
        </div>
        {pressable && box.press.kind === 'connect' ? (
          <button type="button" className="c-btn c-btn-p c-btn-lg" disabled={busy} onClick={onConnect}>
            {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            {box.press.words}
          </button>
        ) : null}
        {pressable && box.press.kind === 'place' ? (
          <PlaceLink to={box.press.to} className="c-btn c-btn-p c-btn-lg">
            {box.press.words}
          </PlaceLink>
        ) : null}
      </div>
      {box.steps.length > 0 ? (
        <ol className="c-pay-steps">
          {box.steps.map((step, i) => (
            <li key={step.title} className={`c-pay-step${i === 0 ? ' c-pay-step-on' : ''}`}>
              <span className="flex flex-wrap items-center gap-2">
                <span className={`c-tag ${i === 0 ? 'c-tag-soft' : 'c-tag-plain'}`}>{i + 1}</span>
                <span className="c-s15 c-w6 c-t1">{step.title}</span>
                {step.optional ? <span className="c-s14 c-t3">Optional</span> : null}
              </span>
              <span className="c-s14 c-t2">{step.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {box.without !== null ? (
        <p className="flex items-start gap-2.5 c-s14 c-t2">
          <span className="c-attn-dot c-pay-dot-good" style={{ marginTop: 5 }} aria-hidden="true" />
          <span>
            <span className="c-t1 c-w6">Available now, without Square: </span>
            {box.without.charAt(0).toLowerCase() + box.without.slice(1)}
          </span>
        </p>
      ) : null}
      {box.ask !== null ? <p className="c-s14 c-t2" data-testid="payment-setup-ask">{box.ask}</p> : null}
      {box.press !== null && readOnly ? <p className="c-s14 c-t2">{readOnlyNote(orgType)}</p> : null}
      {error !== null ? (
        <p className="c-s14 c-err" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** One line of the bell's, about money, with its button. */
function AttentionRow({ line }) {
  return (
    <div className="c-attn-row" data-testid="pay-attention-line">
      <span className={`c-attn-dot${line.tone === 'plain' ? '' : ` c-attn-dot-${line.tone}`}`} aria-hidden="true" />
      <span className="c-attn-text">
        <span className="c-s15 c-w6 c-t1">{line.title}</span>
        {line.note !== null ? <span className="c-s14 c-t3">{line.note}</span> : null}
      </span>
      <span className="c-attn-end">
        {line.money !== null ? <span className="c-s15 c-w6 c-t1 c-num">{line.money}</span> : null}
        <Link to={line.to} className="c-btn c-btn-s c-btn-sm">
          {line.button}
        </Link>
      </span>
    </div>
  );
}

/** One payment page or setting: its state, where it lives, and the press that opens it. A line
 *  with nowhere to open (an Overview box with nothing waiting) only says its state. */
function PlaceRow({ line }) {
  if (line.to === null) {
    return (
      <div className="c-row c-pay-row" data-testid={`pay-line-${line.key}`}>
        <span className="flex flex-col min-w-0" style={{ flexGrow: 1 }}>
          <span className="c-s15 c-w6 c-t1">{line.title}</span>
          {line.state !== null ? <span className={`c-s14 ${STATE_CLASS[line.state.tone] ?? 'c-t3'}`}>{line.state.text}</span> : null}
        </span>
      </div>
    );
  }
  return (
    <Link to={line.to} className="c-row c-pay-row" data-testid={`pay-line-${line.key}`}>
      <span className="flex flex-col min-w-0" style={{ flexGrow: 1 }}>
        <span className="c-s15 c-w6 c-t1">{line.title}</span>
        {line.state !== null ? <span className={`c-s14 ${STATE_CLASS[line.state.tone] ?? 'c-t3'}`}>{line.state.text}</span> : null}
      </span>
      {line.where !== null ? <span className="c-s14 c-t3 c-pay-where">{line.where}</span> : null}
      <ChevronRight size={16} className="c-t3" aria-hidden="true" style={{ flex: 'none' }} />
    </Link>
  );
}

const EMPTY = { gymId: null, register: null, payments: null, bills: null, failed: false };

/** Each figure from its own page's route. One that fails leaves its line without a figure, and the
 *  page says so once at the top. The Members list is not read here: its whole read, for one count,
 *  keeps the server busy 0.8 s at a list of 10,000 (`measure-members-held-cost.ts`). */
async function readFigures(gymId, readsSell, readsBills) {
  const [register, payments, bills] = await Promise.allSettled([
    readsSell ? registerService.get(gymId) : Promise.resolve(null),
    orgService.getGymPayments(gymId).then((res) => res.data.payments),
    readsBills ? orgService.getBillSettings(gymId).then((res) => res.data) : Promise.resolve(null),
  ]);
  return {
    gymId,
    register: register.status === 'fulfilled' ? register.value : null,
    payments: payments.status === 'fulfilled' ? payments.value : null,
    bills: bills.status === 'fulfilled' ? bills.value : null,
    failed: [register, payments, bills].some((r) => r.status === 'rejected'),
  };
}

export default function PaymentsOverview({ openSquare = goTo }) {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const { attention } = useAttention();
  const gymId = org?.id ?? null;
  const privileges = viewerPrivileges(org);
  const may = org != null && canOpenPaymentsOverview(privileges);
  const [state, setState] = useState(EMPTY);
  const [connect, setConnect] = useState({ busy: false, error: null });

  const readsSell = canOpenPlace(privileges, 'sell');
  const readsBills = canOpenPlace(privileges, 'membershipBills');

  // Each figure from its own page's route, read again on Try again and when staff come back.
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (gymId === null || !may) return undefined;
    let live = true;
    readFigures(gymId, readsSell, readsBills).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [gymId, may, readsSell, readsBills, asked]);
  const load = () => setAsked((n) => n + 1);
  useCameBack(may, load);

  const startConnect = async () => {
    setConnect({ busy: true, error: null });
    try {
      const res = await orgService.connectSquare(gymId);
      rememberSquarePress(org.slug);
      openSquare(res.data.url);
    } catch (err) {
      setConnect({ busy: false, error: errorText(err, "We couldn't open Square. Try again in a minute.") });
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
  if (notFound || org == null) {
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

  const readOnly = consoleIsReadOnly(org);
  const head = (
    <header className="c-pay-head">
      <div className="flex flex-col gap-1.5 min-w-0">
        <p className="c-eyebrow">Money</p>
        <h1 className="c-h1">Payments overview</h1>
        <p className="c-sub">{overviewIntro(org)}</p>
      </div>
      {may && !readOnly ? (
        <div className="flex flex-wrap gap-2.5">
          <PlaceLink to={placeFor(orgSlug, privileges, 'paymentDue')} className="c-btn c-btn-s">
            Record a payment
          </PlaceLink>
          <PlaceLink to={placeFor(orgSlug, privileges, 'newSale')} className="c-btn c-btn-p">
            <Plus size={18} aria-hidden="true" />
            New sale
          </PlaceLink>
        </div>
      ) : null}
    </header>
  );

  if (!may) {
    return (
      <div className="c-page">
        {head}
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2" data-testid="payments-overview-refused">
            Your role doesn&apos;t include any payment pages. Ask the owner if you need one.
          </p>
        </section>
      </div>
    );
  }

  const mine = state.gymId === gymId ? state : { ...EMPTY, gymId };
  const facts = { register: mine.register, attention, payments: mine.payments, bills: mine.bills };
  const box = setupBox(mine.payments, org, privileges);
  const tiles = overviewTiles({ orgSlug, ...facts, privileges, orgType: org.orgType });
  const moneyLines = moneyAttention(attentionLines(attention, orgSlug, privileges, org.orgType));
  const seesAttention = attention != null && ['chargebacks', 'failedPayments', 'paymentDue', 'refunds', 'appPayments'].some((k) => attention[k] != null);
  const ways = revenueByMethod(mine.register, privileges);
  const groups = paymentLines({ orgSlug, privileges, org, membersName: membersPageName(privileges, org.orgType), ...facts });
  const takingsTo = placeFor(orgSlug, privileges, 'takings');
  const loaded = state.gymId === gymId;

  return (
    <div className="c-page">
      {head}

      {loaded && mine.failed ? <ConsoleFailed message="Some figures couldn't load." onRetry={load} newLook /> : null}

      {box !== null ? <SetupBox box={box} readOnly={readOnly} orgType={org.orgType} busy={connect.busy} error={connect.error} onConnect={() => void startConnect()} /> : null}

      {!loaded ? <ConsoleLoading label="Loading your payments…" newLook /> : null}

      {tiles.length > 0 ? (
        <div className="c-pay-tiles">
          {tiles.map((tile) => (
            <Tile key={tile.key} tile={tile} />
          ))}
        </div>
      ) : null}

      {seesAttention || ways !== null ? (
        <div className={seesAttention && ways !== null ? 'c-pay-split' : 'flex flex-col gap-5'}>
          {seesAttention ? (
            <section className="c-card c-pay-box" aria-label="Needs attention" data-testid="pay-attention">
              <div className="c-attn-head">
                <h2 className="c-h2">Needs attention</h2>
                {moneyLines.length > 0 ? <span className="c-s14 c-t3">{moneyLines.length === 1 ? '1 item' : `${String(moneyLines.length)} items`} · by urgency</span> : null}
              </div>
              {moneyLines.length === 0 ? (
                <p className="c-attn-none c-s14 c-w6" data-testid="pay-attention-none">
                  <CheckCircle2 size={18} aria-hidden="true" />
                  Nothing needs attention
                </p>
              ) : (
                moneyLines.map((line) => <AttentionRow key={line.key} line={line} />)
              )}
            </section>
          ) : null}
          {ways !== null ? (
            <section className="c-card c-pay-box" aria-label="Revenue by payment method" data-testid="pay-methods">
              <div className="c-attn-head">
                <h2 className="c-h2">Revenue by payment method</h2>
                <span className="c-s14 c-t3">Today</span>
              </div>
              <div className="flex flex-col gap-4 pt-1">
                {ways.length === 0 ? <p className="c-s14 c-t2">Nothing taken yet today.</p> : null}
                {ways.map((way) => (
                  <div key={way.key} className="flex flex-col gap-1.5" data-testid="pay-method">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="c-s14 c-t2">{way.label}</span>
                      <span className="c-s15 c-w6 c-t1 c-num">{way.money}</span>
                    </span>
                    <span className="c-bar c-pay-track" aria-hidden="true">
                      <span className="c-bar-fill c-pay-fill" style={{ width: `${String(way.share)}%` }} />
                    </span>
                  </div>
                ))}
                <PlaceLink to={takingsTo}>View another day</PlaceLink>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {groups.length > 0 ? (
        <section className="flex flex-col gap-4" aria-label="All payment pages and settings">
          <div className="flex flex-col gap-1">
            <h2 className="c-h2">All payment pages and settings</h2>
            <p className="c-s14 c-t3">Each line opens that page or setting.</p>
          </div>
          <div className="c-pay-groups">
            {groups.map((group) => (
              <section key={group.key} className="c-card overflow-hidden" aria-label={group.label} data-testid={`pay-group-${group.key}`}>
                <h3 className="c-h3 px-4 pt-4 pb-1">{group.label}</h3>
                {group.lines.map((line) => (
                  <PlaceRow key={line.key} line={line} />
                ))}
              </section>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
