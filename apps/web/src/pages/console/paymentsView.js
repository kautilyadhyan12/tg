// THE PAYMENTS BOX IN SETTINGS (ROADMAP 18d-i): what it says, for each gym and each person.
// The server sends the gym's country, whether this person is the gym's own owner (who alone
// connects Square) and the connection; nothing here decides either.
import { momentLabel } from './checkinDevicesView';

/** Country names from the browser's own list; the two-letter code when it has none. */
function countryNameOf(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** "19 Oct 2026", on the gym's own calendar. */
export function paymentsDay(iso, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }
}

/** The box's one line while it is closed. */
export function paymentsSummary(payments) {
  if (payments === null || payments === undefined) return null;
  const square = payments.square;
  if (square !== null && square.state === 'connected') return square.businessName === '' ? 'Connected to Square' : `Connected to Square · ${square.businessName}`;
  if (square !== null && square.state === 'choose_location') return 'Connected to Square · choose your location';
  if (square !== null && square.state === 'removed') return 'Square was disconnected';
  switch (payments.availability) {
    case 'square':
      return 'Not connected';
    case 'india_soon':
      return 'Coming soon in India';
    case 'not_available':
      return `Not available in ${countryNameOf(payments.country)} yet`;
    default:
      return 'Choose your country first';
  }
}

const DESK_LINE = `Until then, record the payments you take at the desk on each person's page.`;

/** What the box says to a gym Square does not serve, or one with no country yet. */
export function paymentsElsewhereLine(payments) {
  switch (payments.availability) {
    case 'india_soon':
      return `Card and UPI payments for gyms in India are coming soon. ${DESK_LINE}`;
    case 'not_available':
      return `Card payments aren't available for gyms in ${countryNameOf(payments.country)} yet. ${DESK_LINE}`;
    case 'no_country':
      return 'Choose your country first. The card payments you can take depend on where you are.';
    default:
      return null;
  }
}

// Kd's own words, at 18d-i's click-through.
export const SQUARE_HEADING = 'Connect Square for member payments';
export const SQUARE_INTRO = 'Accept payments from your members through Square. Payments are deposited directly into your bank account, and Square applies its standard processing fees.';
export const SQUARE_NO_FEE = 'No additional fees from us.';
export const SQUARE_NEW_ACCOUNT = `Don't have a Square account? You can create one for free when you connect Square.`;

export const ownerOnlyLine = (gymName, again = false) => `Only the owner of ${gymName} can connect Square${again ? ' again' : ''}.`;

/** The connected box's rows, as gym software lists a connected account. */
export function squareRows(square, timeZone) {
  const rows = [];
  if (square.businessName !== '') rows.push({ label: 'Business', value: square.businessName });
  if (square.locationName !== null) rows.push({ label: 'Location', value: square.locationName });
  rows.push({ label: 'Connected', value: paymentsDay(square.connectedAt, timeZone) });
  return rows;
}

export function removedLine(square, timeZone) {
  const who = square.businessName === '' ? 'your Square account' : `${square.businessName}'s Square account`;
  return `The connection to ${who} ended on ${paymentsDay(square.removedAt ?? square.connectedAt, timeZone)}.`;
}

export function disconnectWords(square, gymName) {
  const account = square.businessName === '' ? 'your Square account' : `${square.businessName}'s Square account`;
  return {
    question: 'Disconnect Square?',
    changes: `${gymName} stops using ${account}.`,
    kept: 'Your Square account and its money stay as they are, and you can connect it again at any time.',
  };
}

// ── The way back from Square (`/connect/square`) ──

/** The gym whose Connect Square was pressed in this tab, so a failed return still has a way
 *  back to its Payments box. Kept per tab, and only as a convenience. */
const PRESSED_KEY = 'squareConnectGym';

export function rememberSquarePress(orgSlug) {
  try {
    window.sessionStorage.setItem(PRESSED_KEY, orgSlug);
  } catch {
    // A tab that keeps nothing still connects; it only loses the way back on a failure.
  }
}

export function pressedGym() {
  try {
    return window.sessionStorage.getItem(PRESSED_KEY);
  } catch {
    return null;
  }
}

export const NOT_FROM_SQUARE = 'This page opens when you come back from Square. Nothing was connected.';

/** What Square put on the address: a code after Allow, an error after Deny, or neither. */
export function squareAnswer(params) {
  const state = params.get('state');
  const code = params.get('code');
  const error = params.get('error');
  if (state === null) return null;
  if (code !== null) return { state, code };
  if (error !== null) return { state, error };
  return null;
}

/** What the return from Square says, in the box, in one sentence. */
export function squareOutcomeLine(answer, gymName, gymCountry) {
  if (answer === null || answer === undefined) return null;
  switch (answer.outcome) {
    case 'connected':
      return 'Square is connected.';
    case 'choose_location':
      return `Square is connected. Choose which of its locations is ${gymName}.`;
    case 'connected_again':
      return 'Square is reconnected.';
    case 'already_connected':
      return 'Square was already connected.';
    case 'cancelled':
      return `Square wasn't connected: Allow wasn't pressed on Square's page.`;
    default:
      break;
  }
  const refusal = answer.refusal;
  switch (refusal?.reason) {
    case 'wrong_country': {
      const here = countryNameOf(gymCountry);
      return `That Square account is in ${countryNameOf(refusal.squareCountry)}, and ${gymName} is in ${here}. Connect the Square account you use in ${here}.`;
    }
    case 'wrong_currency':
      return `That Square account takes ${refusal.squareCurrency}, and ${gymName}'s prices aren't in ${refusal.squareCurrency}. Connect the Square account you use for ${gymName}.`;
    case 'no_card_location':
      return 'That Square account has no location that can take card payments yet. Finish setting it up in Square, then press Connect Square again.';
    case 'square_said_no':
      return `Square didn't accept that sign-in. Press Connect Square to try again.`;
    case 'other_account':
      return `That Square account isn't the one connected to ${gymName}. Sign in to the connected account, then reconnect.`;
    default:
      return `Square didn't answer. Press Connect Square to try again in a minute.`;
  }
}

// ── Square Terminals (ROADMAP 18d-ii-b-i): pairing as Square's Dashboard and Stripe Terminal word it ──

/** Square's simulated Terminals, in its sandbox only (Stripe calls its own "simulated readers"),
 *  added by a tester's tool and never from a screen. */
export const PRACTICE_TERMINAL_WORDS = {
  saves: 'Card saved',
  declines: 'Member declines',
  cancels: 'Member cancels',
  times_out: 'Times out',
  offline: 'Offline',
};

export function terminalName(terminal) {
  return terminal.practice === null ? 'Square Terminal' : `Simulated Terminal · ${PRACTICE_TERMINAL_WORDS[terminal.practice] ?? terminal.practice}`;
}

/** The line under a Terminal's name: its serial number, as printed under it, and the day. */
export function terminalDetail(terminal, timeZone) {
  const day = paymentsDay(terminal.pairedAt, timeZone);
  if (terminal.practice !== null) return `Added ${day}`;
  return terminal.serial === null ? `Paired ${day}` : `Serial ${terminal.serial} · Paired ${day}`;
}

/** Said where Pair a Terminal was pressed. */
export const PAIRED_TERMINAL = 'Terminal paired.';

export const REMOVED_TERMINAL = 'Terminal removed.';

export function removeTerminalWords(terminal, gymName) {
  return {
    question: 'Remove this Terminal?',
    changes: `It will no longer be available to ${gymName}.`,
    kept: terminal.practice === null ? 'It stays signed in to Square. To sign it out, go to Settings > Sign out on the Terminal.' : "It's a simulated Terminal in Square's sandbox.",
  };
}

/** What the owner does at the Terminal, in Square's own order. */
export const PAIR_STEPS = ['If the Terminal is signed in, sign out first (Settings > Sign out).', 'Tap Sign in, then Use a device code.', 'Enter this code:'];

export const pairingUntilLine = (iso, clock) => {
  const time = momentLabel(iso, clock);
  return time === '' ? 'Expires in 5 minutes' : `Expires at ${time}`;
};

export const PAIRING_WAITING = 'Waiting for the Terminal…';
export const PAIRING_EXPIRED = 'This code has expired.';
export const pairingActiveLine = (iso, clock) => {
  const time = momentLabel(iso, clock);
  return `A pairing code is active${time === '' ? '' : ` until ${time}`}. Get a new code if you no longer have it.`;
};
export const NO_TERMINALS = 'No Terminals paired yet.';
export const NEEDS_ALLOW_LINE = 'Reconnect Square to use Square Terminals.';
export const NEEDS_ALLOW_HINT = 'Square will ask you to approve device access and in-person payments.';
export const NEEDS_ALLOW_OTHERS = 'The owner needs to reconnect Square before Terminals can be used.';
export const TERMINAL_OWNER_ONLY = 'Only the owner can pair or remove Terminals.';
