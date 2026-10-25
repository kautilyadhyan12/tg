import { Loader2 } from 'lucide-react';
import { SQUARE_APP_WORDS } from '@app/shared';
import { readOnlyNote } from '../../pages/console/billingView';

// PAYMENTS TAKEN IN SQUARE POINT OF SALE (ROADMAP 18d-iii-b-i), in the connected Payments box: how the gym
// sets up Square's own app so a payment staff take there, picking the person and typing the bill's total,
// is recorded on that person's bill here. A gym connected before the app could read what was sold
// connects Square again, once; only the owner does, as only the owner connects Square.

const labelStyle = { color: 'rgba(255,255,255,0.85)' };
const softStyle = { color: 'rgba(255,255,255,0.55)' };
const boxStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' };
const mainButton = (on) => ({
  background: on ? 'linear-gradient(135deg,#FF8A1F,#FFB347)' : 'rgba(255,255,255,0.08)',
  color: on ? '#0A0908' : 'rgba(255,255,255,0.35)',
});

export default function SquareAppPayments({ org, squareApp, owner, readOnly, onConnectAgain, connecting = false }) {
  const heading = (
    <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
      {SQUARE_APP_WORDS.heading}
    </p>
  );

  if (squareApp.needsAllow) {
    return (
      <section aria-label={SQUARE_APP_WORDS.heading} className="flex flex-col gap-3">
        {heading}
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
      </section>
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
      <ol className="m-0 rounded-xl px-4 py-3 flex flex-col gap-2 list-decimal list-inside" style={boxStyle}>
        <li className="text-sm" style={labelStyle}>
          {SQUARE_APP_WORDS.customers}
        </li>
        <li className="text-sm" style={labelStyle}>
          {SQUARE_APP_WORDS.tax}
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
