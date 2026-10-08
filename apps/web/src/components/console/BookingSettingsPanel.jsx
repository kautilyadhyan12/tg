import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import {
  BOOKING_TIME_UNITS,
  bookingSettingsBody,
  bookingSettingsChanged,
  bookingSettingsDraft,
  bookingSettingsProblem,
  bookingSettingsSavedLine,
  bookingSettingsSummary,
} from '../../pages/console/bookingsEndView';
import { ConsoleFailed, ConsoleLoading, ConsoleSection } from './ConsoleStates';

// BOOKING RULES (ROADMAP 17c-ii-a, 17e-vi; spec Part 3 §13.4, §13.5): the gym's four
// booking settings for classes, and personal training's own two (when a member can book
// a session, and until when a cancel is free), each a starting value it can change
// (RULINGS 2026-09-21, 2026-10-08). All six wait for one Save, as the gym's details do
// above.

const inputStyle = {
  background: '#0A0908',
  border: '1px solid rgba(255,255,255,0.10)',
  color: '#fff',
};
const labelStyle = { color: 'rgba(255,255,255,0.85)' };
const hintStyle = { color: 'rgba(255,255,255,0.45)' };

function NumberBox({ id, value, onChange, disabled, label }) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
      disabled={disabled}
      className="rounded-xl px-3 py-3 text-base sm:text-sm w-20"
      style={inputStyle}
    />
  );
}

/** `one`: the number beside it is 1, so the units read "minute", "hour", "day". */
function UnitPick({ value, onChange, disabled, label, one }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="rounded-xl px-3 py-3 text-base sm:text-sm"
      style={inputStyle}
    >
      {BOOKING_TIME_UNITS.map((unit) => (
        <option key={unit} value={unit}>
          {one ? unit.slice(0, -1) : unit}
        </option>
      ))}
    </select>
  );
}

function Part({ title, intro, children }) {
  return (
    <fieldset className="flex flex-col gap-5 m-0 p-0 border-0 min-w-0">
      <legend className="text-base font-bold p-0 mb-2" style={{ color: '#fff' }}>
        {title}
      </legend>
      <p className="text-sm m-0" style={{ color: 'rgba(255,255,255,0.55)' }}>
        {intro}
      </p>
      {children}
    </fieldset>
  );
}

function Row({ title, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold" style={labelStyle}>
        {title}
      </span>
      <div className="flex flex-wrap items-center gap-2 text-sm" style={labelStyle}>
        {children}
      </div>
      <span className="text-xs" style={hintStyle}>
        {hint}
      </span>
    </div>
  );
}

// `startOpen`: the page was opened by a link to this box (the Classes and Personal training pages).
export default function BookingSettingsPanel({ org, readOnly, startOpen = false }) {
  const gymId = org.id;
  const [settings, setSettings] = useState(null);
  const [pt, setPt] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  // What the last save said, until something is typed again; null before one.
  const [saved, setSaved] = useState(null);

  const fetchSettings = useCallback(
    (isLive = () => true) =>
      orgService
        .getBookingSettings(gymId)
        .then((res) => {
          if (!isLive()) return;
          setSettings(res.data.settings);
          setPt(res.data.pt);
          setDraft(bookingSettingsDraft(res.data.settings, res.data.pt));
        })
        .catch((err) => {
          if (isLive()) setLoadError(errorText(err, "We couldn't load your booking settings."));
        }),
    [gymId],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchSettings(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [fetchSettings]);

  const retry = () => {
    setLoadError(null);
    void fetchSettings();
  };

  const ready = settings !== null && pt !== null && draft !== null;
  const changed = ready && bookingSettingsChanged(draft, settings, pt);
  const problem = ready && changed ? bookingSettingsProblem(draft) : null;
  const canSave = changed && problem === null && !saving && !readOnly;
  const off = readOnly || saving;

  const edit = (patch) => {
    setDraft({ ...draft, ...patch });
    setSaved(null);
    setSaveError(null);
  };

  const save = async (event) => {
    event.preventDefault();
    if (!canSave) return;
    const body = bookingSettingsBody(draft);
    if (body === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await orgService.updateBookingSettings(gymId, body);
      setSettings(res.data.settings);
      setPt(res.data.pt);
      setDraft(bookingSettingsDraft(res.data.settings, res.data.pt));
      setSaved(bookingSettingsSavedLine(res.data.movedIn));
    } catch (err) {
      setSaveError(errorText(err, "We couldn't save your booking settings."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConsoleSection title="Booking rules" summary={bookingSettingsSummary(settings, pt)} forceOpen={loadError !== null} defaultOpen={startOpen}>
      {readOnly ? (
        <p className="text-xs mb-3" style={hintStyle}>
          {readOnlyNote(org.orgType)}
        </p>
      ) : null}
      {loadError !== null ? (
        <ConsoleFailed message={loadError} onRetry={retry} />
      ) : !ready ? (
        <ConsoleLoading label="Loading…" />
      ) : (
        <form onSubmit={save} className="flex flex-col gap-8">
          <Part title="Classes" intro="These apply to every class from now on. Nobody who is booked loses their place.">
            <Row title="When booking opens" hint="Members can book from then until the class starts.">
              <NumberBox label="Days before a class that booking opens" value={draft.opensDays} onChange={(opensDays) => edit({ opensDays })} disabled={off} />
              <span>{draft.opensDays === '1' ? 'day' : 'days'} before the class</span>
            </Row>

            <Row
              title="Free cancelling"
              hint="After that it is a late cancel: it counts against the member, and a pack keeps the class as used."
            >
              <span>Until</span>
              <NumberBox label="How long before a class cancelling is free" value={draft.freeAmount} onChange={(freeAmount) => edit({ freeAmount })} disabled={off} />
              <UnitPick label="Free cancelling, in" value={draft.freeUnit} one={draft.freeAmount === '1'} onChange={(freeUnit) => edit({ freeUnit })} disabled={off} />
              <span>before the class</span>
            </Row>

            <Row
              title="When a place comes free"
              hint="Closer to the class than that, everyone on the waitlist can take it and the first to tap Claim gets it. Saving a shorter time gives places that are free now to people already on a waitlist, straight away. Your events' waitlists use this time too."
            >
              <span>The first person on the waitlist gets it automatically until</span>
              <NumberBox label="How long before a class a free place goes to the waitlist automatically" value={draft.handoverAmount} onChange={(handoverAmount) => edit({ handoverAmount })} disabled={off} />
              <UnitPick label="The waitlist time, in" value={draft.handoverUnit} one={draft.handoverAmount === '1'} onChange={(handoverUnit) => edit({ handoverUnit })} disabled={off} />
              <span>before the class</span>
            </Row>

            <Row title="Waitlist size" hint="0 means a full class has no waitlist. People already waiting stay on it. Your events' waitlists hold this many too.">
              <span>Up to</span>
              <NumberBox label="How many people a waitlist holds" value={draft.waitlistMax} onChange={(waitlistMax) => edit({ waitlistMax })} disabled={off} />
              <span>people for each class</span>
            </Row>
          </Part>

          <Part
            title="Personal training"
            intro="These apply to every personal training session from now on, the ones already booked too. Nobody's session is cancelled."
          >
            <Row title="When booking opens" hint="Members can book a session from then until it starts. Your staff can book one for a member further ahead.">
              <NumberBox label="Days before a personal training session that booking opens" value={draft.ptOpensDays} onChange={(ptOpensDays) => edit({ ptOpensDays })} disabled={off} />
              <span>{draft.ptOpensDays === '1' ? 'day' : 'days'} before the session</span>
            </Row>

            <Row
              title="Free cancelling"
              hint="After that it is a late cancel: a pack keeps the session as used, and it still counts where a membership has a limit on sessions. Your staff can give the session back."
            >
              <span>Until</span>
              <NumberBox label="How long before a personal training session cancelling is free" value={draft.ptFreeAmount} onChange={(ptFreeAmount) => edit({ ptFreeAmount })} disabled={off} />
              <UnitPick label="Free cancelling for personal training, in" value={draft.ptFreeUnit} one={draft.ptFreeAmount === '1'} onChange={(ptFreeUnit) => edit({ ptFreeUnit })} disabled={off} />
              <span>before the session</span>
            </Row>
          </Part>

          {problem === null ? null : (
            <p className="text-sm" style={{ color: '#ef4444' }}>
              {problem}
            </p>
          )}
          {saveError !== null ? <ConsoleFailed message={saveError} /> : null}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!canSave}
              className="rounded-xl px-5 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-40"
              style={{
                background: canSave ? 'linear-gradient(135deg,#FF8A1F,#FFB347)' : 'rgba(255,255,255,0.08)',
                color: canSave ? '#0A0908' : 'rgba(255,255,255,0.35)',
              }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            {saved !== null ? (
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
                {saved}
              </span>
            ) : null}
          </div>
        </form>
      )}
    </ConsoleSection>
  );
}
