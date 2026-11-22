// A member's page as a page of its own (V2a, spec Part 3 §17.11): the strip under the name reads
// the answer the Memberships box drew, never anybody else's, and its button opens that box's own
// form; inside the console it takes the page's place, with the way back named after the page it
// was opened from, and the browser's Back closes it.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { giveHeldMembership, heldMembershipView, heldMembershipsResponseSchema, memberListEntryDetailSchema, memberListViewSchema } from '@app/shared';
import { billingFor } from './billingFixture';
import { PageOverContext, usePageOverShell } from '../../components/console/pageOver';

/** What the Memberships box was last given, and the answer it hands the page. */
const drawn = { props: null, answer: null };
vi.mock('./MemberMemberships', () => ({
  default: (props) => {
    drawn.props = props;
    const { onHeld, entryId } = props;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      onHeld?.(drawn.answer === null ? null : { entryId, ...drawn.answer });
    }, [onHeld, entryId]);
    return <section data-testid="held-memberships">Memberships</section>;
  },
}));
vi.mock('./MemberNotes', () => ({ default: () => <section data-testid="member-notes">Notes</section> }));
vi.mock('./MemberPayer', () => ({ default: () => <section data-testid="who-pays">Payer</section> }));
vi.mock('./MemberCard', () => ({ default: () => <section data-testid="card-on-file">Card on file</section> }));
vi.mock('./MemberPurchases', () => ({ default: () => <section data-testid="purchases">Purchases</section> }));

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMemberListEntry: vi.fn(),
      inviteMemberListEntry: vi.fn(),
      getDeskWaiver: vi.fn(() => new Promise(() => undefined)),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MemberListPerson = (await import('./MemberListPerson')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TODAY = '2026-10-20';
const WORDS = { people: 'members', person: 'member', peopleCap: 'Members', personCap: 'Member', it: 'gym' };
const LIST = memberListViewSchema.parse({
  hasList: true,
  version: 3,
  lastConfirmedAt: '2026-09-20T10:00:00.000Z',
  counts: { entries: 2, inApp: 0, canBeInvited: 2, noEmail: 0, former: 0 },
  statuses: [],
  membershipTypes: [],
  paymentStatuses: [],
  fields: [],
  appWords: [],
});
const GOLD = { id: '22222222-2222-4222-8222-000000000001', name: 'Gold Monthly', kind: 'recurring', priceMinor: 4999, currency: 'GBP', termCount: 1, termUnit: 'month', packClasses: null, packDays: null, taxes: [] };
// The owner, who records payments and gives memberships.
const GYM_ROW = { id: GYM, slug: 'iron-house', name: 'Iron House', timezone: 'Europe/London', staffRole: 'owner', privileges: null };

function person(entryId, fullName, over = {}) {
  return memberListEntryDetailSchema.parse({
    entryId,
    fullName,
    email: `${fullName.split(' ')[0].toLowerCase()}@members.example`,
    phone: null,
    memberNumber: null,
    status: 'Active',
    membershipType: null,
    joinedOn: null,
    endsOn: null,
    endsOnKind: null,
    paymentStatus: null,
    dateOfBirth: null,
    formerAt: null,
    source: 'upload',
    inApp: true,
    invitation: null,
    app: { word: 'in_app', tone: 'green', at: null, line: null, lineTone: 'plain' },
    extra: [],
    handEdited: [],
    members: [],
    ...over,
  });
}

function held(n, startsOn, paid) {
  const made = giveHeldMembership(GOLD, startsOn, paid, startsOn);
  if (!made.ok) throw new Error(made.reason);
  const m = made.membership;
  return {
    id: `44444444-4444-4444-8444-00000000000${String(n)}`,
    typeId: GOLD.id,
    typeName: GOLD.name,
    kind: GOLD.kind,
    priceMinor: GOLD.priceMinor,
    currency: GOLD.currency,
    termCount: GOLD.termCount,
    termUnit: GOLD.termUnit,
    packClasses: null,
    packDays: null,
    startsOn,
    frozenOn: m.frozenOn,
    classesLeft: m.classesLeft,
    fromList: false,
    notCharged: false,
    refundedInFull: false,
    discount: null,
    taxes: [],
    view: heldMembershipView(m, TODAY),
    billing: billingFor(n, made.membership, m, GOLD.priceMinor, TODAY),
  };
}
const answer = (memberships) =>
  heldMembershipsResponseSchema.parse({ today: TODAY, past: false, memberships, earlierNotShown: 0, types: [GOLD], listed: null, canBill: true, discounts: [], taxIncluded: false });

const draw = (entryId = ADA, over = null) => {
  const page = (
    <MemberListPerson gymId={GYM} gym={GYM_ROW} entryId={entryId} list={LIST} words={WORDS} readOnly={false} canRemove onClose={onClose} onChanged={() => undefined} />
  );
  return render(<MemoryRouter>{over === null ? page : <PageOverContext.Provider value={over}>{page}</PageOverContext.Provider>}</MemoryRouter>);
};
const strip = () => screen.findByTestId('next-step');
let onClose;

beforeEach(() => {
  vi.clearAllMocks();
  onClose = vi.fn();
  drawn.props = null;
  drawn.answer = null;
  orgService.getMemberListEntry.mockImplementation((_g, id) => Promise.resolve({ data: { entry: id === ADA ? person(ADA, 'Ada Lovelace') : person(BEN, 'Ben Okafor') } }));
});
afterEach(cleanup);

describe('the strip under the name', () => {
  it('says what is due from the answer Memberships drew, and its Record payment opens that bill in Memberships', async () => {
    drawn.answer = answer([held(1, '2026-10-04', false)]);
    draw();
    const s = within(await strip());
    expect(s.getByText(/^£49\.99 (due|overdue)$/)).toBeTruthy();
    expect(s.getByText(/Gold Monthly/)).toBeTruthy();
    fireEvent.click(s.getByRole('button', { name: 'Record payment' }));
    expect(drawn.props.stripAsk).toEqual({ what: 'pay', membershipId: '44444444-4444-4444-8444-000000000001', feeBillId: null, n: 1 });
    // A second press is a new press: the box opens again if it was closed meanwhile.
    fireEvent.click(s.getByRole('button', { name: 'Record payment' }));
    expect(drawn.props.stripAsk.n).toBe(2);
  });

  it("the page's one orange button is the strip's; Edit and More beside the name are plain", async () => {
    drawn.answer = answer([held(1, '2026-10-04', false)]);
    draw();
    await strip();
    const orange = screen.getAllByRole('button').filter((b) => b.classList.contains('c-btn-p'));
    expect(orange.map((b) => b.textContent)).toEqual(['Record payment']);
    expect(within(screen.getByTestId('next-step')).getByRole('button', { name: 'Record payment' })).toBe(orange[0]);
  });

  it('draws nothing until Memberships has an answer, never "Nothing due" before it knows', async () => {
    draw();
    await screen.findByRole('heading', { name: 'Ada Lovelace', level: 1 });
    expect(screen.queryByTestId('next-step')).toBeNull();
  });

  it("draws nothing from an answer about somebody else", async () => {
    draw();
    await screen.findByRole('heading', { name: 'Ada Lovelace', level: 1 });
    act(() => drawn.props.onHeld({ entryId: BEN, ...answer([held(1, '2026-10-04', false)]) }));
    expect(screen.queryByTestId('next-step')).toBeNull();
  });

  it('paid up and in the app: Nothing due, with no button', async () => {
    drawn.answer = answer([held(1, '2026-10-04', true)]);
    draw();
    const s = await strip();
    expect(s.textContent).toBe('Nothing due');
    expect(within(s).queryByRole('button')).toBeNull();
  });

  it('no membership: Add membership opens the Add form in Memberships', async () => {
    drawn.answer = answer([]);
    draw();
    fireEvent.click(within(await strip()).getByRole('button', { name: 'Add membership' }));
    expect(drawn.props.stripAsk).toEqual({ what: 'add', n: 1 });
  });

  it('not in the app: Invite to app asks first, as the button beside the name does', async () => {
    orgService.getMemberListEntry.mockResolvedValue({ data: { entry: person(ADA, 'Ada Lovelace', { inApp: false, app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Not invited yet', lineTone: 'plain' } }) } });
    drawn.answer = answer([held(1, '2026-10-04', true)]);
    draw();
    const s = within(await strip());
    expect(s.getByText('Not in the app')).toBeTruthy();
    fireEvent.click(s.getByRole('button', { name: 'Invite to app' }));
    expect(await screen.findByTestId('confirm-invite')).toBeTruthy();
    expect(orgService.inviteMemberListEntry).not.toHaveBeenCalled();
  });
});

describe('the page', () => {
  it('three columns, each holding its own boxes: who they are, what they have, who pays', async () => {
    drawn.answer = answer([held(1, '2026-10-04', true)]);
    draw();
    await strip();
    expect(within(screen.getByTestId('person-who')).getByRole('heading', { name: 'Contact details' })).toBeTruthy();
    expect(within(screen.getByTestId('person-who')).getByTestId('member-notes')).toBeTruthy();
    expect(within(screen.getByTestId('person-have')).getByTestId('held-memberships')).toBeTruthy();
    expect(within(screen.getByTestId('person-have')).getByTestId('purchases')).toBeTruthy();
    expect(within(screen.getByTestId('person-pays')).getByTestId('who-pays')).toBeTruthy();
    expect(within(screen.getByTestId('person-pays')).getByTestId('card-on-file')).toBeTruthy();
  });

});

describe('in the console', () => {
  /** The shell's own part (`usePageOverShell`, as `ConsoleLayout` uses it), with the page under it. */
  function Shell({ entryId = ADA, close = onClose, lockFirst = false, opener = false }) {
    const { setSlot, hidden, pageOver } = usePageOverShell('Members & staff');
    const [showing, setShowing] = useState(!opener);
    // A box under the page that locked the window's scrolling, as Invite to app does.
    useEffect(() => {
      if (!lockFirst) return undefined;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }, [lockFirst]);
    return (
      <PageOverContext.Provider value={pageOver}>
        <div ref={setSlot} data-testid="slot" />
        <div data-testid="under" style={{ display: hidden ? 'none' : 'contents' }}>
          {opener ? (
            <button type="button" onClick={() => setShowing(true)}>
              Open Ada
            </button>
          ) : null}
          {showing && pageOver.slot !== null ? (
            <MemberListPerson key={entryId} gymId={GYM} gym={GYM_ROW} entryId={entryId} list={LIST} words={WORDS} readOnly={false} canRemove onClose={() => { close(); setShowing(false); }} onChanged={() => undefined} />
          ) : null}
        </div>
      </PageOverContext.Provider>
    );
  }
  const drawShell = (props = {}) => render(<MemoryRouter><Shell {...props} /></MemoryRouter>);
  const settle = () => act(() => new Promise((r) => setTimeout(r, 5)));

  beforeEach(() => {
    window.history.replaceState({ idx: 0 }, '');
    document.body.style.overflow = '';
  });

  it("drawn in the page's place, the page under it hidden, the way back named after that page", async () => {
    drawShell();
    const page = await screen.findByTestId('member-person');
    expect(within(screen.getByTestId('slot')).getByTestId('member-person')).toBe(page);
    expect(screen.getByTestId('under').style.display).toBe('none');
    expect(page.getAttribute('role')).toBe('region');
    expect(page.getAttribute('aria-modal')).toBeNull();
    expect(within(page).queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.click(within(page).getByRole('button', { name: 'Members & staff' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('under').style.display).toBe('contents');
  });

  it("the browser's Back closes it", async () => {
    drawShell();
    await screen.findByTestId('member-person');
    expect(typeof window.history.state?.personPage).toBe('string');
    act(() => {
      window.history.replaceState({ idx: 0 }, '');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closed by its way back, its step of the history is taken back', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    drawShell();
    const page = await screen.findByTestId('member-person');
    fireEvent.click(within(page).getByRole('button', { name: 'Members & staff' }));
    await settle();
    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
  });

  it("another person's page opened straight after takes over the same step, never a second one", async () => {
    const push = vi.spyOn(window.history, 'pushState');
    const view = drawShell();
    await screen.findByRole('heading', { name: 'Ada Lovelace', level: 1 });
    view.rerender(<MemoryRouter><Shell entryId={BEN} /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Ben Okafor', level: 1 });
    await settle();
    expect(push.mock.calls.filter(([state]) => typeof state?.personPage === 'string')).toHaveLength(1);
    expect(typeof window.history.state?.personPage).toBe('string');
    push.mockRestore();
  });

  it('the window scrolls while it is open, though a box under it locked scrolling; the lock is back once it closes', async () => {
    drawShell({ lockFirst: true });
    const page = await screen.findByTestId('member-person');
    expect(document.body.style.overflow).toBe('');
    fireEvent.click(within(page).getByRole('button', { name: 'Members & staff' }));
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('a step left by a page that closed by a link is gone past, the way the person was going', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => undefined);
    window.history.replaceState({ idx: 1 }, '');
    drawShell({ opener: true });
    await screen.findByRole('button', { name: 'Open Ada' });
    // Back from the new page (1) onto the old step (0): on to the page under it.
    act(() => {
      window.history.replaceState({ idx: 0, personPage: 'person:old' }, '');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(back).toHaveBeenCalledTimes(1);
    // Forward from the page under it (0) onto the old step (0): on to the new page.
    act(() => {
      window.history.replaceState({ idx: 0 }, '');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    act(() => {
      window.history.replaceState({ idx: 0, personPage: 'person:old' }, '');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(forward).toHaveBeenCalledTimes(1);
    back.mockRestore();
    forward.mockRestore();
  });

  it('closed, the focus is back on what opened it', async () => {
    drawShell({ opener: true });
    const open = await screen.findByRole('button', { name: 'Open Ada' });
    open.focus();
    fireEvent.click(open);
    const page = await screen.findByTestId('member-person');
    fireEvent.click(within(page).getByRole('button', { name: 'Members & staff' }));
    await settle();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open Ada' }));
  });
});
