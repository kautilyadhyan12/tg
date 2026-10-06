// THE GYM'S EVENTS IN THE CONSOLE, drawn (ROADMAP 19c-i; spec Part 3 §15.4). Only the
// network is mocked: what staff see is read off the real page.
//
// The worst thing the screen could do: cancel an event staff did not pick, or without the
// box that says what members will see — so the press is checked against the event it was
// made on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { closureDateLabel } from './hoursView';

const svc = { list: vi.fn(), add: vi.fn(), change: vi.fn(), setCancelled: vi.fn() };
const orgApi = { getMine: vi.fn() };
const prepare = vi.fn();
vi.mock('../../api/eventsApi', () => ({
  staffEventsService: svc,
  eventPosterUrl: ({ gymId, eventId, posterId }) => `http://api.test/v1/orgs/${gymId}/events/${eventId}/poster/${posterId}`,
}));
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: orgApi };
});
vi.mock('./gymPagePhotos', () => ({ preparePostPhoto: prepare }));

const Events = (await import('./Events')).default;
const { resetConsoleOrgs } = await import('./consoleOrgs');

const ORG = {
  id: 'g1',
  slug: 'iron-house',
  name: 'Iron House',
  staffRole: 'owner',
  privileges: ['members.read', 'posts.manage'],
  timezone: 'Europe/London',
  clockFormat: '24h',
  orgType: 'gym',
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z' },
};
const event = (id, name, over = {}) => ({
  id,
  name,
  details: '',
  place: '',
  startsOn: '2026-10-17',
  startMinute: 600,
  endsOn: '2026-10-17',
  endMinute: 780,
  startsAt: '2099-10-17T09:00:00.000Z',
  endsAt: '2099-10-17T12:00:00.000Z',
  places: null,
  cancelled: false,
  poster: null,
  ...over,
});
const listOf = (coming = [], over = {}) => ({ gymId: 'g1', gymName: 'Iron House', timezone: 'Europe/London', today: '2026-10-07', coming, past: [], pastTotal: 0, ...over });

const open = (org = ORG) => {
  orgApi.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });
  render(
    <MemoryRouter initialEntries={['/console/iron-house/events']}>
      <Routes>
        <Route path="/console/:orgSlug/events" element={<Events />} />
      </Routes>
    </MemoryRouter>,
  );
};
const cards = () => screen.queryAllByTestId('event');
const cardOf = (name) => cards().find((el) => within(el).queryByRole('heading', { name }) !== null);
const form = () => within(screen.getByTestId('event-form'));
const refusal = (status, message) => Object.assign(new Error(message), { response: { status, data: { error: 'x', message } } });

/** Pick a date the way a person does: open the calendar under the box named `label`, go
 *  forward a month at a time until the day is there, press it. */
const pickDate = (label, day) => {
  fireEvent.click(form().getByRole('button', { name: label }));
  const dayName = closureDateLabel(day);
  for (let n = 0; n < 24 && screen.queryByRole('button', { name: dayName }) === null; n += 1) {
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  }
  fireEvent.click(screen.getByRole('button', { name: dayName }));
};
const pickTime = (label, hour, minute) => {
  fireEvent.change(form().getByLabelText(`${label} hour`), { target: { value: String(hour) } });
  fireEvent.change(form().getByLabelText(`${label} minute`), { target: { value: String(minute) } });
};
const type = (label, text) => fireEvent.change(form().getByLabelText(label), { target: { value: text } });
const openAdd = async () => {
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Add event' }));
};
const fillOpenDay = () => {
  type('Event name', 'Saturday Open Day');
  pickDate('Starts on', '2026-10-17');
  pickTime('Start time', 10, 0);
  pickTime('End time', 13, 0);
};

beforeEach(() => {
  resetConsoleOrgs();
  for (const fn of [...Object.values(svc), prepare]) fn.mockReset();
  svc.list.mockResolvedValue(listOf());
  vi.stubGlobal('crypto', { randomUUID: () => 'key-1' });
  prepare.mockImplementation((file) =>
    file.name.endsWith('.pdf') ? Promise.reject(new Error('unreadable')) : Promise.resolve({ key: 'new-1', uploadKey: 'up-1', base64: 'POSTER64', preview: `blob:${file.name}` }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the page', () => {
  it('lists the coming events with when, where and how many places, and marks a cancelled one', async () => {
    svc.list.mockResolvedValue(
      listOf([
        event('a', 'Saturday Open Day', { place: 'Main hall', places: 40, details: 'Bring a friend.', poster: { id: 'p1', width: 800, height: 1000 } }),
        event('b', 'Winter Social', { startsOn: '2026-12-05', endsOn: '2026-12-06', startMinute: 1140, endMinute: 60, cancelled: true }),
      ]),
    );
    open();
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(svc.list).toHaveBeenCalledWith('g1');
    expect(screen.getByRole('heading', { name: 'Coming events (2)' })).toBeTruthy();
    const first = within(cardOf('Saturday Open Day'));
    expect(first.getByText('Sat 17 Oct · 10:00 am – 1:00 pm')).toBeTruthy();
    expect(first.getByText('Main hall')).toBeTruthy();
    expect(first.getByText('40 places')).toBeTruthy();
    expect(first.getByText('Bring a friend.')).toBeTruthy();
    expect(first.getByAltText('Poster for Saturday Open Day').getAttribute('src')).toBe('http://api.test/v1/orgs/g1/events/a/poster/p1');
    expect(first.queryByText('Cancelled')).toBeNull();
    const second = within(cardOf('Winter Social'));
    expect(second.getByText('Sat 5 Dec, 7:00 pm – Sun 6 Dec, 1:00 am')).toBeTruthy();
    expect(second.getByText('No limit on places')).toBeTruthy();
    expect(second.getByText('Cancelled')).toBeTruthy();
    expect(second.getByRole('button', { name: 'Un-cancel Winter Social' })).toBeTruthy();
    expect(second.queryByRole('button', { name: 'Cancel Winter Social' })).toBeNull();
  });

  it('says so when nothing is coming, and keeps past events behind a button, unchangeable', async () => {
    svc.list.mockResolvedValue(listOf([], { past: [event('old', 'Summer Fair', { startsAt: '2026-08-01T09:00:00.000Z', endsAt: '2026-08-01T12:00:00.000Z' })], pastTotal: 1 }));
    open();
    expect(await screen.findByText('No events coming up. Add your first one with Add event.')).toBeTruthy();
    expect(cards()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Past events (1)' }));
    expect(screen.getByText("Events that have ended. Your members no longer see them, and they can't be changed.")).toBeTruthy();
    const past = within(cardOf('Summer Fair'));
    expect(past.queryByRole('button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide past events' }));
    expect(cards()).toHaveLength(0);
  });

  it('a gym off its plan reads its events and changes nothing', async () => {
    svc.list.mockResolvedValue(listOf([event('a', 'Saturday Open Day')]));
    open({ ...ORG, consoleReadOnly: true });
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(screen.getByText(/needs a plan before anything here can be changed\. Your members can't see these events until then\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add event' })).toBeNull();
    expect(within(cards()[0]).queryByRole('button')).toBeNull();
  });

  it('staff without the tick read the server’s own refusal and no form', async () => {
    svc.list.mockRejectedValue(refusal(403, 'You do not have permission to do that.'));
    open();
    expect(await screen.findByText('You do not have permission to do that.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add event' })).toBeNull();
  });
});

describe('adding an event', () => {
  it('sends the form as filled in, under one key, and says members can see it', async () => {
    await openAdd();
    fillOpenDay();
    // The end day came with the start day.
    expect(form().getByRole('button', { name: 'Ends on' }).textContent).toContain(closureDateLabel('2026-10-17'));
    type('Place (optional)', 'Main hall');
    fireEvent.click(form().getByRole('checkbox', { name: 'No limit' }));
    type('Places', '40');
    type(/^Details/, 'Bring a friend.');
    svc.add.mockResolvedValue(event('a', 'Saturday Open Day'));
    svc.list.mockResolvedValue(listOf([event('a', 'Saturday Open Day')]));
    fireEvent.click(form().getByRole('button', { name: 'Add event' }));
    await waitFor(() => expect(svc.add).toHaveBeenCalledTimes(1));
    expect(svc.add).toHaveBeenCalledWith('g1', 'key-1', {
      name: 'Saturday Open Day',
      details: 'Bring a friend.',
      place: 'Main hall',
      startsOn: '2026-10-17',
      startMinute: 600,
      endsOn: '2026-10-17',
      endMinute: 780,
      places: 40,
    });
    expect(await screen.findByText('Event added. Your members can see it now.')).toBeTruthy();
    expect(screen.queryByTestId('event-form')).toBeNull();
    expect(cards()).toHaveLength(1);
  });

  it('says what is missing in a sentence and sends nothing', async () => {
    await openAdd();
    fireEvent.click(form().getByRole('button', { name: 'Add event' }));
    expect(form().getByRole('alert').textContent).toBe('Give the event a name.');
    type('Event name', 'Saturday Open Day');
    expect(form().queryByRole('alert')).toBeNull();
    fireEvent.click(form().getByRole('button', { name: 'Add event' }));
    expect(form().getByRole('alert').textContent).toBe('Pick the day it starts.');
    pickDate('Starts on', '2026-10-17');
    pickTime('Start time', 10, 0);
    pickTime('End time', 9, 0);
    fireEvent.click(form().getByRole('button', { name: 'Add event' }));
    expect(form().getByRole('alert').textContent).toBe('The end must be after the start.');
    expect(svc.add).not.toHaveBeenCalled();
  });

  it('a refused save keeps the form and its words, and the same key is sent again', async () => {
    await openAdd();
    fillOpenDay();
    svc.add.mockRejectedValueOnce(refusal(400, 'This date and time have already passed. Choose a later end.'));
    fireEvent.click(form().getByRole('button', { name: 'Add event' }));
    expect(await form().findByText('This date and time have already passed. Choose a later end.')).toBeTruthy();
    expect(form().getByLabelText('Event name').value).toBe('Saturday Open Day');
    svc.add.mockResolvedValue(event('a', 'Saturday Open Day'));
    fireEvent.click(form().getByRole('button', { name: 'Add event' }));
    await waitFor(() => expect(svc.add).toHaveBeenCalledTimes(2));
    expect(svc.add.mock.calls.map((c) => c[1])).toEqual(['key-1', 'key-1']);
  });

  it('a poster is shown before it is sent; a file that is no picture is said and not sent', async () => {
    await openAdd();
    fillOpenDay();
    const picker = form().getByLabelText('Choose a poster');
    fireEvent.change(picker, { target: { files: [new File(['x'], 'flyer.pdf')] } });
    expect(await form().findByText("This file isn't a picture we can read. Choose a JPEG, PNG or WebP.")).toBeTruthy();
    expect(form().queryByAltText("The event's poster")).toBeNull();
    fireEvent.change(picker, { target: { files: [new File(['x'], 'poster.jpg')] } });
    await waitFor(() => expect(form().getByAltText("The event's poster").getAttribute('src')).toBe('blob:poster.jpg'));
    expect(form().queryByRole('alert')).toBeNull();
    expect(form().getByRole('button', { name: 'Change poster' })).toBeTruthy();
    svc.add.mockResolvedValue(event('a', 'Saturday Open Day'));
    fireEvent.click(form().getByRole('button', { name: 'Add event' }));
    await waitFor(() => expect(svc.add).toHaveBeenCalledTimes(1));
    expect(svc.add.mock.calls[0][2].poster).toBe('POSTER64');
  });

  it('Close sends nothing', async () => {
    await openAdd();
    fillOpenDay();
    fireEvent.click(form().getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('event-form')).toBeNull();
    expect(svc.add).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add event' })).toBeTruthy();
  });
});

describe('changing an event', () => {
  const two = () => [event('a', 'Saturday Open Day', { places: 40, poster: { id: 'p1', width: 800, height: 1000 } }), event('b', 'Winter Social', { startsOn: '2026-12-05', endsOn: '2026-12-05' })];

  it('Edit opens that event filled in, and an untouched poster is left alone', async () => {
    svc.list.mockResolvedValue(listOf(two()));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Saturday Open Day' }));
    expect(form().getByRole('heading', { name: 'Edit Saturday Open Day' })).toBeTruthy();
    expect(form().getByLabelText('Event name').value).toBe('Saturday Open Day');
    expect(form().getByLabelText('Places').value).toBe('40');
    expect(form().getByLabelText('Start time hour').value).toBe('10');
    expect(form().getByAltText("The event's poster").getAttribute('src')).toBe('http://api.test/v1/orgs/g1/events/a/poster/p1');
    // The other event stays a card, and no second Add form can be opened over this one.
    expect(cardOf('Winter Social')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add event' })).toBeNull();
    type('Event name', 'Sunday Open Day');
    svc.change.mockResolvedValue(event('a', 'Sunday Open Day'));
    fireEvent.click(form().getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(svc.change).toHaveBeenCalledTimes(1));
    const [gymId, eventId, fields] = svc.change.mock.calls[0];
    expect([gymId, eventId]).toEqual(['g1', 'a']);
    expect(fields).toMatchObject({ name: 'Sunday Open Day', startMinute: 600, endMinute: 780, places: 40 });
    expect('poster' in fields).toBe(false);
    expect(await screen.findByText('Changes saved. Your members see them now.')).toBeTruthy();
  });

  it('Remove poster takes it off on Save, not before', async () => {
    svc.list.mockResolvedValue(listOf(two()));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Saturday Open Day' }));
    fireEvent.click(form().getByRole('button', { name: 'Remove poster' }));
    expect(form().queryByAltText("The event's poster")).toBeNull();
    expect(svc.change).not.toHaveBeenCalled();
    svc.change.mockResolvedValue(event('a', 'Saturday Open Day'));
    fireEvent.click(form().getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(svc.change).toHaveBeenCalledTimes(1));
    expect(svc.change.mock.calls[0][2].poster).toBeNull();
  });

  it('Cancel event asks first, names what members will see, and cancels the event it was pressed on', async () => {
    svc.list.mockResolvedValue(listOf(two()));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel Winter Social' }));
    const box = within(screen.getByRole('group', { name: 'Cancel Winter Social?' }));
    expect(box.getByText('Your members still see it on their Events list, marked Cancelled, until Sat 5 Dec.')).toBeTruthy();
    expect(box.getByText('Nobody is emailed. You can un-cancel it until then.')).toBeTruthy();
    expect(svc.setCancelled).not.toHaveBeenCalled();
    // Keep it: nothing is sent and the buttons come back.
    fireEvent.click(box.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('group', { name: 'Cancel Winter Social?' })).toBeNull();
    expect(svc.setCancelled).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Winter Social' }));
    svc.setCancelled.mockResolvedValue(event('b', 'Winter Social', { cancelled: true }));
    svc.list.mockResolvedValue(listOf([two()[0], event('b', 'Winter Social', { cancelled: true })]));
    fireEvent.click(within(screen.getByRole('group', { name: 'Cancel Winter Social?' })).getByRole('button', { name: 'Cancel event' }));
    await waitFor(() => expect(svc.setCancelled).toHaveBeenCalledTimes(1));
    expect(svc.setCancelled).toHaveBeenCalledWith('g1', 'b', true);
    expect(await screen.findByText('Event cancelled. Your members see it marked Cancelled.')).toBeTruthy();
    expect(within(cardOf('Winter Social')).getByText('Cancelled')).toBeTruthy();
    expect(within(cardOf('Saturday Open Day')).queryByText('Cancelled')).toBeNull();

    // Un-cancel needs no box: it takes nothing away.
    svc.setCancelled.mockResolvedValue(event('b', 'Winter Social'));
    fireEvent.click(screen.getByRole('button', { name: 'Un-cancel Winter Social' }));
    await waitFor(() => expect(svc.setCancelled).toHaveBeenCalledTimes(2));
    expect(svc.setCancelled.mock.calls[1]).toEqual(['g1', 'b', false]);
  });

  it('an event that ended meanwhile is said, and the list is read again', async () => {
    svc.list.mockResolvedValue(listOf(two()));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel Winter Social' }));
    svc.setCancelled.mockRejectedValue(refusal(409, "This event has ended, so it can't be changed."));
    svc.list.mockResolvedValue(listOf([two()[0]]));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel event' }));
    expect(await screen.findByText("This event has ended, so it can't be changed.")).toBeTruthy();
    await waitFor(() => expect(cards()).toHaveLength(1));
  });
});
