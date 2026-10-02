// Settings → Check-in devices, as the owner sees it (spec Part 3 §12.3; ROADMAP 16b-i).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CHECKIN_DEVICES_MAX, CHECKIN_WORDS } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getCheckinDevices: vi.fn(),
      addCheckinDevice: vi.fn(),
      renewCheckinDeviceLink: vi.fn(),
      switchOffCheckinDevice: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const CheckinDevicesPanel = (await import('./CheckinDevicesPanel')).default;
const { readOnlyNote } = await import('../../pages/console/billingView');

const ORG = { id: '11111111-1111-4111-8111-111111111111', orgType: 'gym', timezone: 'Europe/London', clockFormat: '24h' };
const LINK = 'http://localhost:5173/check-in/setup#' + 'k'.repeat(43);

let n = 0;
const device = (over) => ({
  id: `22222222-2222-4222-8222-${String(n++).padStart(12, '0')}`,
  name: 'Front desk',
  state: 'on',
  linkExpiresAt: null,
  lastSeenAt: null,
  createdAt: `2026-10-01T09:00:${String(n).padStart(2, '0')}.000Z`,
  keyTagsPausedUntil: null,
  ...over,
});

function open(devices, { readOnly = false } = {}) {
  orgService.getCheckinDevices.mockResolvedValue({ data: { devices } });
  render(<CheckinDevicesPanel org={ORG} readOnly={readOnly} />);
  fireEvent.click(screen.getByRole('button', { name: /check-in devices/i }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the closed box says what is there', () => {
  it('none yet', async () => {
    orgService.getCheckinDevices.mockResolvedValue({ data: { devices: [] } });
    render(<CheckinDevicesPanel org={ORG} readOnly={false} />);
    expect(await screen.findByText('No devices yet')).toBeTruthy();
  });

  it('how many, and how many are on', async () => {
    orgService.getCheckinDevices.mockResolvedValue({ data: { devices: [device({}), device({ name: 'Studio', state: 'off' })] } });
    render(<CheckinDevicesPanel org={ORG} readOnly={false} />);
    expect(await screen.findByText('2 devices · 1 on')).toBeTruthy();
  });

  it('a failed read opens the box and says so, and Try again reads again', async () => {
    orgService.getCheckinDevices.mockRejectedValueOnce({ response: { status: 500, data: {} } }).mockResolvedValueOnce({ data: { devices: [] } });
    render(<CheckinDevicesPanel org={ORG} readOnly={false} />);
    expect(await screen.findByText("We couldn't load your check-in devices.")).toBeTruthy();
    expect(screen.queryByText('Add a device')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Add a device')).toBeTruthy();
  });
});

describe('adding a device', () => {
  it('shows its link once, for that device, and Done takes it away for good', async () => {
    const added = device({ name: 'Front desk', state: 'waiting', linkExpiresAt: '2026-10-02T14:00:00.000Z' });
    orgService.addCheckinDevice.mockResolvedValue({ data: { device: added, link: LINK } });
    open([]);
    const name = await screen.findByLabelText('Add a device');
    fireEvent.change(name, { target: { value: '  Front desk ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }));

    expect(await screen.findByText('Open this link on Front desk')).toBeTruthy();
    expect(orgService.addCheckinDevice).toHaveBeenCalledWith(ORG.id, 'Front desk');
    expect(screen.getByLabelText('Link for Front desk').value).toBe(LINK);
    expect(screen.getByText(/It works once, until 15:00/)).toBeTruthy();
    expect(screen.getByText('Waiting')).toBeTruthy();
    expect(name.value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByDisplayValue(LINK)).toBeNull();
    expect(document.body.textContent).not.toContain(LINK);
  });

  it('a name is needed, and nothing is sent without one', async () => {
    open([]);
    await screen.findByLabelText('Add a device');
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }));
    expect(screen.getByText('Give the device a name, such as Front desk.')).toBeTruthy();
    expect(orgService.addCheckinDevice).not.toHaveBeenCalled();
  });

  it('a refusal is said in the server’s words', async () => {
    orgService.addCheckinDevice.mockRejectedValue({ response: { status: 409, data: { error: 'too_many_devices', message: CHECKIN_WORDS.too_many_devices } } });
    open([]);
    fireEvent.change(await screen.findByLabelText('Add a device'), { target: { value: 'Front desk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(CHECKIN_WORDS.too_many_devices);
  });

  it('at the limit there is no form, and the box says why', async () => {
    open(Array.from({ length: CHECKIN_DEVICES_MAX }, () => device({ state: 'off' })));
    expect(await screen.findByText(CHECKIN_WORDS.too_many_devices)).toBeTruthy();
    expect(screen.queryByLabelText('Add a device')).toBeNull();
  });
});

describe('a device in use', () => {
  it('Switch off asks first, naming the device and what stops', async () => {
    const on = device({ name: 'Front desk' });
    orgService.switchOffCheckinDevice.mockResolvedValue({ data: { device: { ...on, state: 'off' } } });
    open([on]);
    fireEvent.click(await screen.findByRole('button', { name: 'Switch off' }));
    expect(screen.getByText('Switch off Front desk? It stops checking people in at once. You can turn it back on with a new link.')).toBeTruthy();
    expect(orgService.switchOffCheckinDevice).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Switch off' }));
    await waitFor(() => expect(orgService.switchOffCheckinDevice).toHaveBeenCalledWith(ORG.id, on.id));
    expect(await screen.findByText('Off')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Turn on with a new link' })).toBeTruthy();
  });

  it('Keep it leaves it on', async () => {
    open([device({})]);
    fireEvent.click(await screen.findByRole('button', { name: 'Switch off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(orgService.switchOffCheckinDevice).not.toHaveBeenCalled();
    expect(screen.getByText('On')).toBeTruthy();
  });

  it('New link asks first, because the device stops until it is opened', async () => {
    const on = device({ name: 'Front desk' });
    orgService.renewCheckinDeviceLink.mockResolvedValue({
      data: { device: { ...on, state: 'waiting', linkExpiresAt: '2026-10-02T14:00:00.000Z' }, link: LINK },
    });
    open([on]);
    fireEvent.click(await screen.findByRole('button', { name: 'New link' }));
    expect(screen.getByText('Make a new link for Front desk? It stops checking people in until the new link is opened on it.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make a new link' }));
    expect(await screen.findByText('Open this link on Front desk')).toBeTruthy();
  });

  it('a device whose key tags are paused says so, and that passes still work', async () => {
    open([device({ keyTagsPausedUntil: '2099-01-01T10:10:00.000Z' })]);
    expect(await screen.findByText(/^Not taking key tags until .*Passes still work\.$/)).toBeTruthy();
  });
});

describe('a device not checking anybody in', () => {
  it('an off device turns on with a new link, with no question', async () => {
    const off = device({ name: 'Studio', state: 'off' });
    orgService.renewCheckinDeviceLink.mockResolvedValue({ data: { device: { ...off, state: 'waiting' }, link: LINK } });
    open([off]);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on with a new link' }));
    expect(await screen.findByText('Open this link on Studio')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Switch off' })).not.toBeNull();
  });

  it('a waiting device gets a new link with no question', async () => {
    const waiting = device({ name: 'Studio', state: 'waiting' });
    orgService.renewCheckinDeviceLink.mockResolvedValue({ data: { device: waiting, link: LINK } });
    open([waiting]);
    fireEvent.click(await screen.findByRole('button', { name: 'New link' }));
    expect(await screen.findByText('Open this link on Studio')).toBeTruthy();
  });
});

describe('a gym with no live plan', () => {
  it('cannot add or make links, says why, and can still switch a device off', async () => {
    open([device({})], { readOnly: true });
    expect(await screen.findByText(readOnlyNote('gym'))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add device' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'New link' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Switch off' }).disabled).toBe(false);
  });
});
