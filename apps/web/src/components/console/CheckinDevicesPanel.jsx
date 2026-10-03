import { useCallback, useEffect, useState } from 'react';
import { CHECKIN_DEVICE_NAME_MAX, CHECKIN_WORDS } from '@app/shared';
import { Copy, Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import {
  canAddDevice,
  confirmQuestion,
  deviceNameProblem,
  deviceState,
  devicesSummary,
  keyTagPauseLine,
  momentLabel,
} from '../../pages/console/checkinDevicesView';
import { ConfirmInline, ConsoleFailed, ConsoleLoading, ConsoleSection } from './ConsoleStates';

// CHECK-IN DEVICES (spec Part 3 §12.3; ROADMAP 16b-i), on `org.manage` as the server gates
// it. A device is a tablet or computer at the front desk; adding one gives a one-time link
// to open ON it, shown here once and never again. Switch off works on a lapsed plan, so an
// owner can always stop a lost tablet; adding and new links wait for a live plan.

const inputStyle = {
  background: '#0A0908',
  border: '1px solid rgba(255,255,255,0.10)',
  color: '#fff',
};
const quietButton = { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)' };
const TAG_STYLES = {
  good: { background: 'rgba(70,217,147,0.12)', color: '#46D993' },
  plain: { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)' },
  off: { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' },
};

function LinkBox({ shown, clock, onDone }) {
  const [copied, setCopied] = useState(false);
  const until = shown.device.linkExpiresAt === null ? '' : momentLabel(shown.device.linkExpiresAt, clock);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'rgba(255,138,31,0.08)', border: '1px solid rgba(255,138,31,0.35)' }}>
      <p className="text-sm font-semibold" style={{ color: '#fff' }}>
        Open this link on {shown.device.name}
      </p>
      <p className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
        Open it on the tablet or computer itself, in a browser nobody is signed in to, and leave
        it there. It works once{until === '' ? '' : `, until ${until}`}. Whoever opens it first
        becomes this device, so don&apos;t post it anywhere others can see it.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          readOnly
          value={shown.link}
          aria-label={`Link for ${shown.device.name}`}
          onFocus={(event) => event.target.select()}
          className="w-full rounded-xl px-4 py-3 text-base sm:text-sm"
          style={inputStyle}
        />
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-xl px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2 min-h-11"
          style={quietButton}
        >
          <Copy className="w-4 h-4" aria-hidden="true" />
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      <button type="button" onClick={onDone} className="self-start rounded-xl px-4 py-2 text-sm min-h-11" style={quietButton}>
        Done
      </button>
    </div>
  );
}

function DeviceRow({ device, clock, readOnly, busy, onNewLink, onSwitchOff }) {
  const [asking, setAsking] = useState(null);
  const state = deviceState(device, clock);
  const pause = keyTagPauseLine(device, clock);

  const askOrDo = (kind) => {
    // A device that is not checking anybody in loses nothing to a new link.
    if (kind === 'link' && device.state !== 'on') onNewLink(device);
    else setAsking(kind);
  };

  return (
    <li className="py-3 flex flex-col gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold" style={{ color: '#fff' }}>
          {device.name}
        </span>
        <span className="text-xs rounded-full px-2 py-0.5 font-semibold" style={TAG_STYLES[state.tone]}>
          {state.tag}
        </span>
      </div>
      <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
        {state.line}
      </p>
      {pause !== null ? (
        <p className="text-sm" style={{ color: '#F2C35B' }}>
          {pause}
        </p>
      ) : null}
      {asking !== null ? (
        <ConfirmInline
          question={confirmQuestion(asking, device)}
          confirmLabel={asking === 'off' ? 'Switch off' : 'Make a new link'}
          busy={busy}
          onConfirm={() => {
            setAsking(null);
            if (asking === 'off') onSwitchOff(device);
            else onNewLink(device);
          }}
          onCancel={() => setAsking(null)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={readOnly || busy}
            onClick={() => askOrDo('link')}
            className="rounded-xl px-4 py-2 text-sm min-h-11 disabled:opacity-40"
            style={quietButton}
          >
            {device.state === 'off' ? 'Turn on with a new link' : 'New link'}
          </button>
          {device.state !== 'off' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => askOrDo('off')}
              className="rounded-xl px-4 py-2 text-sm min-h-11 disabled:opacity-40"
              style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}
            >
              Switch off
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}

export default function CheckinDevicesPanel({ org, readOnly }) {
  const gymId = org.id;
  const clock = { timezone: org.timezone, clockFormat: org.clockFormat };
  const [devices, setDevices] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [shownLink, setShownLink] = useState(null);

  const load = useCallback(
    (isLive = () => true) =>
      orgService
        .getCheckinDevices(gymId)
        .then((res) => {
          if (!isLive()) return;
          setDevices(res.data.devices);
          setLoadError(null);
        })
        .catch((err) => {
          if (isLive()) setLoadError(errorText(err, "We couldn't load your check-in devices."));
        }),
    [gymId],
  );

  useEffect(() => {
    let cancelled = false;
    void load(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const replaceDevice = (device) =>
    setDevices((list) => {
      const rest = (list ?? []).filter((d) => d.id !== device.id);
      return [...rest, device].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });

  const run = async (request, fallback) => {
    setBusy(true);
    setActionError(null);
    try {
      return await request();
    } catch (err) {
      setActionError(errorText(err, fallback));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const add = async (event) => {
    event.preventDefault();
    setNameTouched(true);
    if (deviceNameProblem(name) !== null || readOnly || busy) return;
    const res = await run(() => orgService.addCheckinDevice(gymId, name.trim()), "We couldn't add that device. Please try again.");
    if (res === null) return;
    replaceDevice(res.data.device);
    setShownLink(res.data);
    setName('');
    setNameTouched(false);
  };

  const newLink = async (device) => {
    const res = await run(() => orgService.renewCheckinDeviceLink(gymId, device.id), "We couldn't make a new link. Please try again.");
    if (res === null) return;
    replaceDevice(res.data.device);
    setShownLink(res.data);
  };

  const switchOff = async (device) => {
    const res = await run(() => orgService.switchOffCheckinDevice(gymId, device.id), "We couldn't switch that device off. Please try again.");
    if (res === null) return;
    replaceDevice(res.data.device);
    if (shownLink?.device.id === device.id) setShownLink(null);
  };

  const problem = nameTouched ? deviceNameProblem(name) : null;

  return (
    <ConsoleSection title="Check-in devices" summary={devices === null ? undefined : devicesSummary(devices)} forceOpen={loadError !== null}>
      {readOnly ? (
        <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {readOnlyNote(org.orgType)}
        </p>
      ) : null}
      <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
        A tablet or computer at your front desk, where people scan their pass from the app or
        their key tag. It can only check people in: it can&apos;t open your members or your
        settings.
      </p>
      <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
        For a busy desk, plug in a USB scanner that reads QR codes: it reads a pass or a key tag
        at once, in any light. The device&apos;s own camera reads a pass too, but not a key tag,
        and it needs the phone held close and still.
      </p>

      {loadError !== null ? (
        <div className="mt-3">
          <ConsoleFailed message={loadError} onRetry={() => void load()} />
        </div>
      ) : devices === null ? (
        <div className="mt-3">
          <ConsoleLoading label="Loading your check-in devices…" />
        </div>
      ) : (
        <div className="flex flex-col gap-4 mt-4">
          {shownLink !== null ? <LinkBox key={shownLink.link} shown={shownLink} clock={clock} onDone={() => setShownLink(null)} /> : null}

          {devices.length > 0 ? (
            <ul className="flex flex-col">
              {devices.map((device) => (
                <DeviceRow
                  key={device.id}
                  device={device}
                  clock={clock}
                  readOnly={readOnly}
                  busy={busy}
                  onNewLink={(d) => void newLink(d)}
                  onSwitchOff={(d) => void switchOff(d)}
                />
              ))}
            </ul>
          ) : null}

          {canAddDevice(devices) ? (
            <form onSubmit={(event) => void add(event)} className="flex flex-col gap-2">
              <label htmlFor={`checkin-device-name-${gymId}`} className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
                Add a device
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id={`checkin-device-name-${gymId}`}
                  value={name}
                  maxLength={CHECKIN_DEVICE_NAME_MAX}
                  onChange={(event) => setName(event.target.value)}
                  disabled={readOnly}
                  placeholder="For example: Front desk"
                  className="w-full rounded-xl px-4 py-3 text-base sm:text-sm"
                  style={inputStyle}
                />
                <button
                  type="submit"
                  disabled={readOnly || busy}
                  className="rounded-xl px-5 py-3 text-sm font-semibold flex items-center justify-center gap-2 min-h-11 disabled:opacity-40 whitespace-nowrap"
                  style={{ background: 'linear-gradient(135deg,#FF8A1F,#FFB347)', color: '#0A0908' }}
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                  Add device
                </button>
              </div>
              {problem !== null ? (
                <p className="text-sm" style={{ color: '#ef4444' }}>
                  {problem}
                </p>
              ) : null}
            </form>
          ) : (
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
              {CHECKIN_WORDS.too_many_devices}
            </p>
          )}

          {actionError !== null ? (
            <p className="text-sm" style={{ color: '#ef4444' }} role="alert">
              {actionError}
            </p>
          ) : null}
        </div>
      )}
    </ConsoleSection>
  );
}
