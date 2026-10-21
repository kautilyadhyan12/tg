import { MEMBER_CARD_WORDS, cardEarlierLine, cardName, cardOnFileLine, cardOwnerOnlyLine, cardPaidByLine } from '@app/shared';
import { PRACTICE_TERMINAL_WORDS } from './paymentsView';

// CARD ON FILE, ON A PERSON'S PAGE (ROADMAP 18d-ii): what the box says, from the server's
// answer. Only staff holding the payments tick open it; a gym outside Square's countries shows
// nothing at all.

/** The name a sentence uses, and the first name. */
export function personNames(name) {
  const full = typeof name === 'string' && name.trim() !== '' ? name.trim() : '';
  if (full === '') return { full: 'this person', first: 'This person' };
  return { full, first: full.split(/\s+/)[0] ?? full };
}

/** What the box draws. `connect`: the owner's button to Square's box in Settings, as 'connect'
 *  or 'choose' (a location still to pick), or null. */
export function cardBoxView(view, name) {
  if (view === null || view.state === 'not_offered') return null;
  const who = personNames(name);
  const ready = view.state === 'ready';
  const card = view.card;
  const paidBy =
    view.paidBy === null
      ? null
      : { entryId: view.paidBy.entryId, name: view.paidBy.name || 'Somebody else on your list', line: cardPaidByLine(view.paidBy.name || 'Somebody else on your list', who.full) };
  const ownerOnly = !ready && !view.isOwner ? cardOwnerOnlyLine(view.gymName) : null;
  return {
    cardLine: card === null ? null : cardOnFileLine(card),
    expired: card?.expired === true,
    noneLine: card === null && paidBy === null ? MEMBER_CARD_WORDS.none : null,
    // A card saved on the Square account the gym used before (a hand-over, Kd 2026-10-20): it is
    // never charged from here, so they are asked for it again.
    earlierLine: ready && card === null && paidBy === null && view.earlierCard !== null ? cardEarlierLine(view.earlierCard, view.gymName) : null,
    paidBy,
    canAdd: ready && view.canChange && paidBy === null && view.form !== null,
    canRemove: ready && view.canChange && card !== null,
    // Save card on Terminal (18d-ii-b-ii): the gym's paired Terminals, and for the owner with none
    // paired, Pair a Terminal.
    terminals: ready && view.canChange && paidBy === null ? (view.terminals ?? []) : [],
    pairTerminal: ready && view.canChange && paidBy === null && view.isOwner && view.pairTerminal === true,
    appLine: ready && card === null && paidBy === null && view.inApp ? `${who.first} can add a card in the app.` : null,
    connect: ready || !view.isOwner ? null : view.state === 'choose_location' ? 'choose' : 'connect',
    connectLine: ready || !view.isOwner ? null : view.state === 'choose_location' ? MEMBER_CARD_WORDS.choose_location : MEMBER_CARD_WORDS.connect,
    ownerOnly,
  };
}

/** The box that opens under Add card or Replace card. */
export function cardFormWords(view, name) {
  const who = personNames(name);
  const card = view.card;
  return {
    title: card === null ? `Add a card for ${who.full}` : `Replace ${cardName(card)}`,
    detail: card === null ? null : `The new card takes the place of ${cardName(card)}.`,
    tickHint: `${who.first} reads and ticks this box.`,
  };
}

/** What a save says, where it was pressed. */
export const cardSavedLine = (card) => `Card saved: ${cardName(card)}.`;
export const cardRemovedLine = (card) => `Card removed: ${cardName(card)}.`;

/** Remove card asks first, under the button. */
export function removeCardWords(view, name) {
  const who = personNames(name);
  const card = view.card;
  return {
    question: `Remove ${card === null ? 'the card' : cardName(card)} from ${who.full}?`,
    detail: `${view.gymName} can't charge this card after it's removed. You can add a card again at any time.`,
    button: 'Remove card',
  };
}

export const CARD_FORM_DIDNT_LOAD = "Square's card form didn't load. Check your internet connection, then try again.";
export const CARD_NOT_TAKEN = 'Check the card details, then try again.';

// ── Save card on Terminal (ROADMAP 18d-ii-b-ii): the person agrees and gives their card on the gym's
// Square Terminal; typing the card stays, as "Type card instead". ──

/** The box under Save card on Terminal, while it waits: who does what at the Terminal, in Square's
 *  order. `entry` is how the card goes in where the gym is. */
export function terminalWaitWords(save, name) {
  const who = personNames(name);
  return {
    title: `Waiting for ${who.first} on the Terminal`,
    agree: `${who.first} reads the agreement and taps "I agree".`,
    card:
      save.entry === 'swipe'
        ? `${who.first} swipes their card, then follows the steps on the Terminal.`
        : `${who.first} inserts or swipes their card, then follows the steps on the Terminal.`,
    notShown: "The Terminal hasn't shown it yet. Check it's on and connected to the internet.",
  };
}

/** How a save on the Terminal ended, said where it was pressed. */
export function terminalOutcomeLine(save, card, name) {
  const who = personNames(name);
  switch (save.outcome) {
    case 'saved':
      return card === null ? 'Card saved.' : cardSavedLine(card);
    case 'not_agreed':
      return `Not saved. ${who.first} didn't agree.`;
    case 'cancelled_on_terminal':
      return 'Not saved. It was cancelled on the Terminal.';
    case 'timed_out':
      return 'Not saved. Time ran out on the Terminal.';
    case 'no_answer':
      return "Not saved. The Terminal didn't respond. Check it's on and connected, then try again.";
    case 'cancelled':
      return 'Cancelled. Nothing was saved.';
    case 'refused':
      return "Not saved. Square couldn't save the card. Try again, or type the card instead.";
    default:
      return 'Not saved. Try again.';
  }
}

/** A Terminal as the person at the desk knows it: Square's name, and the serial number printed
 *  under it when there is more than one to tell apart. */
export function cardTerminalName(terminal) {
  if (terminal === null) return 'Square Terminal';
  return terminal.practice === null ? 'Square Terminal' : `Simulated Terminal · ${PRACTICE_TERMINAL_WORDS[terminal.practice] ?? terminal.practice}`;
}
export const cardTerminalSerial = (terminal) => (terminal?.serial == null ? null : `Serial ${terminal.serial}`);

export const CHOOSE_TERMINAL = 'Choose a Terminal';
