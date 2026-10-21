// Save card on Terminal, on a person's page (spec Part 3 §14.5; ROADMAP 18d-ii-b-ii).
//
// THE WORST THING THIS BOX COULD DO: send the Terminal for somebody other than the person whose
// page it is, or say a card was saved when the server didn't. So the first test: the press sends
// this page's own record and the Terminal pressed, the box says "Card saved" only on the server's
// own answer, and an answer about another person's page is never drawn here.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { cardAgreementWords } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMemberCard: vi.fn(),
      saveMemberCard: vi.fn(),
      removeMemberCard: vi.fn(),
      startTerminalSave: vi.fn(),
      checkTerminalSave: vi.fn(),
      cancelTerminalSave: vi.fn(),
    },
  };
});
vi.mock('./squareCard', () => ({ attachCardForm: vi.fn(() => Promise.resolve({ destroy: () => Promise.resolve(true) })), tokenizeToSave: vi.fn() }));

const { orgService } = await import('../../api/orgsApi');
const square = await import('./squareCard');
const MemberCard = (await import('./MemberCard')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const TARA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ZED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DESK = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', serial: 'R5WNWB5BKNG9R', practice: null };
const BACK = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', serial: 'R5ZZQ1PQRS4TT', practice: null };
const SAVE_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const IRON = { name: 'Iron House', slug: 'iron-house', timezone: 'America/Chicago', privileges: ['members.confirm', 'billing.members'] };
const FORM = {
  environment: 'sandbox',
  applicationId: 'sandbox-sq0idb-CONSOLETESTAPP',
  locationId: 'LIRONHOUSE',
  contact: { givenName: 'Tara', familyName: 'Singh', email: 'tara@example.com', countryCode: 'US' },
};
const VISA = { brand: 'VISA', last4: '4242', expMonth: 12, expYear: 2031, expired: false, savedAt: '2026-10-21T10:00:00.000Z', savedFrom: 'terminal' };

const viewOf = (over = {}) => ({
  state: 'ready',
  card: null,
  earlierCard: null,
  paidBy: null,
  inApp: false,
  canChange: true,
  isOwner: false,
  gymName: 'Iron House',
  agreement: cardAgreementWords('Iron House'),
  form: FORM,
  terminals: [DESK],
  pairTerminal: false,
  terminalSave: null,
  ...over,
});
const saveOf = (over = {}) => ({
  id: SAVE_ID,
  step: 'agree',
  outcome: null,
  pickedUp: false,
  entry: 'insert_or_swipe',
  terminal: DESK,
  startedAt: new Date().toISOString(),
  ...over,
});
const cardAnswer = (over) => Promise.resolve({ data: { cardOnFile: viewOf(over) } });
const saveAnswer = (save, view = {}) => Promise.resolve({ data: { save: saveOf(save), cardOnFile: viewOf(view) } });

function show(props = {}) {
  return render(
    <MemoryRouter>
      <MemberCard gymId={GYM} gym={IRON} entryId={TARA} name="Tara Singh" readOnly={false} checkEveryMs={5} {...props} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Save card on Terminal: the worst thing', () => {
  it("sends this page's own person and the Terminal pressed, and says saved only on the server's answer", async () => {
    orgService.getMemberCard.mockReturnValue(cardAnswer());
    orgService.startTerminalSave.mockReturnValue(saveAnswer({}));
    // Waiting for I agree, then for the card, then saved.
    orgService.checkTerminalSave
      .mockReturnValueOnce(saveAnswer({ pickedUp: true }))
      .mockReturnValueOnce(saveAnswer({ step: 'card', pickedUp: true }))
      .mockReturnValue(saveAnswer({ step: 'done', outcome: 'saved', pickedUp: true }, { card: VISA, terminalSave: null }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Save card on Terminal' }));
    await waitFor(() => expect(orgService.startTerminalSave).toHaveBeenCalledTimes(1));
    const [gymId, entryId, body] = orgService.startTerminalSave.mock.calls[0];
    expect([gymId, entryId, body.terminalId]).toEqual([GYM, TARA, DESK.id]);
    expect(body.requestKey).toMatch(/^[0-9a-f-]{36}$/);
    const box = await screen.findByTestId('terminal-wait');
    expect(within(box).getByText('Waiting for Tara on the Terminal')).toBeTruthy();
    expect(within(box).getByText('Tara reads the agreement and taps I agree.')).toBeTruthy();
    expect(within(box).getByText('Tara inserts or swipes their card, then follows the steps on the Terminal.')).toBeTruthy();
    expect(screen.queryByText(/Card saved/)).toBeNull();
    expect(await screen.findByText('Card saved: Visa ending 4242.')).toBeTruthy();
    expect(screen.queryByTestId('terminal-wait')).toBeNull();
    expect(orgService.checkTerminalSave.mock.calls.every((c) => c[0] === GYM && c[1] === TARA && c[2] === SAVE_ID)).toBe(true);
  });

  it("an answer about the last person's save is never drawn on another person's page", async () => {
    let finish;
    orgService.getMemberCard.mockImplementation((_g, entryId) => cardAnswer(entryId === TARA ? { terminalSave: saveOf() } : {}));
    orgService.checkTerminalSave.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = show();
    await screen.findByTestId('terminal-wait');
    await waitFor(() => expect(orgService.checkTerminalSave).toHaveBeenCalled());
    view.rerender(
      <MemoryRouter>
        <MemberCard gymId={GYM} gym={IRON} entryId={ZED} name="Zed Jones" readOnly={false} checkEveryMs={5} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: 'Save card on Terminal' })).toBeTruthy();
    finish({ data: { save: saveOf({ step: 'done', outcome: 'saved' }), cardOnFile: viewOf({ card: VISA }) } });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(/Card saved/)).toBeNull();
    expect(screen.queryByText(/4242/)).toBeNull();
  });
});

describe('Save card on Terminal: the box', () => {
  it('with two Terminals asks which one, and sends the one pressed', async () => {
    orgService.getMemberCard.mockReturnValue(cardAnswer({ terminals: [DESK, BACK] }));
    orgService.startTerminalSave.mockReturnValue(saveAnswer({ terminal: BACK }, { terminals: [DESK, BACK] }));
    orgService.checkTerminalSave.mockReturnValue(new Promise(() => undefined));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Save card on Terminal' }));
    const choice = await screen.findByTestId('terminal-choice');
    expect(within(choice).getByText('Choose a Terminal')).toBeTruthy();
    expect(within(choice).getByText('Serial R5WNWB5BKNG9R')).toBeTruthy();
    fireEvent.click(within(choice).getByText('Serial R5ZZQ1PQRS4TT'));
    await waitFor(() => expect(orgService.startTerminalSave.mock.calls[0]?.[2].terminalId).toBe(BACK.id));
    // With two, the waiting box names which.
    expect(within(await screen.findByTestId('terminal-wait')).getByText(/R5ZZQ1PQRS4TT/)).toBeTruthy();
  });

  it.each([
    ['not_agreed', "Not saved. Tara didn't agree."],
    ['cancelled_on_terminal', 'Not saved. It was cancelled on the Terminal.'],
    ['timed_out', 'Not saved. Time ran out on the Terminal.'],
    ['no_answer', "Not saved. The Terminal didn't respond. Check it's on and connected, then try again."],
    ['refused', "Not saved. Square couldn't save the card. Try again, or type the card instead."],
    ['gone', 'Not saved. Try again.'],
  ])('ended %s: says why, with Try again on the same Terminal and Type card instead', async (outcome, line) => {
    orgService.getMemberCard.mockReturnValue(cardAnswer());
    orgService.startTerminalSave.mockReturnValue(saveAnswer({}));
    orgService.checkTerminalSave.mockReturnValue(saveAnswer({ step: 'done', outcome }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Save card on Terminal' }));
    const ended = await screen.findByTestId('terminal-not-saved');
    expect(within(ended).getByText(line)).toBeTruthy();
    orgService.startTerminalSave.mockReturnValue(saveAnswer({ id: '99999999-9999-4999-8999-999999999999' }));
    orgService.checkTerminalSave.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(within(ended).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(orgService.startTerminalSave).toHaveBeenCalledTimes(2));
    expect(orgService.startTerminalSave.mock.calls[1]?.[2].terminalId).toBe(DESK.id);
    expect(orgService.startTerminalSave.mock.calls[1]?.[2].requestKey).not.toBe(orgService.startTerminalSave.mock.calls[0]?.[2].requestKey);
  });

  it('Not saved, then Type card instead: Square’s own card boxes open in the same place', async () => {
    orgService.getMemberCard.mockReturnValue(cardAnswer());
    orgService.startTerminalSave.mockReturnValue(saveAnswer({}));
    orgService.checkTerminalSave.mockReturnValue(saveAnswer({ step: 'done', outcome: 'not_agreed' }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Save card on Terminal' }));
    const ended = await screen.findByTestId('terminal-not-saved');
    fireEvent.click(within(ended).getByRole('button', { name: 'Type card instead' }));
    expect(await screen.findByTestId('card-form')).toBeTruthy();
    expect(screen.queryByTestId('terminal-not-saved')).toBeNull();
  });

  it('Type card instead opens Square’s own card boxes, as Add card does', async () => {
    orgService.getMemberCard.mockReturnValue(cardAnswer());
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Type card instead' }));
    expect(await screen.findByText('Add a card for Tara Singh')).toBeTruthy();
    await waitFor(() => expect(square.attachCardForm).toHaveBeenCalled());
  });

  it('Cancel asks the server to stop it, and says so where it was pressed', async () => {
    orgService.getMemberCard.mockReturnValue(cardAnswer());
    orgService.startTerminalSave.mockReturnValue(saveAnswer({}));
    orgService.checkTerminalSave.mockReturnValue(saveAnswer({ pickedUp: true }));
    orgService.cancelTerminalSave.mockReturnValue(saveAnswer({ step: 'done', outcome: 'cancelled' }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Save card on Terminal' }));
    fireEvent.click(within(await screen.findByTestId('terminal-wait')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(orgService.cancelTerminalSave).toHaveBeenCalledWith(GYM, TARA, SAVE_ID));
    expect(within(await screen.findByTestId('terminal-not-saved')).getByText('Cancelled. Nothing was saved.')).toBeTruthy();
  });

  it('a save already waiting is shown to whoever opens the page, and the steps say where it is', async () => {
    orgService.getMemberCard.mockReturnValue(cardAnswer({ terminalSave: saveOf({ step: 'card', pickedUp: true, entry: 'swipe' }) }));
    orgService.checkTerminalSave.mockReturnValue(new Promise(() => undefined));
    show();
    const box = await screen.findByTestId('terminal-wait');
    expect(within(box).getByText('Tara swipes their card, then follows the steps on the Terminal.')).toBeTruthy();
    const steps = box.querySelectorAll('li');
    expect([...steps].map((li) => li.getAttribute('data-state'))).toEqual(['done', 'now']);
    expect(screen.queryByRole('button', { name: 'Save card on Terminal' })).toBeNull();
    await waitFor(() => expect(orgService.checkTerminalSave).toHaveBeenCalledWith(GYM, TARA, SAVE_ID));
  });

  it("not on the Terminal's screen after a while: says what to check", async () => {
    const twenty = new Date(Date.now() - 25_000).toISOString();
    orgService.getMemberCard.mockReturnValue(cardAnswer({ terminalSave: saveOf({ startedAt: twenty }) }));
    orgService.checkTerminalSave.mockReturnValue(new Promise(() => undefined));
    show();
    expect(await screen.findByText("The Terminal hasn't shown it yet. Check it's on and connected to the internet.")).toBeTruthy();
  });

  it('a refused press says why under the button, and nothing is waiting', async () => {
    orgService.getMemberCard.mockReturnValue(cardAnswer());
    orgService.startTerminalSave.mockRejectedValue({ response: { status: 409, data: { error: 'terminal_busy', message: 'This Terminal is busy. Try again in a minute, or choose another Terminal.' } } });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Save card on Terminal' }));
    const ended = await screen.findByTestId('terminal-not-saved');
    expect(within(ended).getByText('This Terminal is busy. Try again in a minute, or choose another Terminal.')).toBeTruthy();
    expect(screen.queryByTestId('terminal-wait')).toBeNull();
    expect(orgService.checkTerminalSave).not.toHaveBeenCalled();
  });

  it('Pair a Terminal: for the owner with none paired, opening Payments; nobody else sees it', async () => {
    orgService.getMemberCard.mockReturnValue(cardAnswer({ terminals: [], pairTerminal: true, isOwner: true }));
    show({ gym: { ...IRON, privileges: [...IRON.privileges, 'org.manage'] } });
    const link = await screen.findByRole('link', { name: 'Pair a Terminal' });
    expect(link.getAttribute('href')).toMatch(/payments/);
    expect(screen.getByRole('button', { name: 'Add card' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save card on Terminal' })).toBeNull();
    cleanup();
    orgService.getMemberCard.mockReturnValue(cardAnswer({ terminals: [], pairTerminal: false }));
    show();
    await screen.findByRole('button', { name: 'Add card' });
    expect(screen.queryByRole('link', { name: 'Pair a Terminal' })).toBeNull();
  });

  it('a card already on file: Replace card on Terminal; a read-only console: no Terminal button', async () => {
    orgService.getMemberCard.mockReturnValue(cardAnswer({ card: { ...VISA, savedFrom: 'desk' } }));
    show();
    expect(await screen.findByRole('button', { name: 'Replace card on Terminal' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Type card instead' })).toBeTruthy();
    cleanup();
    orgService.getMemberCard.mockReturnValue(cardAnswer());
    show({ readOnly: true });
    await screen.findByText('No card on file');
    expect(screen.queryByRole('button', { name: 'Save card on Terminal' })).toBeNull();
  });
});
