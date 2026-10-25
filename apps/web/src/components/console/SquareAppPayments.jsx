import { Fragment, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, HelpCircle, Info, Loader2 } from 'lucide-react';
import { SQUARE_APP_WORDS, formatMinor, squareTaxName, squareTaxesToOpen } from '@app/shared';
import { orgService } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import { viewerPrivileges } from '../../pages/console/consoleView';
import { placeFor } from '../../pages/console/consolePlaces';
import PlaceLink from './PlaceLink';
import ScreenWords from './ScreenWords';

// SQUARE POINT OF SALE (ROADMAP 18d-iii-b-i), in the connected Payments box: a payment staff take in Square's
// own app, picking the member and typing the bill's total, comes to that member's bill here. The box is a
// checklist a gym that opened last week can follow, in Kd's words (2026-10-25): each line says whether it is
// done. Whether Square adds its own tax on top of a typed amount is read from the gym's own Square taxes each
// time the box opens, never changed; where it does, the two steps to fix it show at once, the tax on
// memberships here being the second. A label on a screen is drawn in its own colour (ScreenWords). A gym
// connected before the app could read them connects Square again, once; only the owner does.

const W = SQUARE_APP_WORDS;
const labelStyle = { color: 'rgba(255,255,255,0.85)' };
const softStyle = { color: 'rgba(255,255,255,0.55)' };
const strongStyle = { color: '#fff', fontWeight: 600 };
const boxStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' };
const lineStyle = { borderTop: '1px solid rgba(255,255,255,0.08)' };
const mainButton = (on) => ({
  background: on ? 'linear-gradient(135deg,#FF8A1F,#FFB347)' : 'rgba(255,255,255,0.08)',
  color: on ? '#0A0908' : 'rgba(255,255,255,0.35)',
});
const plainButton = { background: 'rgba(255,255,255,0.07)', color: '#fff' };
const linkButton = 'self-start text-sm font-semibold underline underline-offset-2 min-h-11';

const ICONS = {
  done: <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--good)' }} aria-hidden="true" />,
  fix: <AlertTriangle className="w-5 h-5" style={{ color: 'var(--warn)' }} aria-hidden="true" />,
  todo: <Circle className="w-5 h-5" style={softStyle} aria-hidden="true" />,
  // Done on each sale, in Square: nothing here can tick it.
  each: <Info className="w-5 h-5" style={softStyle} aria-hidden="true" />,
  unknown: <HelpCircle className="w-5 h-5" style={softStyle} aria-hidden="true" />,
  checking: <Loader2 className="w-5 h-5 animate-spin" style={softStyle} aria-hidden="true" />,
};
// The word that goes with a line's colour.
const STATUS = {
  done: { word: W.done, style: { color: 'var(--good)' } },
  fix: { word: W.needsFixing, style: { color: 'var(--warn)' } },
};

/** One line of the checklist: whether it is done, what it is, and what to do. */
function Step({ icon, title, children, first = false, testId }) {
  const status = STATUS[icon];
  return (
    <li className="flex gap-3 px-4 py-3" style={first ? undefined : lineStyle} data-testid={testId}>
      <span className="shrink-0 pt-0.5">{ICONS[icon]}</span>
      <div className="flex flex-col gap-1.5 min-w-0">
        {status ? (
          <span className="text-xs font-semibold" style={status.style}>
            {status.word}
          </span>
        ) : null}
        <span className="text-sm font-semibold" style={{ color: '#fff' }}>
          {title}
        </span>
        {children}
      </div>
    </li>
  );
}

const Line = ({ children, soft = false }) => (
  <span className="text-sm" style={soft ? softStyle : labelStyle}>
    {children}
  </span>
);
const Words = ({ text, soft = false }) => <ScreenWords text={text} className="text-sm" style={soft ? softStyle : labelStyle} />;

/** "{taxes}", "{bill}" and "{charged}" in a sentence, each filled in bold. */
function fill(template, values) {
  return template.split(/\{(\w+)\}/).map((part, i) => (i % 2 === 1 ? <Fragment key={`${String(i)}${part}`}>{values[part]}</Fragment> : part));
}
const bold = (text) => <strong style={strongStyle}>{text}</strong>;
/** Each tax in bold: "Sales Tax (8.25%) and SALES TAX 2 (9.0%)". */
function taxList(taxes) {
  return taxes.map((t, i) => (
    <Fragment key={`${String(i)}${t.name}`}>
      {i === 0 ? '' : i === taxes.length - 1 ? ' and ' : ', '}
      {bold(squareTaxName(t))}
    </Fragment>
  ));
}

export default function SquareAppPayments({ org, squareApp, owner, readOnly, onConnectAgain, connecting = false }) {
  const [check, setCheck] = useState(null);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [fixOpen, setFixOpen] = useState(true);
  const [pickOpen, setPickOpen] = useState(false);

  const load = useCallback(
    (isLive = () => true) =>
      orgService
        .getSquareAppCheck(org.id)
        .then((res) => {
          if (!isLive()) return;
          setCheck(res.data.check);
          setFailed(false);
        })
        .catch(() => {
          if (isLive()) setFailed(true);
        }),
    [org.id],
  );

  useEffect(() => {
    if (squareApp.needsAllow) return undefined;
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, [load, squareApp.needsAllow]);

  const ask = () => {
    setAsking(true);
    void load().finally(() => setAsking(false));
  };

  const heading = (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
        {W.heading}
      </p>
      <p className="text-sm m-0" style={softStyle}>
        {W.how}
      </p>
    </div>
  );

  if (squareApp.needsAllow || check?.taxes.state === 'needs_allow') {
    return (
      <section aria-label={W.heading} className="flex flex-col gap-3">
        {heading}
        <ul className="m-0 p-0 list-none rounded-xl" style={boxStyle}>
          <Step icon="fix" title={W.needsAllowTitle} first testId="square-allow-step">
            {owner ? (
              <>
                <Words text={W.needsAllow} />
                <button
                  type="button"
                  onClick={onConnectAgain}
                  disabled={connecting || readOnly}
                  className="self-start rounded-full px-5 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-40 min-h-11"
                  style={mainButton(!connecting && !readOnly)}
                >
                  {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {connecting ? 'Opening Square…' : 'Reconnect Square'}
                </button>
                {readOnly ? (
                  <span className="text-xs" style={softStyle}>
                    {readOnlyNote(org.orgType)}
                  </span>
                ) : null}
              </>
            ) : (
              <Line>{W.ownerOnly(org.name)}</Line>
            )}
          </Step>
        </ul>
      </section>
    );
  }

  const checkAgain = (
    <button
      type="button"
      onClick={ask}
      disabled={asking}
      className="self-start rounded-full px-4 py-2 text-sm font-semibold flex items-center gap-2 disabled:opacity-40 min-h-11"
      style={plainButton}
    >
      {asking ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
      {W.checkAgain}
    </button>
  );
  // Tax on memberships here: the button that opens the exact place, for whoever may set it.
  const taxPlace = (label) => (
    <PlaceLink to={`/console/${org.slug}/memberships#tax`} className="c-btn c-btn-s c-btn-sm self-start">
      {label}
    </PlaceLink>
  );
  const setTax = (c) => (c.canSetTax ? taxPlace(W.setTaxButton) : <Line soft>{W.setTaxWho}</Line>);
  const toMatchTo = placeFor(org.slug, viewerPrivileges(org), 'paymentsToMatch');

  let taxStep;
  if (check === null && !failed) {
    taxStep = <Step icon="checking" title={W.taxChecking} first testId="square-tax-step" />;
  } else if (failed || check === null || check.taxes.state === 'unknown') {
    taxStep = (
      <Step icon="unknown" title={W.taxUnknownTitle} first testId="square-tax-step">
        <Line>{W.taxUnknownDetail}</Line>
        {checkAgain}
      </Step>
    );
  } else if (check.taxes.state === 'none') {
    taxStep = (
      <Step icon="done" title={W.taxNoneTitle} first testId="square-tax-step">
        <Line>{W.taxNoneDetail}</Line>
      </Step>
    );
  } else {
    const { taxes, exampleMinor, chargedMinor } = check.taxes;
    const which = squareTaxesToOpen(taxes);
    taxStep = (
      <Step icon="fix" title={W.taxAddsTitle} first testId="square-tax-step">
        <Line>{fill(W.taxAddsDetail, { taxes: taxList(taxes), bill: bold(formatMinor(exampleMinor, check.currency)), charged: bold(formatMinor(chargedMinor, check.currency)) })}</Line>
        <Line>{W.taxAddsWhy}</Line>
        <button type="button" className={linkButton} style={{ color: '#fff' }} aria-expanded={fixOpen} onClick={() => setFixOpen((v) => !v)}>
          {fixOpen ? W.hideSteps : W.howToFix}
        </button>
        {fixOpen ? (
          <ol className="m-0 p-0 list-none flex flex-col gap-4 rounded-lg px-3 py-3" style={boxStyle}>
            <li className="flex flex-col gap-1.5" data-testid="square-fix-in-square">
              <span className="text-sm font-semibold" style={{ color: '#fff' }}>
                {W.fixSquareTitle}
              </span>
              <Line soft>{W.fixSquareWhy}</Line>
              <Words text={W.fixWebsitePath} />
              <Words text={W.fixWebsiteDo(which)} />
              <Words text={W.fixAppPath} />
              <Words text={W.fixAppDo(which, taxes.length > 1)} />
              <Words text={W.fixKeeps} soft />
            </li>
            <li className="flex flex-col gap-1.5" data-testid="square-fix-here">
              <span className="text-sm font-semibold" style={{ color: '#fff' }}>
                {W.fixHereTitle}
              </span>
              {check.membershipTax ? (
                <>
                  <Line soft>{W.fixHereSet}</Line>
                  {check.canSetTax ? taxPlace(W.seeTaxButton) : null}
                </>
              ) : (
                <>
                  <Line soft>{W.fixHereUnset}</Line>
                  {setTax(check)}
                </>
              )}
            </li>
          </ol>
        ) : null}
        {checkAgain}
      </Step>
    );
  }

  // While Square adds tax, the tax on memberships is the fix's second step, never a line of its own too.
  let memberTaxStep = null;
  if (check !== null && check.taxes.state !== 'adds') {
    memberTaxStep = check.membershipTax ? (
      <Step icon="done" title={W.memberTaxSetTitle} testId="square-member-tax-step">
        <Line>{W.memberTaxSetDetail}</Line>
      </Step>
    ) : (
      <Step icon="todo" title={W.memberTaxUnsetTitle} testId="square-member-tax-step">
        <Line>{W.memberTaxUnsetDetail}</Line>
        {setTax(check)}
      </Step>
    );
  }

  return (
    <section aria-label={W.heading} className="flex flex-col gap-3">
      {heading}
      <p className="text-sm font-semibold m-0" style={labelStyle}>
        {W.listLead}
      </p>
      <ul className="m-0 p-0 list-none rounded-xl" style={boxStyle}>
        {taxStep}
        {memberTaxStep}
        <Step icon="each" title={W.pickTitle} testId="square-pick-step">
          <Words text={W.pickDetail} />
          <Line>{W.pickSkip}</Line>
          <button type="button" className={linkButton} style={{ color: '#fff' }} aria-expanded={pickOpen} onClick={() => setPickOpen((v) => !v)}>
            {pickOpen ? W.hideSteps : W.pickHow}
          </button>
          {pickOpen ? (
            <div className="flex flex-col gap-1.5 rounded-lg px-3 py-3" style={boxStyle}>
              <Words text={W.pickPath} />
              <Words text={W.pickDo} />
            </div>
          ) : null}
        </Step>
        <Step icon="each" title={W.deviceTitle} testId="square-device-step">
          <Line>{W.deviceDetail}</Line>
          <Words text={W.devicePath} />
        </Step>
      </ul>
      <div className="flex flex-col gap-1">
        <Line soft>{W.cardSaved}</Line>
        <Words text={W.others} soft />
        <Words text={W.notShown} soft />
        <Words text={W.items} soft />
        {/* Payments that wait are matched there (18d-iii-b-ii-a): the button opens it, for whoever may. */}
        {toMatchTo !== null ? (
          <PlaceLink to={toMatchTo} className="c-btn c-btn-s c-btn-sm self-start mt-1">
            {W.toList}
          </PlaceLink>
        ) : null}
      </div>
    </section>
  );
}
