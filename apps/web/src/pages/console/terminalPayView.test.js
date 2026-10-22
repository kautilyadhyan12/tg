import { describe, expect, it } from 'vitest';
import { terminalPayOutcomeLine, terminalPayWaitWords, tillSetupView } from './terminalPayView';

// Take payment on Terminal at Sell (18d-vi-b-ii): what Sell says about the gym's Square, and how a
// sale on the Terminal ends, for every case the server can answer.
const till = (over = {}) => ({ square: 'ready', isOwner: true, terminals: [{ id: 't1', serial: 'R5A', practice: null }], pairTerminal: false, waiting: [], ...over });
const sale = (over = {}) => ({ id: 'p1', forSale: true, amountMinor: 1900, currency: 'USD', step: 'done', outcome: 'paid', ...over });

describe("Sell's line about Square, for whoever reads it (Kd, 2026-10-22)", () => {
  it.each([
    ['not answered yet', null, null],
    ['Square takes no payments in this country', till({ square: 'not_offered', terminals: [] }), null],
    ['ready, with a Terminal', till(), null],
    ['ready, no Terminal, not the owner', till({ terminals: [], pairTerminal: false, isOwner: false }), null],
    // The same words the payment forms say (18x): one sentence for one thing on every screen.
    ['not connected, the owner', till({ square: 'connect', terminals: [] }), { line: 'Take cards with Square.', button: 'Connect Square' }],
    ['no location yet, the owner', till({ square: 'choose_location', terminals: [] }), { line: 'Choose your Square location to take cards.', button: 'Choose location' }],
    ['not connected, staff', till({ square: 'connect', isOwner: false, terminals: [] }), { line: 'Only the owner of Iron House can connect Square.', button: null }],
    ['no location yet, staff', till({ square: 'choose_location', isOwner: false, terminals: [] }), { line: 'Only the owner of Iron House can connect Square.', button: null }],
    ['connected, its Terminal permission gone, the owner', till({ terminals: [], reconnect: true }), { line: 'Reconnect Square to use Square Terminals.', button: 'Reconnect Square' }],
    ['connected, its Terminal permission gone, staff', till({ terminals: [], reconnect: true, isOwner: false }), { line: 'Only the owner of Iron House can connect Square.', button: null }],
    ['ready, no Terminal, the owner', till({ terminals: [], pairTerminal: true }), { line: 'To take card payments here, pair your Square Terminal.', button: 'Pair a Terminal' }],
  ])('%s', (_name, answer, said) => {
    expect(tillSetupView(answer, 'Iron House')).toEqual(said);
  });
});

describe('a sale on the Terminal: who pays, and how it ended', () => {
  it('names the buyer where one is picked, and the customer for a walk-in', () => {
    expect(terminalPayWaitWords(sale({ step: 'waiting', outcome: null }), null).title).toBe('Waiting for the customer to pay $19.00 on the Terminal');
    expect(terminalPayWaitWords(sale({ step: 'waiting', outcome: null }), 'Maya Patel').card).toBe('Maya taps, inserts or swipes their card.');
  });

  it.each([
    ['paid', null, '$19.00 paid by card on the Terminal. Sale recorded.'],
    ['cancelled_on_terminal', null, 'Not paid. The customer cancelled on the Terminal. Nothing was charged.'],
    ['cancelled_on_terminal', 'Maya Patel', 'Not paid. Maya cancelled on the Terminal. Nothing was charged.'],
    ['timed_out', null, 'Not paid. Time ran out on the Terminal. Nothing was charged.'],
    ['no_answer', null, "Not paid. The Terminal didn't respond. Check it's on and connected, then try again. Nothing was charged."],
    ['cancelled', null, 'Cancelled. Nothing was charged.'],
    ['refused', null, "Not paid. Square couldn't take this payment. Nothing was charged."],
    ['gone', null, "This payment can't be checked here any more. Look in your Square Dashboard before taking it again."],
    ['not_recorded', null, "Square took another amount than this sale's $19.00, so the sale isn't recorded. Refund it in your Square Dashboard, then take payment again."],
  ])('%s (%s)', (outcome, name, line) => {
    expect(terminalPayOutcomeLine(sale({ outcome }), name, 1900)).toBe(line);
  });
});
