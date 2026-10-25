import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, HelpCircle, Info, Loader2 } from 'lucide-react';
import { SQUARE_APP_WORDS, formatMinor, squareTaxNames, squareTaxesToOpen } from '@app/shared';
import { orgService } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import PlaceLink from './PlaceLink';

// SQUARE POINT OF SALE (ROADMAP 18d-iii-b-i), in the connected Payments box: a payment staff take in Square's
// own app, picking the member and typing the bill's total, comes to that member's bill here. The box is a
// checklist a gym that opened last week can follow (Kd's click-through, 2026-10-25): each line says whether
// it is done, and the steps show only where something needs fixing. Whether Square adds its own tax on top
// of a typed amount is read from the gym's own Square taxes each time the box opens, never changed. A gym
// connected before the app could read them connects Square again, once; only the owner does.

const labelStyle = { color: 'rgba(255,255,255,0.85)' };
const softStyle = { color: 'rgba(255,255,255,0.55)' };
const boxStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' };
const lineStyle = { borderTop: '1px solid rgba(255,255,255,0.08)' };
const mainButton = (on) => ({
  background: on ? 'linear-gradient(135deg,#FF8A1F,#FFB347)' : 'rgba(255,255,255,0.08)',
  color: on ? '#0A0908' : 'rgba(255,255,255,0.35)',
});
const plainButton = { background: 'rgba(255,255,255,0.07)', color: '#fff' };
const linkButton = 'self-start text-sm font-semibold underline underline-offset-2 min-h-11';

const ICONS = {
  done: <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--good)' }} aria-label="Done" />,
  fix: <AlertTriangle className="w-5 h-5" style={{ color: 'var(--warn)' }} aria-label="Needs fixing" />,
  todo: <Circle className="w-5 h-5" style={softStyle} aria-hidden="true" />,
  // Done on each sale, in Square: nothing here can tick it.
  each: <Info className="w-5 h-5" style={softStyle} aria-hidden="true" />,
  unknown: <HelpCircle className="w-5 h-5" style={softStyle} aria-hidden="true" />,
  checking: <Loader2 className="w-5 h-5 animate-spin" style={softStyle} aria-hidden="true" />,
};

/** One line of the checklist: whether it is done, what it is, and what to do. */
function Step({ icon, title, detail, children, first = false, testId }) {
  return (
    <li className="flex gap-3 px-4 py-3" style={first ? undefined : lineStyle} data-testid={testId}>
      <span className="shrink-0 pt-0.5">{ICONS[icon]}</span>
      <div className="flex flex-col gap-1.5 min-w-0">
        <span className="text-sm font-semibold" style={{ color: '#fff' }}>
          {title}
        </span>
        {detail ? (
          <span className="text-sm" style={labelStyle}>
            {detail}
          </span>
        ) : null}
        {children}
      </div>
    </li>
  );
}

export default function SquareAppPayments({ org, squareApp, owner, readOnly, onConnectAgain, connecting = false }) {
  const [check, setCheck] = useState(null);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
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
        {SQUARE_APP_WORDS.heading}
      </p>
      <p className="text-sm m-0" style={softStyle}>
        {SQUARE_APP_WORDS.how}
      </p>
    </div>
  );

  const reconnect = (
    <Step icon="fix" title={SQUARE_APP_WORDS.needsAllowTitle} detail={owner ? SQUARE_APP_WORDS.needsAllow : SQUARE_APP_WORDS.ownerOnly(org.name)} first>
      {owner ? (
        <>
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
      ) : null}
    </Step>
  );

  if (squareApp.needsAllow || check?.taxes.state === 'needs_allow') {
    return (
      <section aria-label={SQUARE_APP_WORDS.heading} className="flex flex-col gap-3">
        {heading}
        <ul className="m-0 p-0 list-none rounded-xl" style={boxStyle}>
          {reconnect}
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
      {SQUARE_APP_WORDS.checkAgain}
    </button>
  );
  // Tax on memberships here: the button that opens the exact place, for whoever may set it.
  const setTax = (c) =>
    c.canSetTax ? (
      <PlaceLink to={`/console/${org.slug}/memberships#tax`} className="c-btn c-btn-s c-btn-sm self-start">
        {SQUARE_APP_WORDS.setTaxButton}
      </PlaceLink>
    ) : (
      <span className="text-sm" style={softStyle}>
        {SQUARE_APP_WORDS.setTaxWho}
      </span>
    );

  let taxStep;
  if (check === null && !failed) {
    taxStep = <Step icon="checking" title={SQUARE_APP_WORDS.taxChecking} first testId="square-tax-step" />;
  } else if (failed || check === null || check.taxes.state === 'unknown') {
    taxStep = (
      <Step icon="unknown" title={SQUARE_APP_WORDS.taxUnknownTitle} detail={SQUARE_APP_WORDS.taxUnknownDetail} first testId="square-tax-step">
        {checkAgain}
      </Step>
    );
  } else if (check.taxes.state === 'none') {
    taxStep = <Step icon="done" title={SQUARE_APP_WORDS.taxNoneTitle} detail={SQUARE_APP_WORDS.taxNoneDetail} first testId="square-tax-step" />;
  } else {
    const { taxes, exampleMinor, chargedMinor } = check.taxes;
    const which = squareTaxesToOpen(taxes);
    taxStep = (
      <Step
        icon="fix"
        title={SQUARE_APP_WORDS.taxAddsTitle}
        detail={SQUARE_APP_WORDS.taxAddsDetail(squareTaxNames(taxes), formatMinor(exampleMinor, check.currency), formatMinor(chargedMinor, check.currency))}
        first
        testId="square-tax-step"
      >
        <button type="button" className={linkButton} style={{ color: '#fff' }} aria-expanded={fixOpen} onClick={() => setFixOpen((v) => !v)}>
          {fixOpen ? SQUARE_APP_WORDS.hideSteps : SQUARE_APP_WORDS.howToFix}
        </button>
        {fixOpen ? (
          <div className="flex flex-col gap-2 rounded-lg px-3 py-3" style={boxStyle}>
            <span className="text-sm" style={labelStyle}>
              {SQUARE_APP_WORDS.taxFixWebsite(which)}
            </span>
            <span className="text-sm" style={labelStyle}>
              {SQUARE_APP_WORDS.taxFixApp(which)}
            </span>
            <span className="text-sm" style={softStyle}>
              {SQUARE_APP_WORDS.taxFixKeeps}
            </span>
          </div>
        ) : null}
        {checkAgain}
      </Step>
    );
  }

  return (
    <section aria-label={SQUARE_APP_WORDS.heading} className="flex flex-col gap-3">
      {heading}
      <p className="text-sm font-semibold m-0" style={labelStyle}>
        {SQUARE_APP_WORDS.listLead}
      </p>
      <ul className="m-0 p-0 list-none rounded-xl" style={boxStyle}>
        {taxStep}
        {check === null ? null : check.membershipTax ? (
          <Step icon="done" title={SQUARE_APP_WORDS.memberTaxSetTitle} detail={SQUARE_APP_WORDS.memberTaxSetDetail} testId="square-member-tax-step" />
        ) : (
          <Step icon="todo" title={SQUARE_APP_WORDS.memberTaxUnsetTitle} detail={SQUARE_APP_WORDS.memberTaxUnsetDetail} testId="square-member-tax-step">
            {setTax(check)}
          </Step>
        )}
        <Step icon="each" title={SQUARE_APP_WORDS.pickTitle} detail={SQUARE_APP_WORDS.pickDetail} testId="square-pick-step">
          <button type="button" className={linkButton} style={{ color: '#fff' }} aria-expanded={pickOpen} onClick={() => setPickOpen((v) => !v)}>
            {pickOpen ? SQUARE_APP_WORDS.hideSteps : SQUARE_APP_WORDS.pickHow}
          </button>
          {pickOpen ? (
            <span className="text-sm rounded-lg px-3 py-3" style={{ ...boxStyle, ...labelStyle }}>
              {SQUARE_APP_WORDS.pickSteps}
            </span>
          ) : null}
        </Step>
      </ul>
      <div className="flex flex-col gap-1">
        <p className="text-sm m-0" style={softStyle}>
          {SQUARE_APP_WORDS.cardSaved}
        </p>
        <p className="text-sm m-0" style={softStyle}>
          {SQUARE_APP_WORDS.others}
        </p>
        <p className="text-sm m-0" style={softStyle}>
          {SQUARE_APP_WORDS.items}
        </p>
      </div>
    </section>
  );
}
