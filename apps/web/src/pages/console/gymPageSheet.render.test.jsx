// The gym page's panel in the console, and what Leads shows of the form (ROADMAP 20c-iv-a).
//
// THE WORST THING THIS SCREEN COULD DO: switch a gym's page on, or change it, without the
// owner meaning to — or let staff who may not change it believe they have. So the first
// tests: nothing is saved until Save, Save sends exactly what is on screen, and a manager
// sees the page with nothing to change.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { leadSchema } from '@app/shared';

const api = {
  getGymPage: vi.fn(),
  setGymPage: vi.fn(),
  getLead: vi.fn(),
  getLeadEnquiries: vi.fn(),
  addGymPagePhoto: vi.fn(),
  removeGymPagePhoto: vi.fn(),
  orderGymPagePhotos: vi.fn(),
};
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: api };
});
// The browser's drawing is its own test (gymPagePhotos.test.js); here a picked file is ready at once.
vi.mock('./gymPagePhotos', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    preparePagePhoto: vi.fn((file) =>
      file.name.endsWith('.heic') ? Promise.reject(new Error('unreadable')) : Promise.resolve({ key: `new-${file.name}`, uploadKey: `key-${file.name}`, base64: `b64-${file.name}`, preview: `blob:${file.name}` }),
    ),
  };
});

const GymPageSheet = (await import('./GymPageSheet')).default;
const LeadSheet = (await import('./LeadSheet')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const WORDS = { it: 'gym', people: 'members', person: 'member', peopleCap: 'Members' };
const PAGE = { shown: false, about: '', facilities: [], ownFacilities: [], photos: [], slug: 'canal-street-gym', mayChange: true };

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(() => cleanup());

const drawSheet = (props = {}) =>
  render(<GymPageSheet gymId={GYM} gym={{ name: 'Canal Street Gym' }} words={WORDS} readOnly={false} onClose={() => undefined} {...props} />);
const tick = (name) => screen.getByRole('checkbox', { name });
const addOwn = (text) => {
  fireEvent.change(screen.getByLabelText('Add a facility'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
};

describe('the worst thing: a page switched on or changed by mistake', () => {
  it('nothing is saved until Save, and Save sends exactly what is on screen', async () => {
    api.getGymPage.mockResolvedValue({ data: { page: PAGE } });
    api.setGymPage.mockImplementation((_gym, body) => Promise.resolve({ data: { page: { ...PAGE, ...body } } }));
    drawSheet();
    await screen.findByRole('checkbox', { name: 'Show my page' });
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);

    fireEvent.click(tick('Show my page'));
    fireEvent.click(tick('Showers'));
    fireEvent.click(tick('Free weights'));
    fireEvent.change(screen.getByLabelText('About us'), { target: { value: '  Open late.  ' } });
    addOwn('Boxing ring');
    expect(api.setGymPage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved. Your page is on.');
    expect(api.setGymPage).toHaveBeenCalledTimes(1);
    expect(api.setGymPage).toHaveBeenCalledWith(GYM, {
      shown: true,
      about: 'Open late.',
      facilities: ['free_weights', 'showers'],
      ownFacilities: ['Boxing ring'],
    });
  });

  it('Cancel puts back what was saved, and closing with changes asks first', async () => {
    const onClose = vi.fn();
    api.getGymPage.mockResolvedValue({ data: { page: PAGE } });
    drawSheet({ onClose });
    await screen.findByRole('checkbox', { name: 'Show my page' });
    fireEvent.click(tick('Show my page'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(tick('Show my page').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.setGymPage).not.toHaveBeenCalled();
  });

  it('a manager sees the page and its link, and nothing to change', async () => {
    api.getGymPage.mockResolvedValue({ data: { page: { ...PAGE, shown: true, facilities: ['showers'], mayChange: false } } });
    drawSheet();
    await screen.findByText('Only the owner can change this page. You can copy its link.');
    expect(tick('Show my page').disabled).toBe(true);
    expect(tick('Showers').disabled).toBe(true);
    expect(screen.getByLabelText('About us').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByLabelText('Link to your page').value).toBe(`${window.location.origin}/gyms/canal-street-gym`);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  it('a gym whose plan has ended cannot change its page', async () => {
    api.getGymPage.mockResolvedValue({ data: { page: PAGE } });
    drawSheet({ readOnly: true });
    await screen.findByRole('checkbox', { name: 'Show my page' });
    expect(tick('Show my page').disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);
  });

  it('the code for a website shows the form alone, from this page', async () => {
    api.getGymPage.mockResolvedValue({ data: { page: PAGE } });
    drawSheet();
    const code = await screen.findByLabelText('Code for your website');
    expect(code.value).toContain(`src="${window.location.origin}/gyms/canal-street-gym?embed=1"`);
    expect(code.value).toContain('title="Get in touch with Canal Street Gym"');
  });
});

describe("the gym's own facilities", () => {
  it("are added to the same list, ticked; untick takes one off; the list's own words tick the list's facility", async () => {
    api.getGymPage.mockResolvedValue({ data: { page: PAGE } });
    drawSheet();
    await screen.findByRole('checkbox', { name: 'Show my page' });
    addOwn('  Rooftop   track ');
    expect(tick('Rooftop track').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Add a facility').value).toBe('');
    // "showers" is the list's Showers: ticked there, not added twice.
    addOwn('showers');
    expect(tick('Showers').getAttribute('aria-checked')).toBe('true');
    expect(screen.getAllByRole('checkbox', { name: /showers/i })).toHaveLength(1);
    // The same one again is not added twice.
    addOwn('rooftop track');
    expect(screen.getAllByRole('checkbox', { name: /rooftop track/i })).toHaveLength(1);
    fireEvent.click(tick('Rooftop track'));
    expect(screen.queryByRole('checkbox', { name: 'Rooftop track' })).toBeNull();
    expect(api.setGymPage).not.toHaveBeenCalled();
  });

  it('stops at ten, and says how to add another', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `Own ${i + 1}`);
    api.getGymPage.mockResolvedValue({ data: { page: { ...PAGE, ownFacilities: ten } } });
    drawSheet();
    await screen.findByRole('checkbox', { name: 'Own 10' });
    addOwn('Eleventh');
    expect(screen.getByRole('alert').textContent).toBe('You can add up to 10 of your own. Untick one to add another.');
    expect(screen.queryByRole('checkbox', { name: 'Eleventh' })).toBeNull();
  });

  it('a manager sees them, and no box to add one', async () => {
    api.getGymPage.mockResolvedValue({ data: { page: { ...PAGE, ownFacilities: ['Boxing ring'], mayChange: false } } });
    drawSheet();
    await screen.findByRole('checkbox', { name: 'Boxing ring' });
    expect(tick('Boxing ring').disabled).toBe(true);
    expect(screen.queryByLabelText('Add a facility')).toBeNull();
  });
});

describe('photos (20c-iv-b)', () => {
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const NEW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const withPhotos = (ids, over = {}) => ({ ...PAGE, photos: ids.map((id) => ({ id, width: 800, height: 600, uploadKey: `key-${id}` })), ...over });
  const pick = (...names) =>
    fireEvent.change(screen.getByLabelText('Choose photos'), { target: { files: names.map((name) => new File(['x'], name, { type: 'image/jpeg' })) } });

  it('nothing is sent until Save; then the removed one goes, the new one is added, and the new main photo is put first', async () => {
    api.getGymPage.mockResolvedValueOnce({ data: { page: withPhotos([A, B]) } });
    api.removeGymPagePhoto.mockResolvedValue({ data: { photos: [{ id: B, width: 800, height: 600 }] } });
    api.addGymPagePhoto.mockResolvedValue({ data: { photo: { id: NEW, width: 2000, height: 1500 } } });
    api.orderGymPagePhotos.mockResolvedValue({ data: { photos: [] } });
    drawSheet();
    await screen.findByRole('img', { name: 'Photo 1 of 2, the main photo' });
    expect(screen.getByRole('img', { name: 'Photo 1 of 2, the main photo' }).getAttribute('src')).toContain(`/v1/orgs/${GYM}/page/photos/${A}`);
    expect(screen.getByText('2 of 10 photos')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }));
    pick('front-desk.jpg');
    await screen.findByText('Not saved');
    fireEvent.click(screen.getByRole('button', { name: 'Make photo 2 the main photo' }));
    expect(screen.getByRole('img', { name: 'Photo 1 of 2, the main photo' }).getAttribute('src')).toBe('blob:front-desk.jpg');
    expect(api.removeGymPagePhoto).not.toHaveBeenCalled();
    expect(api.addGymPagePhoto).not.toHaveBeenCalled();

    api.getGymPage.mockResolvedValueOnce({ data: { page: withPhotos([NEW, B]) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved. Your page is off.');
    expect(api.setGymPage).not.toHaveBeenCalled();
    expect(api.removeGymPagePhoto).toHaveBeenCalledWith(GYM, A);
    expect(api.addGymPagePhoto).toHaveBeenCalledWith(GYM, 'b64-front-desk.jpg', 'key-front-desk.jpg');
    expect(api.orderGymPagePhotos).toHaveBeenCalledWith(GYM, [NEW, B]);
    // Removed before added, added before ordered.
    const order = (fn) => fn.mock.invocationCallOrder[0];
    expect(order(api.removeGymPagePhoto)).toBeLessThan(order(api.addGymPagePhoto));
    expect(order(api.addGymPagePhoto)).toBeLessThan(order(api.orderGymPagePhotos));
    expect(screen.queryByText('Not saved')).toBeNull();
  });

  it('a refused photo leaves what was saved on screen, and the photos not yet sent to try again', async () => {
    api.getGymPage.mockResolvedValueOnce({ data: { page: withPhotos([A]) } });
    api.addGymPagePhoto
      .mockResolvedValueOnce({ data: { photo: { id: NEW, width: 2000, height: 1500 } } })
      .mockRejectedValueOnce({ response: { status: 409, data: { error: 'photos_full', message: 'Your page has 10 photos, the most it can show. Remove one to add another.' } } });
    drawSheet();
    await screen.findByRole('img', { name: 'Photo 1 of 1, the main photo' });
    pick('one.jpg', 'two.jpg');
    await screen.findAllByText('Not saved');
    // The server keeps "one.jpg" under the key it was sent with.
    api.getGymPage.mockResolvedValueOnce({
      data: { page: { ...PAGE, photos: [...withPhotos([A]).photos, { id: NEW, width: 2000, height: 1500, uploadKey: 'key-one.jpg' }] } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Your page has 10 photos, the most it can show. Remove one to add another.');
    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(screen.getAllByText('Not saved')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Photo 3 of 3' }).getAttribute('src')).toBe('blob:two.jpg');
  });

  it('a photo kept whose reply was lost is shown once, as saved, and never sent again (review L3)', async () => {
    api.getGymPage.mockResolvedValueOnce({ data: { page: withPhotos([A]) } });
    // The server kept "one.jpg", and the phone's network lost its reply.
    api.addGymPagePhoto.mockRejectedValueOnce(new Error('Network Error'));
    drawSheet();
    await screen.findByRole('img', { name: 'Photo 1 of 1, the main photo' });
    pick('one.jpg', 'two.jpg');
    await screen.findAllByText('Not saved');
    const kept = { id: NEW, width: 2000, height: 1500, uploadKey: 'key-one.jpg' };
    api.getGymPage.mockResolvedValueOnce({ data: { page: { ...withPhotos([A]), photos: [...withPhotos([A]).photos, kept] } } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(3));
    expect(screen.getAllByText('Not saved')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Photo 2 of 3' }).getAttribute('src')).toContain(`/page/photos/${NEW}`);
    expect(screen.getByRole('img', { name: 'Photo 3 of 3' }).getAttribute('src')).toBe('blob:two.jpg');
    // Save again sends only the one not kept, under its own key.
    api.addGymPagePhoto.mockReset();
    api.addGymPagePhoto.mockResolvedValue({ data: { photo: { id: B, width: 2000, height: 1500, uploadKey: 'key-two.jpg' } } });
    api.getGymPage.mockResolvedValueOnce({ data: { page: { ...PAGE, photos: [...withPhotos([A]).photos, kept, { id: B, width: 2000, height: 1500, uploadKey: 'key-two.jpg' }] } } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved. Your page is off.');
    expect(api.addGymPagePhoto).toHaveBeenCalledTimes(1);
    expect(api.addGymPagePhoto).toHaveBeenCalledWith(GYM, 'b64-two.jpg', 'key-two.jpg');
  });

  it('while photos are being made ready, nothing else in the panel can be changed, Cancel included (review L7)', async () => {
    const { preparePagePhoto } = await import('./gymPagePhotos');
    let finish = () => undefined;
    preparePagePhoto.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ key: 'new-slow', uploadKey: 'key-slow', base64: 'b64-slow', preview: 'blob:slow' });
        }),
    );
    api.getGymPage.mockResolvedValue({ data: { page: PAGE } });
    drawSheet();
    await screen.findByText('No photos yet.');
    fireEvent.click(tick('Showers'));
    pick('slow.jpg');
    await screen.findByText('Getting photos ready…');
    expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(true);
    expect(tick('Show my page').disabled).toBe(true);
    finish();
    await screen.findByText('Not saved');
    expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(false);
    // What was ticked before the photo is still ticked: nothing was undone behind the wait.
    expect(tick('Showers').getAttribute('aria-checked')).toBe('true');
  });

  it("says which photos could not be opened, and adds the rest", async () => {
    api.getGymPage.mockResolvedValue({ data: { page: PAGE } });
    drawSheet();
    await screen.findByText('No photos yet.');
    pick('IMG_2041.heic', 'squat-rack.jpg');
    expect((await screen.findByRole('alert')).textContent).toBe("We couldn't open “IMG_2041.heic”. Choose a JPEG, PNG or WebP photo.");
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('every photo is shown whole, and a tap opens it full size, a new one before Save too (Kd, click-through)', async () => {
    api.getGymPage.mockResolvedValue({ data: { page: withPhotos([A, B]) } });
    drawSheet();
    await screen.findByRole('img', { name: 'Photo 1 of 2, the main photo' });
    pick('front-desk.jpg');
    await screen.findByText('Not saved');
    for (const img of screen.getAllByRole('img')) {
      expect(img.className).toContain('object-contain');
      expect(img.className).not.toContain('object-cover');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Open photo 3 full size' }));
    const viewer = screen.getByRole('dialog', { name: 'Photo 3 of 3' });
    expect(within(viewer).getByRole('img').getAttribute('src')).toBe('blob:front-desk.jpg');
    fireEvent.click(within(viewer).getByRole('button', { name: 'Next photo' }));
    expect(within(screen.getByRole('dialog', { name: 'Photo 1 of 3' })).getByRole('img').getAttribute('src')).toContain(`/page/photos/${A}`);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /Photo/ })).toBeNull();
    // The panel is still open, and nothing was sent.
    expect(screen.getByRole('dialog', { name: 'Your gym page' })).toBeTruthy();
    expect(api.addGymPagePhoto).not.toHaveBeenCalled();
  });

  it('ten photos: Add photos cannot be pressed', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`);
    api.getGymPage.mockResolvedValue({ data: { page: withPhotos(ten) } });
    drawSheet();
    await screen.findByText('10 of 10 photos');
    expect(screen.getByRole('button', { name: 'Add photos' }).disabled).toBe(true);
  });

  it('a manager sees the photos and nothing to change them with', async () => {
    api.getGymPage.mockResolvedValue({ data: { page: withPhotos([A, B], { mayChange: false }) } });
    drawSheet();
    await screen.findByRole('img', { name: 'Photo 1 of 2, the main photo' });
    expect(screen.queryByRole('button', { name: 'Add photos' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove photo/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /main photo/ })).toBeNull();
  });
});

describe("a lead's messages from the page", () => {
  const LEAD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const lead = (over = {}) =>
    leadSchema.parse({
      id: LEAD,
      fullName: 'Maria Park',
      email: 'maria.park@example.com',
      phone: null,
      source: 'social',
      status: 'new',
      notes: '',
      mayEmail: false,
      entryId: null,
      onList: false,
      createdAt: '2026-09-20T10:00:00.000Z',
      statusChangedAt: '2026-09-20T10:00:00.000Z',
      followUp: { sent: 0, dueOn: null, dueNow: false, overdue: false, lastSentAt: null },
      ...over,
    });
  const drawLead = () =>
    render(
      <MemoryRouter>
        <LeadSheet gymId={GYM} leadId={LEAD} orgSlug="gym" words={WORDS} readOnly={false} onClose={() => undefined} onChanged={() => undefined} />
      </MemoryRouter>,
    );

  it('lists what the person sent, as they typed it', async () => {
    api.getLead.mockResolvedValue({ data: { lead: lead({ enquiredAt: '2026-09-27T09:00:00.000Z' }) } });
    api.getLeadEnquiries.mockResolvedValue({
      data: {
        enquiries: [
          {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            fullName: 'M Park',
            email: 'someone.else@example.com',
            phone: '+447700900456',
            source: 'social',
            message: 'Still thinking',
            mayEmail: true,
            createdAt: '2026-09-27T09:00:00.000Z',
          },
        ],
      },
    });
    drawLead();
    const box = await screen.findByTestId('page-messages');
    await within(box).findByText('Still thinking');
    expect(api.getLeadEnquiries).toHaveBeenCalledWith(GYM, LEAD);
    expect(within(box).getByText('M Park · someone.else@example.com · +447700900456')).toBeTruthy();
    expect(within(box).getByText('Heard of you from: Social media')).toBeTruthy();
    expect(within(box).getByText('Happy to hear from you by email')).toBeTruthy();
  });

  it('a lead who never sent the form shows no messages and asks for none', async () => {
    api.getLead.mockResolvedValue({ data: { lead: lead() } });
    drawLead();
    await screen.findByRole('heading', { name: 'Maria Park' });
    await waitFor(() => expect(api.getLead).toHaveBeenCalled());
    expect(screen.queryByTestId('page-messages')).toBeNull();
    expect(api.getLeadEnquiries).not.toHaveBeenCalled();
  });
});
