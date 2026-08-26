import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Select from '../../components/common/Select';
import JoinCodeCard from '../../components/console/JoinCodeCard';
import { ConsoleCard, ConsoleFailed } from '../../components/console/ConsoleStates';
import { orgService, errorText } from '../../api/orgsApi';
import { refreshConsoleOrgs } from './consoleOrgs';
import { ORG_TYPE_CHOICES, countryOptions, detectTimezone, timezoneOptions } from './consoleView';

// Part 3 §4.0's onboarding wizard, reduced to the steps that have a server
// behind them — and the reduction is stated rather than quietly performed.
//
// BUILT:   step 1 (name · city · org type · country · timezone) and step 4's
//          code reveal, which is the same transaction server-side.
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
  // Prefilled from the device (§4.0 step 1) — and `timezoneOptions` guarantees
  // whatever it detected is in the list, so the prefill cannot be silently
  // replaced by the first alphabetical zone.
  const [timezone, setTimezone] = useState(detected ?? '');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  const canSubmit = name.trim() !== '' && country !== '' && timezone.trim() !== '' && !submitting;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
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
      });
      // THE CONSOLE HAS TO BE TOLD, AND THIS IS THE ONLY PLACE THAT CAN TELL IT
      // (T3 C/H-1). Every console screen reads one kept answer to "which gyms do
      // I run?", re-checked when the window comes BACK — and making a gym happens
      // inside that window, so nothing else here fires. Without this line the
      // button below lands on "we couldn't find a gym you run at this address",
      // and "Your gyms" tells somebody who has just made their first gym that
      // they don't run one.
      //
      // Not awaited: the code reveal is what this person asked for and it should
      // not wait on a second request. The read is on its way long before they can
      // read a join code and reach for the button — and if it has not landed, the
      // gym screen shows its own spinner and then the gym, which is the truth
      // rather than a denial.
      refreshConsoleOrgs();
      setCreated(res.data);
    } catch (err) {
      // The server's own sentence, verbatim: "We're not open in that country
      // yet…" is authored for this reader and is more use than anything a
      // client-side rewrite would produce.
      setError(errorText(err, "We couldn't create your gym. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step 4/6: the gym exists, here is its code ──────────────────────────
  if (created !== null) {
    return (
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
            {created.org.name} is ready
          </h1>
          <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Your gym is set up in {created.org.currencyDisplay}.
          </p>
        </div>

        {/* The create response carries `{ code, label }` only; the fields that
            decide live-vs-dead are absent because a code one second old cannot
            be paused, expired or used up. Stated here rather than defaulted
            silently — these are facts about a brand-new row, not fallbacks. */}
        <JoinCodeCard
          code={{
            code: created.joinCode.code,
            label: created.joinCode.label,
            paused: false,
            expiresAt: null,
            maxUses: null,
            joined: 0,
          }}
        />

        <button
          type="button"
          onClick={() => navigate(`/console/${created.org.slug}`)}
          className="rounded-xl px-4 py-3 text-sm font-semibold"
          style={{ background: 'linear-gradient(135deg,#FF8A1F,#FFB347)', color: '#0A0908' }}
        >
          Go to your gym
        </button>
      </div>
    );
  }

  // ── Step 1 ──────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 md:px-8 py-8">
      <h1 className="text-2xl font-bold mb-1" style={{ color: '#fff' }}>
        Create a gym
      </h1>
      <p className="text-sm mb-6" style={{ color: 'rgba(255,255,255,0.45)' }}>
        You&apos;ll get a join code to hand to your members.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-5">
        <ConsoleCard className="flex flex-col gap-5">
          <Field label="Gym name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="Iron House"
              aria-label="Gym name"
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

          <div>
            <span className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
              What is it?
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
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

          <Field label="Country" hint="This decides the currency your gym is billed in.">
            <Select
              value={country}
              onChange={setCountry}
              options={countries}
              ariaLabel="Country"
              placeholder="Choose a country"
              style={inputStyle}
            />
          </Field>

          <Field label="Timezone" hint="Your gym's daily figures use this.">
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
        </ConsoleCard>

        {error !== null ? <ConsoleFailed message={error} /> : null}

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
            {submitting ? 'Creating…' : 'Create gym'}
          </button>
          <Link to="/console" className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
