import { useCallback, useEffect, useState } from 'react';
import PlaceLink from './PlaceLink';
import { Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import {
  UNSIGNED_BOOKING_CHOICES,
  UNSIGNED_BOOKING_HINT,
  UNSIGNED_BOOKING_INTRO,
  unsignedNames,
  unsignedPeopleWords,
} from '../../pages/console/agreementView';

// BEFORE THEY BOOK (ROADMAP 18u-iv), the last part of Membership agreements: Let them book, or
// Stop new bookings until they sign, with its own Save, and who has one to sign today (for staff
// who see Members), See all opening Members already showing them. `version`: changes whenever the
// agreements do, so who has one to sign is read again.

const labelStyle = { color: 'rgba(255,255,255,0.85)' };
const softStyle = { color: 'rgba(255,255,255,0.55)' };
const hintStyle = { color: 'rgba(255,255,255,0.45)' };
const boxStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' };

export default function AgreementBookingsPart({ gymId, readOnly, membersTo, version }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchChoice = useCallback(
    (isLive = () => true) =>
      orgService
        .getAgreementBookings(gymId)
        .then((res) => {
          if (!isLive()) return;
          setLoadError(null);
          setData(res.data);
          setDraft(res.data.rule);
        })
        .catch((err) => {
          if (isLive()) setLoadError(errorText(err, "We couldn't load this setting."));
        }),
    [gymId],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchChoice(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [fetchChoice, version]);

  if (loadError !== null) {
    return (
      <p className="text-sm m-0" style={softStyle} role="alert">
        {loadError}
      </p>
    );
  }
  if (data === null || draft === null) return null;

  const changed = draft !== data.rule;
  const canSave = changed && !saving && !readOnly;
  const words = unsignedPeopleWords(data.stopped, draft, changed);
  const names = unsignedNames(data.stopped);

  const save = async (event) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await orgService.setAgreementBookings(gymId, draft);
      setData(res.data);
      setDraft(res.data.rule);
      setSaved(true);
    } catch (err) {
      setSaveError(errorText(err, "We couldn't save this setting."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void save(event)} id="agreement-bookings" className="flex flex-col gap-3" style={{ scrollMarginTop: 16 }}>
      <fieldset className="flex flex-col gap-1 m-0 p-0 border-0 min-w-0">
        <legend className="text-base font-bold p-0 mb-1" style={{ color: '#fff' }}>
          Before they book
        </legend>
        <p className="text-sm m-0 mb-1" style={softStyle}>
          {UNSIGNED_BOOKING_INTRO}
        </p>
        {UNSIGNED_BOOKING_CHOICES.map((choice) => (
          <label key={choice.value} className="flex items-center gap-3 py-2 min-h-11 cursor-pointer text-sm" style={labelStyle}>
            <input
              type="radio"
              name="agreement-bookings"
              value={choice.value}
              checked={draft === choice.value}
              onChange={() => {
                setDraft(choice.value);
                setSaved(false);
                setSaveError(null);
              }}
              disabled={readOnly || saving}
              className="w-4 h-4 flex-shrink-0"
              style={{ accentColor: '#FF8A1F' }}
            />
            <span>{choice.label}</span>
          </label>
        ))}
        <span className="text-xs" style={hintStyle}>
          {UNSIGNED_BOOKING_HINT}
        </span>
      </fieldset>
      {words !== null ? (
        <div role="group" aria-label="Who has a membership agreement to sign today" className="rounded-xl px-4 py-3 flex flex-col gap-2" style={boxStyle}>
          <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
            {words.title}
          </p>
          {names.shown.length > 0 ? (
            <ul className="m-0 p-0 list-none flex flex-col gap-1">
              {names.shown.map((person) => (
                <li key={person.entryId} className="text-sm" style={labelStyle}>
                  {person.name}
                </li>
              ))}
            </ul>
          ) : null}
          {names.shown.length > 0 ? (
            <p className="text-sm m-0 flex flex-wrap items-center gap-2" style={softStyle}>
              {names.more > 0 ? <span>{`and ${String(names.more)} more`}</span> : null}
              <PlaceLink to={`${membersTo}?show=agreement-not-signed`} guard={changed} className="c-lk c-w6">
                See all
              </PlaceLink>
            </p>
          ) : null}
          {words.rest !== null ? (
            <p className="text-sm m-0" style={softStyle}>
              {words.rest}
            </p>
          ) : null}
        </div>
      ) : null}
      {saveError !== null ? (
        <p className="text-sm m-0" style={{ color: '#ef4444' }} role="alert">
          {saveError}
        </p>
      ) : null}
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
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && !changed ? (
          <span role="status" className="text-sm" style={softStyle}>
            Saved.
          </span>
        ) : null}
      </div>
    </form>
  );
}
