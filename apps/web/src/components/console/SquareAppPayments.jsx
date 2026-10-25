import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, HelpCircle, Info, Loader2 } from 'lucide-react';
import { SQUARE_APP_WORDS, formatMinor, squareTaxAddsDetail, squareTaxNames, squareTaxesToOpen } from '@app/shared';
import { orgService } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import PlaceLink from './PlaceLink';
import ScreenWords from './ScreenWords';

// SQUARE POINT OF SALE (ROADMAP 18d-iii-b-i), in the connected Payments box: a payment staff take in Square's
// own app, picking the member and typing the bill's total, comes to that member's bill here. The box is a
// checklist a gym that opened last week can follow (Kd's click-through, 2026-10-25): each line says whether
// it is done. Whether Square adds its own tax on top of a typed amount is read from the gym's own Square
// taxes each time the box opens, never changed; where it does, the steps to fix it show at once, the tax on
// memberships here being their second step. Labels on a screen are drawn as labels (ScreenWords). A gym
// connected before the app could read them connects Square again, once; only the owner does.

const W = SQUARE_APP_WORDS;
const boxStyle = { border: '1px solid var(--line)' };
const stepsStyle = { background: 'var(--raise)', border: '1px solid var(--raise-line)' };

const ICONS = {
  done: <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--good)' }} aria-label="Done" />,
  fix: <AlertTriangle className="w-5 h-5" style={{ color: 'var(--warn)' }} aria-label="Needs fixing" />,
  todo: <Circle className="w-5 h-5 c-t3" aria-hidden="true" />,
  // Done on each sale, in Square: nothing here can tick it.
  each: <Info className="w-5 h-5 c-t3" aria-hidden="true" />,
  unknown: <HelpCircle className="w-5 h-5 c-t3" aria-hidden="true" />,
  checking: <Loader2 className="w-5 h-5 animate-spin c-t3" aria-hidden="true" />,
};

/** One line of the checklist: whether it is done, what it is, and what to do. `detail` is plain (it may
 *  hold a name from Square or the gym); `words` names labels in [brackets]. */
function Step({ icon, title, detail, words, children, testId }) {
  return (
    <li className="c-row" style={{ alignItems: 'flex-start' }} data-testid={testId}>
      <span className="shrink-0 pt-0.5">{ICONS[icon]}</span>
      <div className="flex flex-col gap-1.5 min-w-0">
        <span className="c-s14 c-w6 c-t1">{title}</span>
        {detail ? <span className="c-s14 c-t2">{detail}</span> : null}
        {words ? <ScreenWords text={words} className="c-s14 c-t2" /> : null}
        {children}
      </div>
    </li>
  );
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
      <p className="c-s14 c-w6 c-t1 m-0">{W.heading}</p>
      <p className="c-s14 c-t2 m-0">{W.how}</p>
    </div>
  );

  if (squareApp.needsAllow || check?.taxes.state === 'needs_allow') {
    return (
      <section aria-label={W.heading} className="flex flex-col gap-3">
        {heading}
        <ul className="m-0 p-0 list-none rounded-xl" style={boxStyle}>
          {owner ? (
            <Step icon="fix" title={W.needsAllowTitle} words={W.needsAllow} testId="square-allow-step">
              <button type="button" onClick={onConnectAgain} disabled={connecting || readOnly} className="c-btn c-btn-p self-start">
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {connecting ? 'Opening Square…' : 'Reconnect Square'}
              </button>
              {readOnly ? <span className="c-s12 c-t3">{readOnlyNote(org.orgType)}</span> : null}
            </Step>
          ) : (
            <Step icon="fix" title={W.needsAllowTitle} detail={W.ownerOnly(org.name)} testId="square-allow-step" />
          )}
        </ul>
      </section>
    );
  }

  const checkAgain = (
    <button type="button" onClick={ask} disabled={asking} className="c-btn c-btn-s c-btn-sm self-start">
      {asking ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
      {W.checkAgain}
    </button>
  );
  // Tax on memberships here: the button that opens the exact place, for whoever may set it. Setting it is
  // the box's one main press, filled orange, so it never reads as one of Square's labels around it.
  const taxPlace = (label, main) => (
    <PlaceLink to={`/console/${org.slug}/memberships#tax`} className={`c-btn ${main ? 'c-btn-p' : 'c-btn-s'} c-btn-sm self-start`}>
      {label}
    </PlaceLink>
  );
  const setTax = (c) => (c.canSetTax ? taxPlace(W.setTaxButton, true) : <span className="c-s13 c-t2">{W.setTaxWho}</span>);

  let taxStep;
  if (check === null && !failed) {
    taxStep = <Step icon="checking" title={W.taxChecking} testId="square-tax-step" />;
  } else if (failed || check === null || check.taxes.state === 'unknown') {
    taxStep = (
      <Step icon="unknown" title={W.taxUnknownTitle} detail={W.taxUnknownDetail} testId="square-tax-step">
        {checkAgain}
      </Step>
    );
  } else if (check.taxes.state === 'none') {
    taxStep = <Step icon="done" title={W.taxNoneTitle} detail={W.taxNoneDetail} testId="square-tax-step" />;
  } else {
    const { taxes, exampleMinor, chargedMinor } = check.taxes;
    const which = squareTaxesToOpen(taxes);
    taxStep = (
      <Step
        icon="fix"
        title={W.taxAddsTitle}
        detail={squareTaxAddsDetail(squareTaxNames(taxes), formatMinor(exampleMinor, check.currency), formatMinor(chargedMinor, check.currency))}
        testId="square-tax-step"
      >
        <button type="button" className="c-btn c-btn-link self-start" aria-expanded={fixOpen} onClick={() => setFixOpen((v) => !v)}>
          {fixOpen ? W.hideSteps : W.howToFix}
        </button>
        {fixOpen ? (
          <ol className="m-0 p-0 list-none flex flex-col gap-4 rounded-lg px-3 py-3" style={stepsStyle}>
            <li className="flex flex-col gap-1.5" data-testid="square-fix-in-square">
              <span className="c-s14 c-w6 c-t1">{W.fixSquareTitle}</span>
              <span className="c-s13 c-t2">{W.fixSquareWhy}</span>
              <ScreenWords text={W.taxFixWebsite(which)} className="c-s14 c-t1" />
              <ScreenWords text={W.taxFixApp(which)} className="c-s14 c-t1" />
              <ScreenWords text={W.taxFixKeeps} className="c-s13 c-t2" />
            </li>
            <li className="flex flex-col gap-1.5" data-testid="square-fix-here">
              <span className="c-s14 c-w6 c-t1">{W.fixHereTitle}</span>
              {check.membershipTax ? (
                <>
                  <span className="c-s13 c-t2">{W.fixHereSet}</span>
                  {check.canSetTax ? taxPlace(W.seeTaxButton, false) : null}
                </>
              ) : (
                <>
                  <span className="c-s13 c-t2">{W.fixHereUnset}</span>
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
      <Step icon="done" title={W.memberTaxSetTitle} detail={W.memberTaxSetDetail} testId="square-member-tax-step" />
    ) : (
      <Step icon="todo" title={W.memberTaxUnsetTitle} detail={W.memberTaxUnsetDetail} testId="square-member-tax-step">
        {setTax(check)}
      </Step>
    );
  }

  return (
    <section aria-label={W.heading} className="flex flex-col gap-3">
      {heading}
      <p className="c-s14 c-w6 c-t1 m-0">{W.listLead}</p>
      <ul className="m-0 p-0 list-none rounded-xl" style={boxStyle}>
        {taxStep}
        {memberTaxStep}
        <Step icon="each" title={W.pickTitle} words={W.pickDetail} testId="square-pick-step">
          <span className="c-s13 c-t2">{W.pickSkip}</span>
          <button type="button" className="c-btn c-btn-link self-start" aria-expanded={pickOpen} onClick={() => setPickOpen((v) => !v)}>
            {pickOpen ? W.hideSteps : W.pickHow}
          </button>
          {pickOpen ? <ScreenWords text={W.pickSteps} className="block c-s14 c-t1 rounded-lg px-3 py-3" style={stepsStyle} /> : null}
        </Step>
      </ul>
      <div className="flex flex-col gap-1">
        <p className="c-s13 c-t2 m-0">{W.cardSaved}</p>
        <ScreenWords text={W.others} className="block c-s13 c-t2" />
        <p className="c-s13 c-t2 m-0">{W.items}</p>
      </div>
    </section>
  );
}
