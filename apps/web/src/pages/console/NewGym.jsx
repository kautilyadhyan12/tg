import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { normaliseIndianMobile } from '@app/shared';
import Select from '../../components/common/Select';
import { ConsoleCard, ConsoleFailed } from '../../components/console/ConsoleStates';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import { refreshConsoleOrgs } from './consoleOrgs';
import { useConsoleSignOut } from './consoleSignOut';
import { useConsoleOrgs } from './useConsoleOrg';
import {
  ORG_TYPE_CHOICES,
  countryOptions,
  detectTimezone,
  orgWords,
  timezoneOptions,
  trainsHereChoices,
} from './consoleView';

// Part 3 §4.0's onboarding wizard, reduced to the steps that have a server
// behind them — and the reduction is stated rather than quietly performed.
//
// "Create your organisation": the type is one of the five kinds of business
// (Kd, 2026-10-16), and the words on the screen follow it (`orgWords`). The
// file keeps its name; the route is still `/console/new`.
//
// BUILT:   step 1 (org type · name · city · country · timezone). Create opens the
//          new gym's Overview (Kd, 2026-10-16, ROADMAP 5f): its plan prompt and
//          "Start here" are what came after.
// NOT BUILT, each with its own owed line: step 2 (size, seat tier, 7-day
//          trial), step 3 (logo upload), step 5 (invite your team), and step
//          4's QR poster PDF. None of them has an endpoint — there is no
//          billing, no upload target and no staff route in the API today. A
//          step drawn over nothing would be a button that cannot work.
//
// `country` is an ADDITION to §4.0's field list, authorised by Kd's currency
// ruling: the server derives the gym's currency from it and REFUSES a country
// we have no prices for, rather than quoting somebody else's money.

const inputStyle = {
  background: '#0A0908',
  border: '1px solid rgba(255,255,255,0.10)',
  color: '#fff',
};

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
        {label}
      </span>
      {hint ? (
        <span className="block text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
          {hint}
        </span>
      ) : null}
      <div className="mt-2">{children}</div>
    </label>
  );
}

export default function NewGym() {
  const navigate = useNavigate();

  // Computed once: `countryOptions` walks the shared list through Intl, and
  // `timezoneOptions` walks ~400 zones. Neither depends on anything that
  // changes while this form is open.
  const countries = useMemo(() => countryOptions(), []);
  const detected = useMemo(() => detectTimezone(), []);
  const zones = useMemo(() => timezoneOptions(detected), [detected]);

  const [name, setName] = useState('');
  // One key for this form: pressing Create again after an answer that never arrived gets the
  // gym the first press made, not a second one.
  const [createKey] = useState(() => crypto.randomUUID());
  const [city, setCity] = useState('');
  const [orgType, setOrgType] = useState('gym');
  // T3 C/H-1 — NO PRESELECTED COUNTRY, and this is the whole ruling in one line.
  // It used to default to `'US'`. The field decides `currency_display`, the
  // server writes it once at creation, and there is no settings route to change
  // it — so an owner outside the US who typed a name and pressed Create got a gym
  // billed in US dollars, permanently, and was then told "set up in USD".
  // Kd's currency ruling refuses an unsupported country rather than giving it a
  // fallback (*"a fallback currency is how a gym in Sydney gets quoted in
  // rupees"*), and it rejected deriving the country from the TIMEZONE because
  // "most of the time" is a guess. A hardcoded `US` is a guess with a worse hit
  // rate than the one that was already rejected. Empty, and `canSubmit` below
  // holds the button until a person chooses.
  const [country, setCountry] = useState('');
  // An Indian gym's owner's mobile, for its payments only (ROADMAP 1d-i; Kd, RULINGS
  // 2026-09-29): Razorpay's window is given it, so it asks nothing.
  const [mobile, setMobile] = useState('');
  // Prefilled from the device (§4.0 step 1) — and `timezoneOptions` guarantees
  // whatever it detected is in the list, so the prefill cannot be silently
  // replaced by the first alphabetical zone.
  const [timezone, setTimezone] = useState(detected ?? '');
  // "Do you train here too?" (spec Part 3 §10.4): null until answered, never guessed.
  // Yes gives the owner the member app on one of the places; no, the console only.
  const [trainsHere, setTrainsHere] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  // A throwaway address cannot open a gym (2b): the way on is another address.
  const [throwaway, setThrowaway] = useState(false);
  // Ten gyms with no paid plan (2g): the way on is a plan for one of them, from Your organisations.
  const [atUnpaidLimit, setAtUnpaidLimit] = useState(false);
  // DOES THIS PERSON RUN ANYTHING YET? A new owner from the "Manage" door is
  // sent here by `ConsoleHome` because they run nothing (Kd 2026-09-07), and a
  // Cancel link back to that screen would bounce them straight back here. So
  // Cancel is offered only to somebody who has a list to return to; a first-time
  // owner has the shell's Sign out. Unknown (store not read yet) counts as no
  // list, the direction that cannot draw a link onto a loop.
  // `useConsoleOrgs` reads the store ON MOUNT (a person can open `/console/new`
  // directly, before the front door ever asked), so the answer arrives here too.
  const mine = useConsoleOrgs();
  const runsSomething = !mine.loading && mine.error === null && mine.orgs.length > 0;

  const { signingOut, signOut } = useConsoleSignOut();
  const words = orgWords(orgType);

  const inIndia = country === 'IN';
  const mobileOk = !inIndia || normaliseIndianMobile(mobile) !== null;
  const canSubmit =
    name.trim() !== '' && country !== '' && timezone.trim() !== '' && mobileOk && trainsHere !== null && !submitting;
  const trainChoices = trainsHereChoices(orgType);

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setThrowaway(false);
    try {
      // The body is `.strict()` server-side, so only the wizard's own fields go
      // up. `currencyDisplay` is deliberately absent — a gym that could declare
      // its own currency is a gym that can be billed in the wrong money.
      const res = await orgService.createOrg({
        name: name.trim(),
        city: city.trim() === '' ? null : city.trim(),
        orgType,
        country,
        timezone: timezone.trim(),
        ...(inIndia ? { billingMobile: mobile } : {}),
        trainsHere,
        createKey,
      });
      // THE CONSOLE HAS TO BE TOLD, AND THIS IS THE ONLY PLACE THAT CAN TELL IT
      // (T3 C/H-1). Every console screen reads one kept answer to "which gyms do
      // I run?", re-checked when the window comes BACK — and making a gym happens
      // inside that window, so nothing else here fires. Without this line the
      // button below lands on "we couldn't find a gym you run at this address",
      // and "Your gyms" tells somebody who has just made their first gym that
      // they don't run one.
      //
      // Not awaited: if the read has not landed, the gym's console shows its own
      // spinner and then the gym, which is the truth rather than a denial.
      refreshConsoleOrgs();
      navigate(`/console/${res.data.org.slug}`);
    } catch (err) {
      // The server's own sentence, verbatim: "We're not open in that country
      // yet…" is authored for this reader and is more use than anything a
      // client-side rewrite would produce.
      setError(errorText(err, `We couldn't create your ${words.it}. Please try again.`));
      setThrowaway(errorCode(err) === 'email_throwaway');
      setAtUnpaidLimit(errorCode(err) === 'unpaid_gym_limit');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step 1 ──────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 md:px-8 py-8">
      <h1 className="text-2xl font-bold mb-1" style={{ color: '#fff' }}>
        Create your organisation
      </h1>
      <p className="text-sm mb-6" style={{ color: 'rgba(255,255,255,0.45)' }}>
        Then you can bring your {words.people} in: import your list, or add people one at a time.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-5">
        <ConsoleCard className="flex flex-col gap-5">
          {/* THE TYPE COMES FIRST because every label below it follows the
              answer — a trainer is not asked for a "gym name". */}
          <div>
            <span className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
              What is it?
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
              {ORG_TYPE_CHOICES.map((choice) => {
                const active = orgType === choice.value;
                return (
                  <button
                    key={choice.value}
                    type="button"
                    onClick={() => setOrgType(choice.value)}
                    aria-pressed={active}
                    className="rounded-xl p-4 text-left"
                    style={{
                      background: active ? 'rgba(255,138,31,0.12)' : '#0A0908',
                      border: active
                        ? '1px solid rgba(255,138,31,0.45)'
                        : '1px solid rgba(255,255,255,0.10)',
                    }}
                  >
                    <div className="text-sm font-semibold" style={{ color: active ? '#FF8A1F' : '#fff' }}>
                      {choice.label}
                    </div>
                    <div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
                      {choice.hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <Field label={words.nameLabel}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder={words.placeholder}
              aria-label={words.nameLabel}
              className="w-full rounded-xl px-4 py-3 text-sm"
              style={inputStyle}
            />
          </Field>

          <Field label="City" hint="Optional">
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              maxLength={120}
              placeholder="Austin"
              aria-label="City"
              className="w-full rounded-xl px-4 py-3 text-sm"
              style={inputStyle}
            />
          </Field>

          <Field label="Country" hint="This decides the currency you are billed in.">
            <Select
              value={country}
              onChange={setCountry}
              options={countries}
              ariaLabel="Country"
              placeholder="Choose a country"
              style={inputStyle}
            />
          </Field>

          {inIndia ? (
            <Field label="Mobile number for payments" hint="Yours, as the owner: Razorpay uses it for messages about your payments. Only people who manage billing here can see it.">
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                maxLength={40}
                placeholder="98765 43210"
                aria-label="Mobile number for payments"
                className="w-full rounded-xl px-4 py-3 text-sm"
                style={inputStyle}
              />
              {mobile.trim() !== '' && !mobileOk ? (
                <span className="block text-xs mt-1.5" style={{ color: '#FF8A1F' }} data-testid="mobile-check">
                  This isn&apos;t a mobile number. Type your 10-digit mobile number, for example 98765 43210.
                </span>
              ) : null}
            </Field>
          ) : null}

          <Field label="Timezone" hint="Your daily figures use this.">
            {zones.length > 0 ? (
              // A native select for ~400 options: the OS picker scrolls and
              // type-ahead searches, which the app's own dropdown does not, and
              // on a phone it is the right control. `Select.jsx` is used for the
              // 24-item country list, where its styling wins.
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                aria-label="Timezone"
                className="w-full rounded-xl px-4 py-3 text-sm"
                style={{ ...inputStyle, colorScheme: 'dark' }}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            ) : (
              // This browser cannot enumerate zones. Typing one is better than
              // being handed a default — the server proves it names a real zone
              // and refuses it otherwise.
              <input
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="America/Chicago"
                aria-label="Timezone"
                className="w-full rounded-xl px-4 py-3 text-sm"
                style={inputStyle}
              />
            )}
          </Field>

          <div role="radiogroup" aria-label={trainChoices.question}>
            <span className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {trainChoices.question}
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
              {trainChoices.options.map((choice) => {
                const active = trainsHere === choice.value;
                return (
                  <button
                    key={String(choice.value)}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTrainsHere(choice.value)}
                    className="rounded-xl p-4 text-left"
                    style={{
                      background: active ? 'rgba(255,138,31,0.12)' : '#0A0908',
                      border: active ? '1px solid rgba(255,138,31,0.45)' : '1px solid rgba(255,255,255,0.10)',
                    }}
                  >
                    <div className="text-sm font-semibold" style={{ color: active ? '#FF8A1F' : '#fff' }}>
                      {choice.label}
                    </div>
                    <div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
                      {choice.hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </ConsoleCard>

        {error !== null ? <ConsoleFailed message={error} /> : null}
        {throwaway ? (
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="self-start rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
          >
            {signingOut ? 'Signing out…' : 'Sign in with another email'}
          </button>
        ) : null}
        {atUnpaidLimit ? (
          <Link
            to="/console"
            className="self-start rounded-xl px-4 py-2 text-sm font-medium"
            style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
          >
            Your organisations
          </Link>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-xl px-5 py-3 text-sm font-semibold flex items-center gap-2"
            style={{
              background: canSubmit ? 'linear-gradient(135deg,#FF8A1F,#FFB347)' : 'rgba(255,255,255,0.08)',
              color: canSubmit ? '#0A0908' : 'rgba(255,255,255,0.35)',
            }}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {submitting ? 'Creating…' : 'Create'}
          </button>
          {runsSomething ? (
            <Link to="/console" className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Cancel
            </Link>
          ) : null}
        </div>
      </form>
    </div>
  );
}
