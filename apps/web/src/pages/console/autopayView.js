// PAUSE AUTOMATIC PAYMENTS, UNDER CARD ON FILE (ROADMAP 18d-iv-f; spec Part 3 §14.8): what the boxes and lines say, from the server's
// answers. Pure, so the tests read every case without a browser. The card stays saved; bills still come due.
import { cardName } from '@app/shared';
import { dayWords } from './memberListView';

/** How many names a box shows before "and N more". */
export const AUTOPAY_NAMES_SHOWN = 5;

/** The line while it stands, on the page of whoever pays. */
export const autopayPausedLine = (on) => `Automatic payments paused on ${dayWords(on)}.`;

/** The line on the page of somebody whose payer paused them. */
export const autopayPayerPausedLine = (payerName) => `Automatic payments are paused on ${payerName}'s card.`;

const peopleOf = (preview) => preview.people.map((p) => (p.what === '' ? p.name : `${p.name} · ${p.what}`));

/** The box under Pause automatic payments. */
export function autopayPauseBox(preview) {
  const card = preview.card === null ? 'The card' : cardName(preview.card);
  const people = peopleOf(preview);
  return {
    title: 'Pause automatic payments?',
    lead: people.length === 0 ? 'Nobody this card pays for has a renewing membership, so nothing is charged automatically now.' : `${card} won't be charged automatically for:`,
    people,
    more: preview.more,
    note: 'The card stays saved. Bills still come due: take payment at the desk, or charge the card from the bill.',
    button: 'Pause',
  };
}

/** What is said in that place once paused. */
export const autopayPausedWords = (preview) => `Automatic payments paused. ${preview.card === null ? 'The card' : cardName(preview.card)} stays saved.`;

/** The box under Resume automatic payments. */
export function autopayResumeBox(preview) {
  const card = preview.card === null ? null : cardName(preview.card);
  const people = peopleOf(preview);
  let lead;
  if (preview.chargebackStops) lead = people.length === 0 ? 'A chargeback still pauses automatic payments until it is closed.' : 'A chargeback still pauses automatic payments, so nothing will be charged until it is closed. This applies to:';
  else if (people.length === 0) lead = 'Nobody this card pays for has a renewing membership, so nothing will be charged.';
  else if (card === null) lead = 'No card is on file, so nothing will be charged until one is added. This applies to:';
  else lead = `${card} will be charged automatically for:`;
  return {
    title: 'Resume automatic payments?',
    lead,
    people,
    more: preview.more,
    note: preview.chargebackStops || people.length === 0 || card === null ? null : 'A bill due in the last two days may be charged today. Charge older bills by hand, oldest first.',
    button: 'Resume',
  };
}

/** What is said in that place once resumed. */
export function autopayResumedWords(preview) {
  if (preview.chargebackStops) return 'Automatic payments resumed. A chargeback still pauses them until it is closed.';
  if (preview.people.length === 0) return 'Automatic payments resumed. Nobody this card pays for has a renewing membership, so nothing will be charged.';
  if (preview.card === null) return 'Automatic payments resumed. Nothing will be charged until a card is on file.';
  return `Automatic payments resumed. ${cardName(preview.card)} will be charged when bills are due.`;
}
