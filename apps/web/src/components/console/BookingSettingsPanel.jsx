import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import { placeFor } from '../../pages/console/consolePlaces';
import PlaceLink from './PlaceLink';
import { overdueHint } from '../../pages/console/checkinRulesView';
import {
  OVERDUE_BOOKING_CHOICES,
  OVERDUE_BOOKING_HINT,
  overdueNames,
  overduePeopleWords,
  BOOKING_TIME_UNITS,
  classFeesDraft,
  classFeesFromDraft,
  currencySign,
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
// above, and so do the late cancel and no-show fees, the classes' (18h-i) and personal
// training's own (18h-ii), which only staff who record members' payments can change; so
// does whether a member books while a payment is overdue (17i), which names who it stops today.

const inputStyle = {
  background: '#0A0908',
  border: '1px solid rgba(255,255,255,0.10)',
  color: '#fff',
};
const labelStyle = { color: 'rgba(255,255,255,0.85)' };
const hintStyle = { color: 'rgba(255,255,255,0.45)' };
const softStyle = { color: 'rgba(255,255,255,0.55)' };
const boxStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' };

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

/** An amount of money, behind its sign. */
function MoneyBox({ value, onChange, disabled, label, sign }) {
  return (
    <span className="flex items-center gap-1.5">
      <span>{sign}</span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 12))}
        disabled={disabled}
        className="rounded-xl px-3 py-3 text-base sm:text-sm w-28"
        style={inputStyle}
      />
    </span>
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

/** Who has an overdue payment today, and what the choice picked does to them. */
function OverduePeople({ stopped, rule, changed }) {
  const [all, setAll] = useState(false);
  const words = overduePeopleWords(stopped, rule, changed);
  if (words === null) return null;
  const names = overdueNames(stopped, all);
  return (
    <div role="group" aria-label="Who has an overdue payment today" className="rounded-xl px-4 py-3 flex flex-col gap-2" style={boxStyle}>
      <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
        {words.title}
      </p>
      {names.shown.length > 0 ? (
        <ul className={`m-0 p-0 list-none flex flex-col gap-1 ${all ? 'max-h-64 overflow-y-auto' : ''}`}>
          {names.shown.map((person) => (
            <li key={person.entryId} className="text-sm" style={labelStyle}>
              {person.name}
            </li>
          ))}
        </ul>
      ) : null}
      {names.more > 0 ? (
        <p className="text-sm m-0 flex flex-wrap items-center gap-2" style={softStyle}>
          <span>{all ? `and ${String(names.notSent)} more, not listed here` : `and ${String(names.more)} more`}</span>
          {names.canSeeAll ? (
            <button type="button" onClick={() => setAll(true)} className="text-sm font-semibold underline min-h-11 sm:min-h-0" style={{ color: '#FFB347' }}>
              See all
            </button>
          ) : null}
        </p>
      ) : null}
      {words.rest !== null ? (
        <p className="text-sm m-0" style={softStyle}>
          {words.rest}
        </p>
      ) : null}
    </div>
  );
}

// `startOpen`: the page was opened by a link to this box (the Classes and Personal training pages).
export default function BookingSettingsPanel({ org, orgSlug, privileges, readOnly, startOpen = false }) {
  const gymId = org.id;
  const [settings, setSettings] = useState(null);
  const [pt, setPt] = useState(null);
  const [draft, setDraft] = useState(null);
  // The class fees as saved, with their money and who may change them, and as typed.
  const [fees, setFees] = useState(null);
  const [feeDraft, setFeeDraft] = useState(null);
  // Personal training's own two, as saved and as typed (18h-ii), in the same money.
  const [ptFees, setPtFees] = useState(null);
  const [ptFeeDraft, setPtFeeDraft] = useState(null);
  // No new bookings while a payment is overdue (17i): as saved, and as picked.
  const [overdue, setOverdue] = useState(null);
  const [overdueDraft, setOverdueDraft] = useState(null);
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
          setFees(res.data.fees ?? null);
          setFeeDraft(res.data.fees ? classFeesDraft(res.data.fees) : null);
          setPtFees(res.data.ptFees ?? null);
          setPtFeeDraft(res.data.fees && res.data.ptFees ? classFeesDraft({ ...res.data.ptFees, currency: res.data.fees.currency }) : null);
          setOverdue(res.data.overdue ?? null);
          setOverdueDraft(res.data.overdue?.rule ?? null);
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
  // The class fees (18h-i), where the server sent them.
  const hasFees = ready && fees !== null && feeDraft !== null;
  const typedFees = hasFees ? classFeesFromDraft(feeDraft, fees.currency) : null;
  const feesChanged = hasFees && fees.canChange && (typedFees === null || typedFees.lateCancelMinor !== fees.lateCancelMinor || typedFees.noShowMinor !== fees.noShowMinor);
  // Personal training's (18h-ii), where the server sent them.
  const hasPtFees = hasFees && ptFees !== null && ptFeeDraft !== null;
  const typedPtFees = hasPtFees ? classFeesFromDraft(ptFeeDraft, fees.currency) : null;
  const ptFeesChanged =
    hasPtFees && fees.canChange && (typedPtFees === null || typedPtFees.lateCancelMinor !== ptFees.lateCancelMinor || typedPtFees.noShowMinor !== ptFees.noShowMinor);
  const hasOverdue = ready && fees !== null && overdue !== null && overdueDraft !== null;
  const overdueChanged = hasOverdue && fees.canChange && overdueDraft !== overdue.rule;
  const changed = ready && (bookingSettingsChanged(draft, settings, pt) || feesChanged || ptFeesChanged || overdueChanged);
  const feeTypo = (hasFees && typedFees === null) || (hasPtFees && typedPtFees === null);
  const problem = !ready || !changed ? null : (bookingSettingsProblem(draft) ?? (feeTypo ? 'Type each fee as an amount, or 0 for no fee.' : null));
  const canSave = changed && problem === null && !saving && !readOnly;
  const off = readOnly || saving;

  const edit = (patch) => {
    setDraft({ ...draft, ...patch });
    setSaved(null);
    setSaveError(null);
  };
  const editFees = (patch) => {
    setFeeDraft({ ...feeDraft, ...patch });
    setSaved(null);
    setSaveError(null);
  };
  const editPtFees = (patch) => {
    setPtFeeDraft({ ...ptFeeDraft, ...patch });
    setSaved(null);
    setSaveError(null);
  };
  const feesOff = off || !fees?.canChange;
  const sign = fees === null ? '' : currencySign(fees.currency);
  const membershipsTo = placeFor(orgSlug, privileges, 'memberships');
  const billsTo = placeFor(orgSlug, privileges, 'membershipBills');
  const pickOverdue = (rule) => {
    setOverdueDraft(rule);
    setSaved(null);
    setSaveError(null);
  };

  const save = async (event) => {
    event.preventDefault();
    if (!canSave) return;
    const rules = bookingSettingsBody(draft);
    const sendsFees = hasFees && fees.canChange;
    const sendsPtFees = hasPtFees && fees.canChange;
    if (rules === null || (sendsFees && typedFees === null) || (sendsPtFees && typedPtFees === null)) return;
    // The fees go only from staff who may change them; anybody else's save leaves them be.
    const sendsOverdue = hasOverdue && fees.canChange;
    const body = {
      ...rules,
      ...(sendsFees ? { fees: typedFees } : {}),
      ...(sendsPtFees ? { ptFees: typedPtFees } : {}),
      ...(sendsOverdue ? { overdue: overdueDraft } : {}),
    };
    setSaving(true);
    setSaveError(null);
    try {
      const res = await orgService.updateBookingSettings(gymId, body);
      setSettings(res.data.settings);
      setPt(res.data.pt);
      setDraft(bookingSettingsDraft(res.data.settings, res.data.pt));
      setFees(res.data.fees ?? null);
      setFeeDraft(res.data.fees ? classFeesDraft(res.data.fees) : null);
      setPtFees(res.data.ptFees ?? null);
      setPtFeeDraft(res.data.fees && res.data.ptFees ? classFeesDraft({ ...res.data.ptFees, currency: res.data.fees.currency }) : null);
      setOverdue(res.data.overdue ?? null);
      setOverdueDraft(res.data.overdue?.rule ?? null);
      setSaved(bookingSettingsSavedLine(res.data.movedIn));
    } catch (err) {
      setSaveError(errorText(err, "We couldn't save your booking settings."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConsoleSection title="Booking rules" summary={bookingSettingsSummary(settings, pt, fees, fees !== null && ptFees !== null ? { ...ptFees, currency: fees.currency } : null, overdue?.rule ?? null)} forceOpen={loadError !== null} defaultOpen={startOpen}>
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

            {hasFees ? (
              <>
                <Row
                  title="Late cancel fee"
                  hint="A one-time charge, never monthly: added once to the member's bill each time they cancel after free cancelling ends. They see the fee before they confirm. 0 means no fee. Members on a class pack never pay it: the class stays used on their pack."
                >
                  <MoneyBox label="Late cancel fee" sign={sign} value={feeDraft.lateText} onChange={(lateText) => editFees({ lateText })} disabled={feesOff} />
                  <span>once, for each late cancel</span>
                </Row>

                <Row
                  title="No-show fee"
                  hint="A one-time charge, never monthly: added once to the member's bill each time they are marked No-show, by staff, or by itself 15 minutes after the class ends when you check people in and they never checked in. Marking them Came takes an unpaid fee off. 0 means no fee. Class pack members never pay it."
                >
                  <MoneyBox label="No-show fee" sign={sign} value={feeDraft.noShowText} onChange={(noShowText) => editFees({ noShowText })} disabled={feesOff} />
                  <span>once, for each no-show</span>
                </Row>

                {fees.canChange ? null : (
                  <p className="text-xs m-0" style={hintStyle} data-testid="fees-who">
                    Only staff who record members' payments can change fees. Ask the owner.
                  </p>
                )}
                {fees.onBills ? null : (
                  <p className="text-sm m-0 flex flex-wrap items-center gap-x-3 gap-y-1" style={labelStyle} data-testid="fees-need-membership">
                    <span>A fee goes on the bills of the membership a member booked with, so fees start once you sell memberships here.</span>
                    {membershipsTo === null ? (
                      <span style={hintStyle}>The owner or a manager can add one on Memberships.</span>
                    ) : (
                      <PlaceLink to={membershipsTo} className="c-lk c-w6">
                        Add a membership
                      </PlaceLink>
                    )}
                  </p>
                )}
              </>
            ) : null}
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

            {hasPtFees ? (
              <>
                <Row
                  title="Late cancel fee"
                  hint="A one-time charge, never monthly: added once to the member's bill each time a session is cancelled after free cancelling ends and stays used. They see the fee before they confirm. 0 means no fee. A session your staff give back costs nothing. Members on a personal training pack never pay it: the session stays used on their pack."
                >
                  <MoneyBox label="Late cancel fee for personal training" sign={sign} value={ptFeeDraft.lateText} onChange={(lateText) => editPtFees({ lateText })} disabled={feesOff} />
                  <span>once, for each late cancel</span>
                </Row>

                <Row
                  title="No-show fee"
                  hint="A one-time charge, never monthly: added once to the member's bill each time staff mark them No-show. Marking them Came takes an unpaid fee off. 0 means no fee. Members on a personal training pack never pay it."
                >
                  <MoneyBox label="No-show fee for personal training" sign={sign} value={ptFeeDraft.noShowText} onChange={(noShowText) => editPtFees({ noShowText })} disabled={feesOff} />
                  <span>once, for each no-show</span>
                </Row>

                {fees.canChange ? null : (
                  <p className="text-xs m-0" style={hintStyle} data-testid="pt-fees-who">
                    Only staff who record members' payments can change fees. Ask the owner.
                  </p>
                )}
              </>
            ) : null}
          </Part>

          {hasOverdue ? (
            <Part title="Overdue payments" intro={`What happens when a member with an overdue payment tries to book in the app. ${overdueHint(overdue.afterDays)}`}>
              <fieldset className="flex flex-col gap-1 m-0 p-0 border-0 min-w-0">
                <legend className="text-sm font-semibold p-0 mb-1" style={labelStyle}>
                  New bookings
                </legend>
                {OVERDUE_BOOKING_CHOICES.map((choice) => (
                  <label key={choice.value} className="flex items-center gap-3 py-2 min-h-11 cursor-pointer text-sm" style={labelStyle}>
                    <input
                      type="radio"
                      name="overdue-bookings"
                      value={choice.value}
                      checked={overdueDraft === choice.value}
                      onChange={() => pickOverdue(choice.value)}
                      disabled={feesOff}
                      className="w-4 h-4 flex-shrink-0"
                      style={{ accentColor: '#FF8A1F' }}
                    />
                    <span>{choice.label}</span>
                  </label>
                ))}
                <span className="text-xs" style={hintStyle}>
                  {OVERDUE_BOOKING_HINT}
                </span>
              </fieldset>
              <p className="text-sm m-0 flex flex-wrap items-center gap-x-3 gap-y-1" style={labelStyle} data-testid="overdue-grace">
                <span>The grace period is set in the Bills box on Memberships.</span>
                {billsTo === null ? (
                  <span style={hintStyle}>Staff who can change the price list change it there.</span>
                ) : (
                  <PlaceLink to={billsTo} className="c-lk c-w6">
                    Change the grace period
                  </PlaceLink>
                )}
              </p>
              {fees.canChange ? (
                <OverduePeople stopped={overdue.stopped} rule={overdueDraft} changed={overdueChanged} />
              ) : (
                <p className="text-xs m-0" style={hintStyle} data-testid="overdue-who">
                  Only staff who record members' payments can change this. Ask the owner.
                </p>
              )}
            </Part>
          ) : null}

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
