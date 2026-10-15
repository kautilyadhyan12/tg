import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import { viewerPrivileges } from '../../pages/console/consoleView';
import { placeFor } from '../../pages/console/consolePlaces';
import PlaceLink from './PlaceLink';
import {
  NO_GIFT,
  friendPreview,
  giftChoices,
  giftNote,
  giftOption,
  memberPreview,
  referralBody,
  referralChanged,
  referralDraft,
  referralProblem,
  referralSummary,
} from '../../pages/console/referralView';
import { ConsoleFailed, ConsoleLoading, ConsoleSection } from './ConsoleStates';

// REFER A FRIEND (ROADMAP 20e-ii-a; spec Part 3 §16.3): the owner switches it on and picks
// the promo codes the business gives, one for the member who invites and one for the
// friend, or either alone. Below, exactly what a member and a friend will read with them.
// The switch and both codes wait for Save together.

const inputStyle = {
  background: '#0A0908',
  border: '1px solid rgba(255,255,255,0.10)',
  color: '#fff',
};

function GiftPicker({ label, hint, value, settings, disabled, onChange }) {
  const choices = giftChoices(settings, value);
  const note = giftNote(settings, value);
  return (
    <label className="block">
      <span className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
        {label}
      </span>
      <span className="block text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
        {hint}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label}
        className="mt-2 w-full rounded-xl px-4 py-3 text-base sm:text-sm"
        style={inputStyle}
      >
        <option value={NO_GIFT}>No gift</option>
        {choices.map((d) => (
          <option key={d.id} value={d.id}>
            {giftOption(d)}
          </option>
        ))}
      </select>
      {note !== null ? (
        <span className="block text-xs mt-1.5" style={{ color: '#FFB347' }}>
          {note}
        </span>
      ) : null}
    </label>
  );
}

function Preview({ title, lines }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.45)' }}>
        {title}
      </p>
      {lines.map((line) => (
        <p key={line} className="text-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>
          {line}
        </p>
      ))}
    </div>
  );
}

// `startOpen`: the page was opened by a link to this section.
export default function ReferralPanel({ org, readOnly, startOpen = false }) {
  const gymId = org.id;
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchSettings = useCallback(
    (isLive = () => true) =>
      orgService
        .getReferralSettings(gymId)
        .then((res) => {
          if (!isLive()) return;
          setSettings(res.data.settings);
          setDraft(referralDraft(res.data.settings));
        })
        .catch((err) => {
          // Never drawn as a switched-off box: the section opens and says so.
          if (isLive()) setLoadError(errorText(err, "We couldn't load Refer a friend."));
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

  const problem = settings !== null && draft !== null ? referralProblem(draft, settings) : null;
  const changed = settings !== null && draft !== null && referralChanged(draft, settings);
  const canSave = changed && problem === null && !saving && !readOnly;
  const membershipsTo = placeFor(org.slug, viewerPrivileges(org), 'membershipDiscounts');

  const edit = (next) => {
    setDraft(next);
    setSaved(false);
    setSaveError(null);
  };

  const save = async (event) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await orgService.saveReferralSettings(gymId, referralBody(draft));
      setSettings(res.data.settings);
      setDraft(referralDraft(res.data.settings));
      setSaved(true);
    } catch (err) {
      setSaveError(errorText(err, "We couldn't save that. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  const noCodes = settings !== null && settings.discounts.every((d) => d.code === null);
  return (
    <ConsoleSection title="Refer a friend" summary={referralSummary(settings)} forceOpen={loadError !== null} defaultOpen={startOpen}>
      {readOnly ? (
        <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {readOnlyNote(org.orgType)}
        </p>
      ) : null}
      {loadError !== null ? (
        <ConsoleFailed message={loadError} onRetry={retry} />
      ) : settings === null || draft === null ? (
        <ConsoleLoading label="Loading…" />
      ) : (
        <form onSubmit={save} className="flex flex-col gap-4">
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Your members share their own invite link from the app. A friend who opens it can send you their details, and
            they arrive on Leads marked with who invited them. You choose the gifts, using your own promo codes.
          </p>

          <label className={`flex items-start gap-3 ${readOnly ? '' : 'cursor-pointer'}`}>
            <input type="checkbox" checked={draft.on} onChange={(e) => edit({ ...draft, on: e.target.checked })} disabled={readOnly || saving} className="mt-0.5" />
            <span className="text-sm" style={{ color: '#fff' }}>
              Turn on Refer a friend
            </span>
          </label>

          {noCodes ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
                You have no promo codes yet. Add a discount with a promo code under Discounts on the Memberships page, then pick
                it here.
              </p>
              {membershipsTo !== null ? (
                <PlaceLink to={membershipsTo} guard={changed} className="c-lk text-sm self-start">
                  Open Memberships
                </PlaceLink>
              ) : null}
            </div>
          ) : null}

          <GiftPicker
            label="Gift for the member who invites"
            hint="Sent to their inbox when their friend joins and makes their first payment."
            value={draft.memberDiscountId}
            settings={settings}
            disabled={readOnly || saving}
            onChange={(id) => edit({ ...draft, memberDiscountId: id })}
          />
          <GiftPicker
            label="Gift for the friend"
            hint="Shown on the invite page, for them to use when they join."
            value={draft.friendDiscountId}
            settings={settings}
            disabled={readOnly || saving}
            onChange={(id) => edit({ ...draft, friendDiscountId: id })}
          />
          {!noCodes && membershipsTo !== null ? (
            <PlaceLink to={membershipsTo} guard={changed} className="c-lk text-sm self-start">
              Add or change a promo code
            </PlaceLink>
          ) : null}
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Anyone who knows a promo code can use it at the desk, so pick codes you don&apos;t advertise elsewhere.
          </p>

          <Preview title="What your members read" lines={memberPreview(draft, settings, org.name)} />
          <Preview title="What their friend reads" lines={friendPreview(draft, settings, org.name)} />

          {problem !== null && changed ? (
            <p className="text-sm" style={{ color: '#ef4444' }}>
              {problem}
            </p>
          ) : null}
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
            {saved ? (
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }} role="status">
                {settings.on ? 'Saved. Refer a friend is on.' : 'Saved. Refer a friend is off.'}
              </span>
            ) : null}
          </div>
        </form>
      )}
    </ConsoleSection>
  );
}
