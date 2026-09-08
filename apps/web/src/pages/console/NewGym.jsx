import { useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Select from '../../components/common/Select';
import JoinCodeCard from '../../components/console/JoinCodeCard';
import PlanModal from '../../components/console/PlanModal';
import { ConsoleCard, ConsoleFailed } from '../../components/console/ConsoleStates';
import { orgService, errorText } from '../../api/orgsApi';
import { consoleOrgsSnapshot, refreshConsoleOrgs, subscribeConsoleOrgs } from './consoleOrgs';
import { useConsoleSignOut } from './consoleSignOut';
import { useConsoleOrgs } from './useConsoleOrg';
import {
  ORG_TYPE_CHOICES,
  countryOptions,
  detectTimezone,
  orgWords,
  timezoneOptions,
} from './consoleView';

// Part 3 §4.0's onboarding wizard, reduced to the steps that have a server
// behind them — and the reduction is stated rather than quietly performed.
//
// "Create your organisation" (Kd 2026-09-07): the type is gym, studio or
// personal trainer, and the words on the screen follow it (`orgWords`). The
// file keeps its name; the route is still `/console/new`.
//
// BUILT:   step 1 (org type · name · city · country · timezone) and step 4's
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

/** WHAT COVERS THE NEW GYM'S CODE UNTIL THE CONSOLE KNOWS WHAT THE GYM IS ON.
 *
 *  It says one true thing and offers nothing, because there is nothing honest to
 *  offer yet: the gym exists, and whether its owner may start a trial is a fact
 *  this screen has asked for and not yet been told. **It claims no outcome** —
 *  no "starting your trial", no "loading your plan" — since a failed read leaves
 *  it here indefinitely and a promise would then be false rather than merely
 *  slow.
 *
 *  Same shape and stacking as the prompt it stands in for, so a person sees one
 *  behaviour: the screen behind is covered, and nothing about the gym is
 *  actionable until the app can say something true about it. */
function SettingUpCover() {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,9,8,0.94)' }}
      data-testid="gym-setup-cover"
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 flex items-center gap-3"
        style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'rgba(255,255,255,0.45)' }} />
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
          Setting things up…
        </p>
      </div>
    </div>
  );
}

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

  /** THE BRAND-NEW GYM AS THE SERVER DESCRIBES IT, for the unskippable prompt
   *  that now covers the code screen.
   *
   *  **The create response is deliberately NOT used for this.** It carries the
   *  org and the join code and nothing else — no `ownerTrialUsed`, no
   *  privileges — and a prompt that cannot be closed must never be drawn on a
   *  field that was never sent (the shared schema says so in as many words). So
   *  it is read from the kept answer `refreshConsoleOrgs()` fetches on the line
   *  after the gym is made, by id. Before that read lands there is no row and
   *  the prompt draws nothing, which is the same safe direction. */
  const snapshot = useSyncExternalStore(subscribeConsoleOrgs, consoleOrgsSnapshot);
  const createdOrg =
    created === null || snapshot.status !== 'ready'
      ? null
      : (snapshot.orgs ?? []).find((o) => o?.id === created.org.id) ?? null;

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
      setError(errorText(err, `We couldn't create your ${words.it}. Please try again.`));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step 4/6: the gym exists, here is its code ──────────────────────────
  if (created !== null) {
    return (
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-5">
        {/* THE PROMPT COVERS THIS SCREEN, AND KD FOUND THE DEFECT THAT MADE IT
            NECESSARY — 2026-08-28, at the smoke: *"i cretaed gym but this one
            shows then i click only after that pop shows this is wrong wtf"*.

            **He is right, and it is his ruling rather than a preference.**
            :22215 puts the prompt at the moment a gym is CREATED, and this
            screen is that moment — it was handing out the JOIN CODE, under
            "Give this code to your members", for a gym on no plan. That is the
            exact state the ruling exists to remove, and the prompt arriving one
            click LATER made the wrong thing the first thing a new owner sees.

            **NOTHING IS REMOVED — the code screen stays and is simply behind
            the prompt**, which is the honest order: start the trial, then hand
            out the code. It reveals itself the moment the trial starts, because
            the gym then has a plan and `planPromptFor` stops asking for one.

            IT IS DRAWN HERE RATHER THAN BY THE SHELL because `/console/new` has
            no gym in its address, so `ConsoleLayout`'s copy resolves no org and
            correctly draws nothing there. This one is handed the gym that was
            just created — read from the SHARED STORE by id, never from the
            create response, because that response carries no `ownerTrialUsed`
            and a prompt that cannot be closed must never be drawn on a guess.

            **AND UNTIL THAT ROW ARRIVES THE SCREEN IS COVERED ANYWAY — T3 round
            1, Low-4, which is Kd's own defect in miniature.** `refreshConsoleOrgs()`
            publishes `loading`, so `createdOrg` is null for the whole round trip
            and stays null for ever if that read FAILS — and this screen was
            drawing the join code, with its live Copy button, in exactly that
            window. Seconds on a slow connection, permanently on a dropped one.
            **The silence is right for `ownerTrialUsed` and wrong for the COVER:
            a gym created one second ago demonstrably has no plan**, so nothing
            has to be known about it to justify hiding a code behind a neutral
            sentence. */}
        {createdOrg === null ? <SettingUpCover /> : null}
        <PlanModal org={createdOrg} onSignOut={signOut} signingOut={signingOut} />
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
            {created.org.name} is ready
          </h1>
          <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Your {orgWords(created.org.orgType).it} is set up in {created.org.currencyDisplay}.
          </p>
        </div>

        {/* The create response carries `{ code, label }` only; the fields that
            decide live-vs-dead are absent because a code one second old cannot
            be paused, expired or used up. Stated here rather than defaulted
            silently — these are facts about a brand-new row, not fallbacks. */}
        <JoinCodeCard
          orgType={created.org.orgType}
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
          Go to your console
        </button>
      </div>
    );
  }

  // ── Step 1 ──────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 md:px-8 py-8">
      <h1 className="text-2xl font-bold mb-1" style={{ color: '#fff' }}>
        Create your organisation
      </h1>
      <p className="text-sm mb-6" style={{ color: 'rgba(255,255,255,0.45)' }}>
        You&apos;ll get a join code to hand to your {words.people}.
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
