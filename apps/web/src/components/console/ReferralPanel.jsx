import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import { viewerPrivileges } from '../../pages/console/consoleView';
import { placeFor } from '../../pages/console/consolePlaces';
import PlaceLink from './PlaceLink';
import {
  GIFT_ON_CHOICES,
  friendPreview,
  giftCodeLine,
  giftProblem,
  memberPreview,
  referralBody,
  referralChanged,
  referralDraft,
  referralProblem,
  referralSummary,
} from '../../pages/console/referralView';
import { ConsoleFailed, ConsoleLoading, ConsoleSection } from './ConsoleStates';

// REFER A FRIEND (ROADMAP 20e-ii-a; spec Part 3 §16.3): the owner switches it on and sets
// each gift right here, for the member who invites and for the friend, or either alone. The
// app makes each gift's promo code when it is saved, kept under Discounts like any other.
// Below, exactly what a member and a friend will read. Everything waits for Save together.

const inputStyle = {
  background: '#0A0908',
  border: '1px solid rgba(255,255,255,0.10)',
  color: '#fff',
};
const labelStyle = { color: 'rgba(255,255,255,0.75)' };
const hintStyle = { color: 'rgba(255,255,255,0.45)' };

function GiftBox({ title, hint, gift, currency, codeLine, discountsTo, guard, disabled, onChange }) {
  const set = (change) => onChange({ ...gift, ...change });
  const problem = giftProblem(gift, currency);
  return (
    <fieldset className="flex flex-col gap-2" aria-label={title}>
      <legend className="text-sm font-medium" style={labelStyle}>
        {title}
      </legend>
      <span className="block text-xs" style={hintStyle}>
        {hint}
      </span>
      <div className="grid gap-2 sm:grid-cols-[1fr_120px_1.6fr]">
        <select value={gift.give} onChange={(e) => set({ give: e.target.value })} disabled={disabled} aria-label={`${title}: what they get`} className="rounded-xl px-4 py-3 text-base sm:text-sm" style={inputStyle}>
          <option value="none">No gift</option>
          <option value="percent">A percentage off</option>
          <option value="amount">{currency === null ? 'An amount off' : `An amount off (${currency})`}</option>
        </select>
        {gift.give === 'none' ? null : (
          <input
            value={gift.value}
            onChange={(e) => set({ value: e.target.value })}
            disabled={disabled}
            inputMode="decimal"
            aria-label={gift.give === 'percent' ? `${title}: percentage` : `${title}: amount`}
            placeholder={gift.give === 'percent' ? '10' : '500'}
            className="rounded-xl px-4 py-3 text-base sm:text-sm"
            style={inputStyle}
          />
        )}
        {gift.give === 'none' ? null : (
          <select value={gift.on} onChange={(e) => set({ on: e.target.value })} disabled={disabled} aria-label={`${title}: off`} className="rounded-xl px-4 py-3 text-base sm:text-sm" style={inputStyle}>
            {GIFT_ON_CHOICES.map((c) => (
              <option key={c.key} value={c.key}>
                off {c.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {problem !== null && gift.value !== '' ? (
        <span className="block text-xs" style={{ color: '#ef4444' }}>
          {problem}
        </span>
      ) : null}
      {codeLine !== null ? (
        <span className="block text-xs" style={hintStyle}>
          {codeLine}
        </span>
      ) : null}
      {codeLine !== null && discountsTo !== null ? (
        <PlaceLink to={discountsTo} guard={guard} className="c-lk text-xs self-start">
          See it in Discounts
        </PlaceLink>
      ) : null}
    </fieldset>
  );
}

function Preview({ title, lines }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <p className="text-xs font-semibold uppercase tracking-wide" style={hintStyle}>
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
  const privileges = viewerPrivileges(org);
  const countryTo = placeFor(org.slug, privileges, 'country');
  // A saved gift's discount is listed with the others: on Sell for products, on
  // Memberships for a membership.
  const discountsTo = (side) => placeFor(org.slug, privileges, settings?.[side]?.on === 'products' ? 'sell' : 'membershipDiscounts');

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
      const res = await orgService.saveReferralSettings(gymId, referralBody(draft, settings));
      setSettings(res.data.settings);
      setDraft(referralDraft(res.data.settings));
      setSaved(true);
    } catch (err) {
      setSaveError(errorText(err, "We couldn't save that. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConsoleSection title="Refer a friend" summary={referralSummary(settings)} forceOpen={loadError !== null} defaultOpen={startOpen}>
      {readOnly ? (
        <p className="text-xs mb-3" style={hintStyle}>
          {readOnlyNote(org.orgType)}
        </p>
      ) : null}
      {loadError !== null ? (
        <ConsoleFailed message={loadError} onRetry={retry} />
      ) : settings === null || draft === null ? (
        <ConsoleLoading label="Loading…" />
      ) : (
        <form onSubmit={save} className="flex flex-col gap-5">
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Your members share their own invite link from the app. A friend who opens it can send you their details, and
            they arrive on Leads marked with who invited them. Choose a thank-you gift for the member, a welcome gift for the
            friend, or both.
          </p>

          <label className={`flex items-start gap-3 ${readOnly ? '' : 'cursor-pointer'}`}>
            <input type="checkbox" checked={draft.on} onChange={(e) => edit({ ...draft, on: e.target.checked })} disabled={readOnly || saving} className="mt-0.5" />
            <span className="text-sm" style={{ color: '#fff' }}>
              Turn on Refer a friend
            </span>
          </label>

          <GiftBox
            title="Gift for the member who invites"
            hint="Sent to their inbox when their friend joins and makes their first payment."
            gift={draft.member}
            currency={settings.currency}
            codeLine={giftCodeLine(settings, 'member')}
            discountsTo={discountsTo('member')}
            guard={changed}
            disabled={readOnly || saving}
            onChange={(member) => edit({ ...draft, member })}
          />
          <GiftBox
            title="Gift for the friend"
            hint="Shown on the invite page, for them to use when they join."
            gift={draft.friend}
            currency={settings.currency}
            codeLine={giftCodeLine(settings, 'friend')}
            discountsTo={discountsTo('friend')}
            guard={changed}
            disabled={readOnly || saving}
            onChange={(friend) => edit({ ...draft, friend })}
          />
          {settings.currency === null && countryTo !== null && (draft.member.give === 'amount' || draft.friend.give === 'amount') ? (
            // The country is higher up this same page, so nothing typed here is lost.
            <PlaceLink to={countryTo} className="c-lk text-sm self-start">
              Set your country
            </PlaceLink>
          ) : null}

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
