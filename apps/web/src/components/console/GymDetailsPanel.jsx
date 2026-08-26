import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Select from '../common/Select';
import { ConsoleFailed, ConsoleSection } from './ConsoleStates';
import { countryOptions, detectTimezone } from '../../pages/console/consoleView';
import {
  canManageOrg,
  gymDetailsDraft,
  gymDetailsPatch,
  gymDetailsProblem,
  sameGymDetails,
  timezoneChoices,
} from '../../pages/console/gymDetailsView';
import { refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import { orgService, errorText } from '../../api/orgsApi';

// A GYM CAN FINALLY FIX ITS OWN DETAILS — the web half of `PATCH /v1/orgs/:gymId`.
//
// Until the server half landed on 2026-08-26 the gym row was insert-only after
// creation: nineteen routes in the module and not one of them a PATCH. A typo in
// the name was on every screen an owner shows a member, for ever; a gym set up
// in the wrong time zone had its day boundaries wrong for ever. The route has
// existed since that morning with NO CALLER, which is why `OWED.md`'s line stayed
// open — an endpoint nobody can reach ticks nothing (:13803, :14262).
//
// IT READS NOTHING OF ITS OWN. The gym row is already in the console's one kept
// answer to "which gyms do I run, and what may I do there?", so this panel takes
// it as a prop. A second read here would be a second answer that can disagree
// with the shell's, and the Staff panel next door reads only what has no other
// source.
//
// WHO SEES IT: whoever holds `org.manage`. That is the owner by default and, if
// an owner ticks it across, a manager too — so this asks for the POWER and never
// for the job title (:16095's Critical/High, where the console gated on the role
// name while the server gated on the tick).

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

export default function GymDetailsPanel({ org, privileges }) {
  const allowed = canManageOrg(privileges);

  // Computed once. `countryOptions` walks the shared supported list through
  // `Intl`; `timezoneChoices` walks ~400 zones. Neither depends on anything that
  // changes while the form is open — and the gym's own zone is taken from the
  // row this panel was FIRST given, which is the value the boxes are showing.
  const countries = useMemo(() => countryOptions(), []);
  const detected = useMemo(() => detectTimezone(), []);

  // THE DRAFT FOLLOWS THE GYM WHILE NOBODY HAS TOUCHED IT, AND ONLY THEN —
  // T3 round 1, C/H-1.
  //
  // It used to be seeded once and never look at the prop again, on the reasoning
  // (still right, still here) that the kept answer is re-read on every window
  // focus and must never replace what somebody is halfway through typing. What
  // that missed is that it applied to a form NOBODY HAD TOUCHED: a rename made
  // in a second tab left these boxes holding the old name and time zone under a
  // heading two lines up showing the new one, switched Save on with no
  // keystroke, and offered to put the stale values back. `gyms.timezone` is the
  // only thing the rollup worker consults, so that revert moves the gym's day —
  // the one permanent thing this screen is meant to be incapable of.
  //
  // **IT REACTS TO THE GYM ROW CHANGING, NOT TO THE DRAFT DIFFERING FROM IT, and
  // the first version of this fix got that wrong.** Comparing the draft against
  // the CURRENT row looks equivalent and is not: for a moment after a save the
  // prop is BEHIND the truth (the quiet re-read has not landed), so that rule
  // dragged the freshly-saved values back to the pre-save ones — and if the
  // re-read then failed, rule 2 of the store keeps the old answer and the boxes
  // would have shown the pre-save row FOR EVER over a save that landed. Caught
  // by this card's own "does not blank the screen" test, which holds that
  // re-read open on purpose.
  //
  // So `lastOrgSeen` is the row the PROP last held, "untouched" is the draft
  // still matching it, and a save moves only the draft — leaving `lastOrgSeen`
  // where it is, so the re-read arriving with our own change is correctly read
  // as "the prop caught up" rather than as somebody else's edit.
  const [lastOrgSeen, setLastOrgSeen] = useState(() => gymDetailsDraft(org));
  const [draft, setDraft] = useState(lastOrgSeen);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  // Adjusting state while rendering — React's own pattern for "a prop moved and
  // some state derived from it should move too". No effect, so there is no frame
  // in which the boxes and the heading above them disagree.
  const fresh = gymDetailsDraft(org);
  if (!sameGymDetails(fresh, lastOrgSeen)) {
    const untouched = sameGymDetails(draft, lastOrgSeen);
    setLastOrgSeen(fresh);
    if (untouched) {
      setDraft(fresh);
      // T3 round 2, Low-1. Replacing the boxes and leaving "Saved." standing is
      // a confirmation about bytes that are no longer on screen — the rule
      // `edit` states below, reached through the door round 1's fix opened. A
      // refusal left over from a save is cleared for the same reason: it would
      // read as a refusal of values the owner never sent.
      setSaved(false);
      setError(null);
    }
  }

  // THE LIST MUST HOLD BOTH THE ZONE THE GYM HOLDS AND THE ZONE THE BOX IS
  // SHOWING — T3 round 2's Critical/High, and round 1's own fix is what caused
  // it.
  //
  // It was anchored to the zone the screen OPENED with, which meant following a
  // change into a zone this runtime spells differently left the select with no
  // matching option (C56 one step late). Round 1 re-anchored it to the DISPLAYED
  // zone, which fixed that and **made the displayed zone the only thing it
  // follows — so the moment an owner selected anything else, the zone their gym
  // actually holds left the list and there was no way to put it back** without
  // leaving the screen. Measured on this machine: 418 zones enumerated,
  // `Asia/Calcutta` present and `Asia/Kolkata` absent, and the same for
  // Kiev/Kyiv, Rangoon/Yangon, Godthab/Nuuk.
  //
  // Both are wanted, so both are asked for. `org.timezone` rather than
  // `lastOrgSeen.timezone`: this is about what the SERVER holds right now, not
  // about what the form has reacted to.
  const zones = useMemo(
    () => timezoneChoices(detected, draft.timezone, org?.timezone),
    [detected, draft.timezone, org?.timezone],
  );

  if (!allowed) return null;

  /** Every keystroke clears the last answer. A "Saved" line sitting over a form
   *  somebody has since edited is a claim about bytes that are no longer on
   *  screen, and a refusal left standing beside a corrected field reads as the
   *  correction being refused too. */
  const edit = (field, value) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
    setError(null);
  };

  const patch = gymDetailsPatch(draft, org);
  /** DERIVED, NOT STORED, AND THE FIRST VERSION OF THIS SCREEN GOT IT WRONG.
   *
   *  It was set on submit — which is unreachable for the case it exists for. An
   *  emptied name produces NO patch (there is nothing to send about a name that
   *  was cleared), so Save was disabled, the click did nothing, and an owner
   *  looking at an empty box and a dead button was told nothing at all. Caught by
   *  the test written for it, which is the only reason it is not in the smoke.
   *
   *  Derived, the sentence appears the moment the box is emptied and no click is
   *  needed to earn it. */
  const problem = gymDetailsProblem(draft);
  const canSave = patch !== null && problem === null && !saving;
  // A STRING, not "not null": the sentence below claims the country is missing,
  // and a missing FIELD (an api older than this build) is the same situation as
  // a null one — we do not have it. Anything else would print that claim over a
  // country the gym does hold.
  const countryOnRecord = typeof org?.country === 'string' && org.country.trim() !== '';

  const save = async (e) => {
    e.preventDefault();
    // A SECOND DOOR, and it is not decoration: the Save button is disabled in
    // both these states, but a form submits on Enter too and browsers differ on
    // whether a disabled default button stops that. The bounds mirrored in
    // `gymDetailsProblem` are the ones the server answers with a raw
    // `name: too_small`, which `errorText` would print at a gym owner verbatim.
    // `saving` is in here for T3 round 1's Low-2: the button is disabled while a
    // save is in flight, but ENTER submits a form without going through the
    // button, so two quick presses sent two requests for one act. Harmless
    // (PATCH, idempotent, and a no-op writes no audit row) and still two.
    if (problem !== null || patch === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await orgService.updateOrg(org.id, patch);
      // THE SERVER'S OWN ROW GOES BACK INTO THE BOXES, never the draft. It is
      // the one that has been normalised — a country typed in any case comes
      // back upper-cased — and it is what makes Save go quiet afterwards: the
      // draft and the row now agree, so the diff is empty.
      //
      // **ONLY THE DRAFT MOVES.** `lastOrgSeen` deliberately stays where it is:
      // it tracks the PROP, the prop has not changed yet, and the quiet re-read
      // that follows will bring it level. Moving it here is what made the first
      // version of this fix revert the boxes to the pre-save row.
      setDraft(gymDetailsDraft(res.data?.org));
      setSaved(true);
      // AND THE REST OF THE CONSOLE FOLLOWS. The shell's gym name, "Your gyms"
      // and the Overview header all read the same kept answer, and without this
      // a renamed gym keeps its old name everywhere until the next window focus.
      // Quiet on purpose: a foreground refresh publishes `loading` and would
      // blank this very screen, taking the Staff section down with it.
      refreshConsoleOrgsAfterChange();
    } catch (err) {
      // The server's own sentence, verbatim, and the two that matter here are
      // both written for this reader: "We're not open in that country yet…" and
      // the currency lock's "The currency your gym is billed in can't change
      // while your gym has a subscription…". Re-wording either here is how the
      // screen and the door come to say different things.
      //
      // NO "Try again" BUTTON: the Save button IS the retry, it is still on
      // screen, and everything the owner typed is still in the boxes. A second
      // control offering to redo the same request would be two buttons for one
      // act — and for the currency lock it would promise something that cannot
      // work however many times it is pressed.
      setError(errorText(err, "We couldn't save your gym's details. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    /* CLOSED BY DEFAULT (Kd, 2026-08-26). No `forceOpen` here and that is not an
       oversight: this panel fetches NOTHING — every value comes from the org row
       the console already holds — so it has no failure that can arrive while
       nobody is looking. Its two error states are both consequences of a SAVE,
       which can only happen with the section open. `StaffPanel` is the opposite
       case and passes the flag. */
    <ConsoleSection
      title="Gym details"
      summary="Your gym's name, where it is, and the time zone its day ends on."
    >
      <form onSubmit={save} className="flex flex-col gap-5">
        <Field label="Gym name">
          <input
            type="text"
            value={draft.name}
            onChange={(e) => edit('name', e.target.value)}
            maxLength={120}
            aria-label="Gym name"
            className="w-full rounded-xl px-4 py-3 text-sm"
            style={inputStyle}
          />
        </Field>

        <Field label="City" hint="Optional">
          <input
            type="text"
            value={draft.city}
            onChange={(e) => edit('city', e.target.value)}
            maxLength={120}
            placeholder="Austin"
            aria-label="City"
            className="w-full rounded-xl px-4 py-3 text-sm"
            style={inputStyle}
          />
        </Field>

        <Field label="Country" hint="This decides the currency your gym is billed in.">
          <Select
            value={draft.country}
            onChange={(value) => edit('country', value)}
            options={countries}
            ariaLabel="Country"
            placeholder="Choose a country"
            style={inputStyle}
          />
          {/* WHAT THE GYM IS BILLED IN, ALWAYS — it is the fact that actually
              decides money, the server derives it and every row has one, so it
              is correct even on a gym whose country was never stored. */}
          <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Your gym is billed in {org.currencyDisplay}. We work that out from your country — you
            can&apos;t set it here.
          </p>
          {countryOnRecord ? null : (
            /* TRUE, AND NOT A DEFECT. Gyms created before the country column
               existed have none: the create wizard asked, the server turned the
               answer into a currency and did not keep it. Saying so beats an
               empty box that reads as something failing to load — and the fix is
               one save away, which the sentence names. */
            <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
              We don&apos;t have your country on record — this gym was set up before we started
              keeping it. Choose it here and we&apos;ll remember it.
            </p>
          )}
        </Field>

        <Field label="Time zone" hint="Your gym's daily figures use this.">
          {zones.length > 0 ? (
            // A native select for ~400 options: the OS picker scrolls and
            // type-ahead searches, which the app's own dropdown does not. The
            // same call the create wizard makes, for the same reason.
            <select
              value={draft.timezone}
              onChange={(e) => edit('timezone', e.target.value)}
              aria-label="Time zone"
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
            // being handed a list that does not contain the gym's own — the
            // server proves whatever is typed names a real zone and refuses it
            // otherwise.
            <input
              type="text"
              value={draft.timezone}
              onChange={(e) => edit('timezone', e.target.value)}
              placeholder="America/Chicago"
              aria-label="Time zone"
              className="w-full rounded-xl px-4 py-3 text-sm"
              style={inputStyle}
            />
          )}
        </Field>

        {problem !== null ? (
          <p className="text-sm" style={{ color: '#ef4444' }}>
            {problem}
          </p>
        ) : null}

        {error !== null ? <ConsoleFailed message={error} /> : null}

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
            <span className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Saved.
            </span>
          ) : null}
        </div>
      </form>
    </ConsoleSection>
  );
}
