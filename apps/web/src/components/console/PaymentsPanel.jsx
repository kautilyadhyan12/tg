import { useCallback, useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import {
  SQUARE_HEADING,
  SQUARE_INTRO,
  SQUARE_NEW_ACCOUNT,
  SQUARE_NO_FEE,
  disconnectWords,
  ownerOnlyLine,
  paymentsElsewhereLine,
  paymentsSummary,
  rememberSquarePress,
  removedLine,
  squareOutcomeLine,
  squareRows,
} from '../../pages/console/paymentsView';
import PlaceLink from './PlaceLink';
import SquareTerminals from './SquareTerminals';
import { ConsoleFailed, ConsoleLoading, ConsoleSection } from './ConsoleStates';

// PAYMENTS (ROADMAP 18d-i): the gym connects its own Square account, so its members' card
// payments go to the gym's own bank account. Only the gym's own owner connects, picks the
// location and disconnects; everybody else who opens Settings reads it, with a line saying who
// can. Connect Square opens Square's own page in this tab, and Square sends the person back to
// `/connect/square`, which brings them here with what happened (`outcome`). Connected in the US,
// Canada or Australia, the box lists the gym's Square Terminals (18d-ii-b-i); connected anywhere, it
// says how to set up Square's own app for payments taken there (18d-iii-b-i).

const labelStyle = { color: 'rgba(255,255,255,0.85)' };
const hintStyle = { color: 'rgba(255,255,255,0.45)' };
const softStyle = { color: 'rgba(255,255,255,0.55)' };
const boxStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' };
const mainButton = (on) => ({
  background: on ? 'linear-gradient(135deg,#FF8A1F,#FFB347)' : 'rgba(255,255,255,0.08)',
  color: on ? '#0A0908' : 'rgba(255,255,255,0.35)',
});

// `openSquare`: how Square's page is opened; a test watches it instead of leaving the page.
const goTo = (url) => window.location.assign(url);

export default function PaymentsPanel({ org, readOnly, startOpen = false, outcome = null, countryTo = null, openSquare = goTo }) {
  const gymId = org.id;
  const pickName = useId();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(null);
  // What the last press did, said where it was pressed; Square's answer on the way back first.
  const [doneLine, setDoneLine] = useState(() => squareOutcomeLine(outcome, org.name, org.country ?? null));
  const [asking, setAsking] = useState(false);
  const [picked, setPicked] = useState(null);

  const fetchPayments = useCallback(
    (isLive = () => true) =>
      orgService
        .getGymPayments(gymId)
        .then((res) => {
          if (isLive()) setData(res.data.payments);
        })
        .catch((err) => {
          if (isLive()) setLoadError(errorText(err, "We couldn't load your payments."));
        }),
    [gymId],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchPayments(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [fetchPayments]);

  const retry = () => {
    setLoadError(null);
    void fetchPayments();
  };

  const connect = async () => {
    setBusy('connect');
    setActionError(null);
    setDoneLine(null);
    try {
      const res = await orgService.connectSquare(gymId);
      rememberSquarePress(org.slug);
      // Square's own page, in this tab; Square sends the person back to /connect/square.
      openSquare(res.data.url);
    } catch (err) {
      setActionError(errorText(err, "We couldn't open Square. Try again in a minute."));
      setBusy(null);
    }
  };

  const chooseLocation = async (event) => {
    event.preventDefault();
    if (picked === null) return;
    setBusy('location');
    setActionError(null);
    try {
      const res = await orgService.chooseSquareLocation(gymId, picked);
      setData(res.data.payments);
      setDoneLine(`${res.data.payments.square?.locationName ?? 'That location'} is set as ${org.name}'s Square location.`);
    } catch (err) {
      setActionError(errorText(err, "We couldn't save the location."));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    setActionError(null);
    try {
      const res = await orgService.disconnectSquare(gymId);
      setData(res.data.payments);
      setAsking(false);
      setDoneLine('Square is disconnected.');
    } catch (err) {
      setActionError(errorText(err, "We couldn't disconnect Square."));
    } finally {
      setBusy(null);
    }
  };

  const square = data?.square ?? null;
  const owner = data?.canConnect === true;
  const timeZone = org.timezone;

  const connectButton = (label = 'Connect Square') => (
    <button
      type="button"
      onClick={() => void connect()}
      disabled={busy !== null || readOnly}
      className="self-start rounded-full px-5 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-40 min-h-11"
      style={mainButton(busy === null && !readOnly)}
    >
      {busy === 'connect' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
      {busy === 'connect' ? 'Opening Square…' : label}
    </button>
  );

  const doneAndError = (
    <>
      {actionError !== null ? <ConsoleFailed message={actionError} /> : null}
      {doneLine !== null ? (
        <p role="status" className="text-sm m-0" style={labelStyle}>
          {doneLine}
        </p>
      ) : null}
    </>
  );

  // Disconnect, the owner's, wherever the box shows a connection: also while a location is
  // still to be chosen, and on a lapsed plan.
  const disconnectArea = (live) => {
    const words = disconnectWords(live, org.name);
    return (
      <>
        {owner && !asking ? (
          <button
            type="button"
            onClick={() => {
              setAsking(true);
              setDoneLine(null);
            }}
            disabled={busy !== null}
            className="self-start rounded-full px-4 py-3 text-sm font-semibold disabled:opacity-40 min-h-11"
            style={{ border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.85)' }}
          >
            Disconnect Square
          </button>
        ) : null}
        {owner && asking ? (
          <div role="group" aria-label={words.question} className="rounded-xl px-4 py-3 flex flex-col gap-2" style={boxStyle}>
            <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
              {words.question}
            </p>
            <p className="text-sm m-0" style={labelStyle}>
              {words.changes}
            </p>
            <p className="text-sm m-0" style={softStyle}>
              {words.kept}
            </p>
            <div className="flex flex-wrap gap-3 mt-1">
              <button
                type="button"
                onClick={() => void disconnect()}
                disabled={busy !== null}
                className="rounded-full px-4 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-40 min-h-11"
                style={{ background: 'rgba(239,68,68,0.18)', color: '#fca5a5' }}
              >
                {busy === 'disconnect' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Disconnect
              </button>
              <button
                type="button"
                onClick={() => setAsking(false)}
                disabled={busy !== null}
                className="rounded-full px-4 py-3 text-sm font-semibold min-h-11"
                style={{ background: 'rgba(255,255,255,0.07)', color: '#fff' }}
              >
                Keep connected
              </button>
            </div>
          </div>
        ) : null}
        {!owner ? (
          <p className="text-sm m-0" style={softStyle}>
            Only the owner of {org.name} can disconnect Square.
          </p>
        ) : null}
      </>
    );
  };

  let body = null;
  if (data !== null) {
    const elsewhere = paymentsElsewhereLine(data);
    // A connection first, whatever the gym's country reads now: what is connected is always
    // shown, with its Disconnect.
    if (square !== null && square.state === 'choose_location') {
      body = (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
            {paymentsSummary(data)}
          </p>
          {doneAndError}
          {owner ? (
            <form onSubmit={chooseLocation} className="flex flex-col gap-3">
              <fieldset className="flex flex-col gap-2 m-0 p-0 border-0">
                <legend className="text-sm mb-2" style={labelStyle}>
                  Which of this Square account&apos;s locations is {org.name}?
                </legend>
                {square.locations.map((place) => (
                  <label key={place.id} className="flex items-center gap-3 rounded-xl px-4 min-h-11 cursor-pointer" style={boxStyle}>
                    <input type="radio" name={pickName} value={place.id} checked={picked === place.id} onChange={() => setPicked(place.id)} disabled={busy !== null || readOnly} />
                    <span className="text-sm" style={{ color: '#fff' }}>
                      {place.name}
                    </span>
                  </label>
                ))}
              </fieldset>
              <button
                type="submit"
                disabled={picked === null || busy !== null || readOnly}
                className="self-start rounded-full px-5 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-40 min-h-11"
                style={mainButton(picked !== null && busy === null && !readOnly)}
              >
                {busy === 'location' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Use this location
              </button>
            </form>
          ) : (
            <p className="text-sm m-0" style={softStyle}>
              The owner of {org.name} still needs to choose which Square location this is.
            </p>
          )}
          {disconnectArea(square)}
        </div>
      );
    } else if (square !== null && square.state === 'connected') {
      body = (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
            Connected to Square
          </p>
          <dl className="m-0 rounded-xl px-4 py-3 grid gap-x-4 gap-y-1.5" style={{ ...boxStyle, gridTemplateColumns: 'auto 1fr' }}>
            {squareRows(square, timeZone).map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-sm" style={hintStyle}>
                  {row.label}
                </dt>
                <dd className="text-sm m-0" style={{ color: '#fff' }}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {doneAndError}
          {data.terminals ? (
            <SquareTerminals
              org={org}
              terminals={data.terminals}
              owner={owner}
              readOnly={readOnly}
              onPayments={setData}
              onReload={() => void fetchPayments()}
              onConnectAgain={() => void connect()}
              connecting={busy === 'connect'}
            />
          ) : null}
          {disconnectArea(square)}
        </div>
      );
    } else if (elsewhere !== null) {
      body = (
        <div className="flex flex-col gap-3">
          {doneAndError}
          <p className="text-sm m-0" style={labelStyle}>
            {elsewhere}
          </p>
          {data.availability === 'no_country' && countryTo !== null ? (
            <PlaceLink to={countryTo} className="c-lk text-sm self-start">
              Choose your country
            </PlaceLink>
          ) : null}
        </div>
      );
    } else if (!data.squareReady) {
      body = (
        <p className="text-sm m-0" style={labelStyle}>
          Square can&apos;t be connected on this server yet.
        </p>
      );
    } else {
      body = (
        <div className="flex flex-col gap-3">
          {square !== null ? (
            <div role="note" className="rounded-xl px-4 py-3 flex flex-col gap-1" style={boxStyle}>
              <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
                Square was disconnected
              </p>
              <p className="text-sm m-0" style={labelStyle}>
                {removedLine(square, timeZone)}
              </p>
            </div>
          ) : null}
          <p className="text-base font-bold m-0" style={{ color: '#fff' }}>
            {SQUARE_HEADING}
          </p>
          <p className="text-sm m-0" style={labelStyle}>
            {SQUARE_INTRO}
          </p>
          <p className="text-sm m-0" style={labelStyle}>
            {SQUARE_NO_FEE}
          </p>
          {owner ? (
            <>
              <p className="text-sm m-0" style={softStyle}>
                {SQUARE_NEW_ACCOUNT}
              </p>
              {doneAndError}
              {connectButton(square === null ? 'Connect Square' : 'Connect Square again')}
            </>
          ) : (
            <>
              {doneAndError}
              <p className="text-sm m-0" style={softStyle}>
                {ownerOnlyLine(org.name, square !== null)}
              </p>
            </>
          )}
        </div>
      );
    }
  }

  return (
    <ConsoleSection title="Payments" summary={paymentsSummary(data)} forceOpen={loadError !== null || outcome !== null} defaultOpen={startOpen}>
      {readOnly && owner && (square === null || square.state !== 'connected') ? (
        <p className="text-xs mb-3" style={hintStyle}>
          {readOnlyNote(org.orgType)}
        </p>
      ) : null}
      {loadError !== null ? <ConsoleFailed message={loadError} onRetry={retry} /> : data === null ? <ConsoleLoading label="Loading…" /> : body}
    </ConsoleSection>
  );
}
