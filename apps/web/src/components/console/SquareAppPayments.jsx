import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { SQUARE_APP_WORDS, formatMinor, squareTaxNames } from '@app/shared';
import { orgService } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import PlaceLink from './PlaceLink';

// PAYMENTS TAKEN IN SQUARE POINT OF SALE (ROADMAP 18d-iii-b-i), in the connected Payments box: how the gym
// sets up Square's own app so a payment staff take there, picking the person and typing the bill's total,
// is recorded on that person's bill here. Whether Square adds its own tax on top of a typed amount is not
// left to instructions: the box reads the gym's own Square taxes each time it opens (never changing them)
// and says either that Square adds none, or which tax does, what that does to a $45.00 bill, and how to
// fix it, with the button that opens tax on memberships here. A gym connected before the app could read
// these connects Square again, once; only the owner does, as only the owner connects Square.

const labelStyle = { color: 'rgba(255,255,255,0.85)' };
const softStyle = { color: 'rgba(255,255,255,0.55)' };
const boxStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' };
const mainButton = (on) => ({
  background: on ? 'linear-gradient(135deg,#FF8A1F,#FFB347)' : 'rgba(255,255,255,0.08)',
  color: on ? '#0A0908' : 'rgba(255,255,255,0.35)',
});
const plainButton = { background: 'rgba(255,255,255,0.07)', color: '#fff' };

export default function SquareAppPayments({ org, squareApp, owner, readOnly, onConnectAgain, connecting = false }) {
  const [check, setCheck] = useState(null);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(false);

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
    <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
      {SQUARE_APP_WORDS.heading}
    </p>
  );

  const reconnect = (
    <>
      {owner ? (
        <>
          <div className="flex flex-col gap-1">
            <p className="text-sm m-0" style={labelStyle}>
              {SQUARE_APP_WORDS.needsAllow}
            </p>
            <p className="text-sm m-0" style={softStyle}>
              {SQUARE_APP_WORDS.needsAllowHint}
            </p>
          </div>
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
            <p className="text-xs m-0" style={softStyle}>
              {readOnlyNote(org.orgType)}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm m-0" style={softStyle}>
          {SQUARE_APP_WORDS.ownerOnly(org.name)}
        </p>
      )}
    </>
  );

  if (squareApp.needsAllow) {
    return (
      <section aria-label={SQUARE_APP_WORDS.heading} className="flex flex-col gap-3">
        {heading}
        {reconnect}
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

  let taxBlock;
  if (check === null && !failed) {
    taxBlock = (
      <span className="flex items-center gap-2 text-sm" style={softStyle} role="status">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        {SQUARE_APP_WORDS.taxChecking}
      </span>
    );
  } else if (failed || check === null || check.taxes.state === 'unknown') {
    taxBlock = (
      <div className="flex flex-col gap-2" data-testid="square-tax-check">
        <span className="text-sm" style={labelStyle}>
          {SQUARE_APP_WORDS.taxUnknown}
        </span>
        {checkAgain}
      </div>
    );
  } else if (check.taxes.state === 'needs_allow') {
    taxBlock = (
      <div className="flex flex-col gap-2" data-testid="square-tax-check">
        {reconnect}
      </div>
    );
  } else if (check.taxes.state === 'none') {
    taxBlock = (
      <div className="flex flex-col gap-2" data-testid="square-tax-check">
        <span className="flex items-start gap-2 text-sm" style={labelStyle}>
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--good)' }} aria-hidden="true" />
          <span>{SQUARE_APP_WORDS.taxNone}</span>
        </span>
        {check.membershipTax ? null : (
          <>
            <span className="text-sm" style={softStyle}>
              {SQUARE_APP_WORDS.noMembershipTax}
            </span>
            {setTax(check)}
          </>
        )}
      </div>
    );
  } else {
    const { taxes, exampleMinor, chargedMinor } = check.taxes;
    const bill = formatMinor(exampleMinor, check.currency);
    taxBlock = (
      <div className="flex flex-col gap-2" data-testid="square-tax-check">
        <span className="flex items-start gap-2 text-sm font-semibold" style={{ color: '#fff' }}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} aria-hidden="true" />
          <span>{SQUARE_APP_WORDS.taxAdds(squareTaxNames(taxes))}</span>
        </span>
        <span className="text-sm" style={labelStyle}>
          {SQUARE_APP_WORDS.taxExample(bill, formatMinor(chargedMinor, check.currency))}
        </span>
        <span className="text-sm font-semibold" style={labelStyle}>
          {SQUARE_APP_WORDS.taxFixLead}
        </span>
        <ul className="m-0 pl-5 flex flex-col gap-2 list-disc">
          <li className="text-sm" style={labelStyle}>
            {SQUARE_APP_WORDS.taxFixSquare(taxes.length > 1)}
          </li>
          <li className="text-sm flex flex-col gap-2" style={labelStyle}>
            <span>{SQUARE_APP_WORDS.taxFixHere}</span>
            {setTax(check)}
          </li>
          <li className="text-sm" style={labelStyle}>
            {SQUARE_APP_WORDS.taxFixItems}
          </li>
        </ul>
        {checkAgain}
      </div>
    );
  }

  return (
    <section aria-label={SQUARE_APP_WORDS.heading} className="flex flex-col gap-3">
      {heading}
      <p className="text-sm m-0" style={labelStyle}>
        {SQUARE_APP_WORDS.intro}
      </p>
      <p className="text-sm font-semibold m-0" style={labelStyle}>
        {SQUARE_APP_WORDS.setupLead}
      </p>
      <ol className="m-0 rounded-xl px-4 py-3 flex flex-col gap-3 list-decimal list-inside" style={boxStyle}>
        <li className="text-sm" style={labelStyle}>
          {SQUARE_APP_WORDS.customers}
        </li>
        <li className="text-sm" style={labelStyle}>
          <div className="inline-flex flex-col gap-2 align-top" style={{ width: 'calc(100% - 1.5rem)' }}>
            {taxBlock}
          </div>
        </li>
      </ol>
      <p className="text-sm m-0" style={softStyle}>
        {SQUARE_APP_WORDS.linked}
      </p>
      <p className="text-sm m-0" style={softStyle}>
        {SQUARE_APP_WORDS.items}
      </p>
    </section>
  );
}
