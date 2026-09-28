// A gym's own page and its form (ROADMAP 20c-iv-a).
//
// THE WORST THING THIS SCREEN COULD DO: send a person's message to the wrong gym, or
// tell them something about who a gym already has. So the first test: the form goes to
// the page's own address and nowhere else, and a sent form says only thanks.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = { getPublicGymPage: vi.fn(), sendGymEnquiry: vi.fn() };
vi.mock('../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: api };
});

const GymPublicPage = (await import('./GymPublicPage')).default;

const PAGE = {
  name: 'Canal Street Gym',
  city: 'Leeds',
  orgType: 'gym',
  about: 'Friendly gym by the canal.',
  facilities: ['free_weights', 'showers'],
  ownFacilities: ['Boxing ring'],
  photos: [],
  hours: { mode: 'open_24h', timezone: 'Europe/London', clockFormat: '24h', week: [], savedWeek: [], closures: [] },
  robotCheckKey: 'site-key',
};

/** Cloudflare's box, as the page sees it: `pass()` hands the page a token. */
let rendered = null;
const turnstile = {
  render: vi.fn((_el, options) => {
    rendered = options;
    return 'widget-1';
  }),
  reset: vi.fn(),
  remove: vi.fn(),
};
const pass = (token = 'tok-1') => act(() => rendered.callback(token));

beforeEach(() => {
  rendered = null;
  window.turnstile = turnstile;
  for (const fn of [...Object.values(api), ...Object.values(turnstile)]) fn.mockClear();
  api.getPublicGymPage.mockResolvedValue({ data: { page: PAGE } });
  api.sendGymEnquiry.mockResolvedValue({ data: { received: true } });
});
afterEach(() => {
  cleanup();
  delete window.turnstile;
});

const draw = (path = '/gyms/canal-street-gym') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/gyms/:slug" element={<GymPublicPage />} />
      </Routes>
    </MemoryRouter>,
  );

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('the worst thing: the wrong gym, or telling who a gym has', () => {
  it('sends the form to the page it was filled on, and then says only thanks', async () => {
    draw();
    await screen.findByRole('heading', { name: 'Canal Street Gym' });
    expect(api.getPublicGymPage).toHaveBeenCalledWith('canal-street-gym');
    type('Name', 'Asha Rao');
    type('Email', 'asha@example.com');
    type('Message (optional)', 'Evening classes?');
    await waitFor(() => expect(rendered).not.toBeNull());
    pass('tok-1');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Thanks, Asha.');
    expect(api.sendGymEnquiry).toHaveBeenCalledTimes(1);
    expect(api.sendGymEnquiry).toHaveBeenCalledWith('canal-street-gym', {
      fullName: 'Asha Rao',
      email: 'asha@example.com',
      message: 'Evening classes?',
      robotToken: 'tok-1',
    });
    expect(screen.getByText('Canal Street Gym will be in touch.')).toBeTruthy();
  });
});

describe('the page', () => {
  it('shows the gym, its facilities and hours, and never asks anyone to sign in', async () => {
    draw();
    await screen.findByRole('heading', { name: 'Canal Street Gym' });
    expect(screen.getByText('Leeds')).toBeTruthy();
    expect(screen.getByText('Open 24 hours')).toBeTruthy();
    expect(screen.getByText('Friendly gym by the canal.')).toBeTruthy();
    for (const line of ['Free weights', 'Showers', 'Boxing ring']) expect(screen.getByText(line)).toBeTruthy();
    expect(screen.queryByText(/sign in/i)).toBeNull();
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled());
    expect(turnstile.render.mock.calls[0][1]).toMatchObject({ sitekey: 'site-key' });
  });

  it('a page that is off or gone says so, and shows no form', async () => {
    api.getPublicGymPage.mockRejectedValue(Object.assign(new Error('404'), { response: { status: 404, data: { message: "This page isn't available." } } }));
    draw('/gyms/quiet-gym');
    await screen.findByText("This page isn't available.");
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it("inside a gym's own website it is the form alone", async () => {
    draw('/gyms/canal-street-gym?embed=1');
    await screen.findByRole('heading', { name: 'Get in touch with Canal Street Gym' });
    expect(screen.queryByText('Friendly gym by the canal.')).toBeNull();
    expect(screen.queryByText('Boxing ring')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });
});

describe('the form', () => {
  it('asks for what is missing before anything is sent', async () => {
    draw();
    await screen.findByRole('heading', { name: 'Canal Street Gym' });
    await waitFor(() => expect(rendered).not.toBeNull());
    pass();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Add your name.');
    type('Name', 'Asha Rao');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Add your email address or phone number, so they can reach you.');
    expect(api.sendGymEnquiry).not.toHaveBeenCalled();
  });

  it('waits for the robot check, and after a refused send asks Cloudflare for a new one', async () => {
    api.sendGymEnquiry.mockRejectedValueOnce(
      Object.assign(new Error('400'), { response: { status: 400, data: { message: 'Check your email address.' } } }),
    );
    draw();
    await screen.findByRole('heading', { name: 'Canal Street Gym' });
    await waitFor(() => expect(rendered).not.toBeNull());
    type('Name', 'Asha Rao');
    type('Email', 'asha@example');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Tick the box to show you’re not a robot.');
    expect(api.sendGymEnquiry).not.toHaveBeenCalled();
    pass('tok-1');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Check your email address.'));
    expect(turnstile.reset).toHaveBeenCalledWith('widget-1');
    // The spent token is not sent again.
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Tick the box to show you’re not a robot.'));
    expect(api.sendGymEnquiry).toHaveBeenCalledTimes(1);
  });

  it('the hidden field is out of sight, out of the tab order, and named nothing autofill knows', async () => {
    const { container } = draw();
    await screen.findByRole('heading', { name: 'Canal Street Gym' });
    const trap = container.querySelector('input[name="enq_hp"]');
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelector('label[for="enq-hp"]').textContent).toBe('Leave this field empty');
    expect(container.querySelector('input[name="fax"]')).toBeNull();
  });

  it('when the robot check cannot load, says what to do instead of "try again"', async () => {
    delete window.turnstile;
    const append = vi.spyOn(document.head, 'appendChild').mockImplementation((el) => {
      // A blocker stops Cloudflare's script: it never loads.
      setTimeout(() => el.onerror?.(), 0);
      return el;
    });
    draw();
    await screen.findByRole('heading', { name: 'Canal Street Gym' });
    type('Name', 'Asha Rao');
    type('Email', 'asha@example.com');
    await waitFor(() => expect(append).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      "The robot check didn't load. Turn off any ad blocker for this page and reload it, or contact Canal Street Gym directly.",
    );
    expect(api.sendGymEnquiry).not.toHaveBeenCalled();
    append.mockRestore();
  });

  it('a busy page says so in its own words; a busy address says "from here"', async () => {
    const refused = (error, message) => Object.assign(new Error('429'), { response: { status: 429, data: { error, message } } });
    api.sendGymEnquiry
      .mockRejectedValueOnce(refused('page_busy', 'This page is getting a lot of messages. Please try again in an hour, or contact them directly.'))
      .mockRejectedValueOnce(refused('rate_limited', 'Too many requests'));
    draw();
    await screen.findByRole('heading', { name: 'Canal Street Gym' });
    await waitFor(() => expect(rendered).not.toBeNull());
    type('Name', 'Asha Rao');
    type('Email', 'asha@example.com');
    pass('tok-1');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('This page is getting a lot of messages. Please try again in an hour, or contact them directly.'),
    );
    pass('tok-2');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Too many messages have been sent from here. Please try again later.'));
  });
});

describe('photos (20c-iv-b)', () => {
  const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
  const withPhotos = (list) => ({ ...PAGE, photos: list.map((id) => ({ id, width: 2000, height: 1500 })) });

  it("the main photo is the large one, each from this page's own address, and a tap opens it full size", async () => {
    api.getPublicGymPage.mockResolvedValue({ data: { page: withPhotos(ids) } });
    draw();
    const main = await screen.findByRole('img', { name: 'Canal Street Gym, photo 1 of 3' });
    expect(main.getAttribute('src')).toMatch(new RegExp(`/v1/public/gyms/canal-street-gym/photos/${ids[0]}$`));
    expect(screen.getByRole('img', { name: 'Canal Street Gym, photo 3 of 3' }).getAttribute('src')).toMatch(new RegExp(`/photos/${ids[2]}$`));

    fireEvent.click(screen.getByRole('img', { name: 'Canal Street Gym, photo 2 of 3' }).closest('button'));
    const viewer = screen.getByRole('dialog', { name: 'Canal Street Gym, photo 2 of 3' });
    expect(viewer.textContent).toContain('2 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }));
    expect(screen.getByRole('dialog', { name: 'Canal Street Gym, photo 3 of 3' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog', { name: 'Canal Street Gym, photo 1 of 3' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('one photo has no Previous or Next; no photos, no photo section', async () => {
    api.getPublicGymPage.mockResolvedValue({ data: { page: withPhotos(ids.slice(0, 1)) } });
    draw();
    fireEvent.click((await screen.findByRole('img', { name: 'Canal Street Gym, photo 1 of 1' })).closest('button'));
    expect(screen.queryByRole('button', { name: 'Next photo' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    cleanup();
    api.getPublicGymPage.mockResolvedValue({ data: { page: withPhotos([]) } });
    draw();
    await screen.findByRole('heading', { name: 'Canal Street Gym' });
    expect(screen.queryByRole('region', { name: 'Photos' })).toBeNull();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it("inside a gym's own website the form stays alone, with no photos", async () => {
    api.getPublicGymPage.mockResolvedValue({ data: { page: withPhotos(ids) } });
    draw('/gyms/canal-street-gym?embed=1');
    await screen.findByRole('heading', { name: 'Get in touch with Canal Street Gym' });
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});
