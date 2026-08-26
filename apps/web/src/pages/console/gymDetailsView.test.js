// The gym-details form's rules, driven directly.
//
// Two of these carry the whole card. `timezoneChoices` is the only way this
// screen can do permanent damage — a picker without the gym's own zone moves the
// gym's day boundary the moment it is drawn — and `gymDetailsPatch` is what
// stops a rename putting a paying gym's currency on the table.
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  canManageOrg,
  gymDetailsDraft,
  gymDetailsPatch,
  gymDetailsProblem,
  sameGymDetails,
  timezoneChoices,
} from './gymDetailsView';

const ORG = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'iron-house',
  name: 'Iron House',
  city: 'Austin',
  country: 'US',
  orgType: 'gym',
  timezone: 'America/Chicago',
  locale: 'en',
  currencyDisplay: 'USD',
  status: 'active',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('who may edit the gym’s details', () => {
  it('asks for the POWER, not the job title', () => {
    // :16095's Critical/High: the console gated on the role name while the
    // server gated on the tick, so a power ticked ON reached no control at all.
    expect(canManageOrg(['org.manage'])).toBe(true);
    expect(canManageOrg(['members.read', 'codes.invite'])).toBe(false);
  });

  it('says no to a set it cannot read, rather than assuming', () => {
    expect(canManageOrg(undefined)).toBe(false);
    expect(canManageOrg(null)).toBe(false);
    expect(canManageOrg('org.manage')).toBe(false);
    expect(canManageOrg([])).toBe(false);
  });

  /** `staff.manage` is a DIFFERENT privilege and this is Kd's ruling, not a
   *  detail: he was offered reusing it (no migration) and took the
   *  recommendation against, on :13803's precedent. A helper that accepted
   *  either would hand every staff manager the gym's billing country. */
  it('is NOT satisfied by the power to manage staff', () => {
    expect(canManageOrg(['staff.manage'])).toBe(false);
  });
});

describe('the boxes the form opens with', () => {
  it('shows what the gym holds', () => {
    expect(gymDetailsDraft(ORG)).toEqual({
      name: 'Iron House',
      city: 'Austin',
      country: 'US',
      timezone: 'America/Chicago',
    });
  });

  /** The pre-`0014` gyms. An empty country box is TRUE for them — the wizard
   *  asked, the server turned the answer into a currency and did not keep it —
   *  and the thing that must never happen is a guessed one. */
  it('leaves an unrecorded country and a missing city EMPTY, never guessed', () => {
    const draft = gymDetailsDraft({ ...ORG, city: null, country: null });
    expect(draft.city).toBe('');
    expect(draft.country).toBe('');
    // Positive control: the fields that ARE known still come through, so an
    // implementation that blanked everything would not satisfy this.
    expect(draft.name).toBe('Iron House');
    expect(draft.timezone).toBe('America/Chicago');
  });
});

describe('has anybody typed in this form yet', () => {
  /** T3 round 1 C/H-1's instrument. The screen follows the gym row only while
   *  these four boxes still match what they were filled from — so a rename made
   *  in another tab reaches an untouched form, and never reaches one somebody is
   *  halfway through. */
  it('says yes to the same four boxes', () => {
    expect(sameGymDetails(gymDetailsDraft(ORG), gymDetailsDraft(ORG))).toBe(true);
  });

  it('notices EVERY field, not just the name', () => {
    const base = gymDetailsDraft(ORG);
    // One per box, because a comparison that checked three of four would let the
    // fourth go stale under a heading showing the new value — and the time zone
    // is the one that moves a gym's day.
    expect(sameGymDetails(base, { ...base, name: 'Other' })).toBe(false);
    expect(sameGymDetails(base, { ...base, city: 'Other' })).toBe(false);
    expect(sameGymDetails(base, { ...base, country: 'IN' })).toBe(false);
    expect(sameGymDetails(base, { ...base, timezone: 'Europe/Paris' })).toBe(false);
  });

  /** Nothing is not the same as something. Answering true here would make an
   *  unreadable row look untouched and hand it to the boxes. */
  it('says no when either side is missing', () => {
    expect(sameGymDetails(null, gymDetailsDraft(ORG))).toBe(false);
    expect(sameGymDetails(gymDetailsDraft(ORG), undefined)).toBe(false);
  });
});

describe('the time-zone list', () => {
  /** MEASURED, NOT DEFENSIVE (:10402): on the Node this repo runs,
   *  `Intl.supportedValuesOf('timeZone')` contains `Asia/Calcutta` and NOT
   *  `Asia/Kolkata`, while Chrome has been recorded reporting `Asia/Calcutta`
   *  from `resolvedOptions()`. The gym row holds whatever was stored on the day
   *  it was created, possibly by a different browser on a different machine. */
  it('contains the gym’s OWN zone even when the runtime does not list it', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['Asia/Calcutta', 'America/Chicago']);
    const zones = timezoneChoices('America/Chicago', 'Asia/Kolkata');
    expect(zones).toContain('Asia/Kolkata');
    // And the rest of the list is still there — this adds a zone, it does not
    // replace the list with one.
    expect(zones).toContain('America/Chicago');
    expect(zones).toContain('Asia/Calcutta');
  });

  /** T3 ROUND 2's Critical/High, at the helper. It used to take exactly ONE
   *  zone, and round 1's fix spent that one on the zone being displayed — so the
   *  zone the gym HOLDS left the list the moment the owner picked anything else.
   *  Both are wanted, so both are asked for. */
  it('keeps EVERY zone it is asked for, not just the last one', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['Europe/Paris']);
    const zones = timezoneChoices(null, 'Europe/Paris', 'Asia/Kolkata');
    expect(zones).toContain('Asia/Kolkata');
    expect(zones).toContain('Europe/Paris');
  });

  it('does not list the same zone twice when it is asked for twice', () => {
    // The ordinary case: the box is showing exactly what the gym holds.
    vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['Europe/Paris']);
    const zones = timezoneChoices(null, 'Asia/Kolkata', 'Asia/Kolkata');
    expect(zones.filter((z) => z === 'Asia/Kolkata')).toHaveLength(1);
  });

  it('ignores a zone it is asked for that is not a string', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['Europe/Paris']);
    expect(timezoneChoices(null, null, undefined, '  ')).toEqual(['Europe/Paris']);
  });

  it('does not duplicate a zone the runtime already lists', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['Asia/Calcutta', 'America/Chicago']);
    const zones = timezoneChoices(null, 'America/Chicago');
    expect(zones.filter((z) => z === 'America/Chicago')).toHaveLength(1);
  });

  it('still carries the DEVICE’s zone, which is the create door’s guarantee', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['America/Chicago']);
    expect(timezoneChoices('Asia/Calcutta', 'America/Chicago')).toContain('Asia/Calcutta');
  });

  /** An empty list is a real answer: the caller draws a plain text box. Handing
   *  back a one-item picker holding only the gym's current zone would be worse
   *  than nothing — it could not be changed. */
  it('stays EMPTY when the runtime cannot enumerate zones, rather than becoming a list of one', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockImplementation(() => {
      throw new Error('unsupported');
    });
    expect(timezoneChoices(null, 'America/Chicago')).toEqual([]);
  });
});

describe('what the form refuses to send at all', () => {
  it('asks for a name in words instead of letting the server say `too_small`', () => {
    expect(gymDetailsProblem({ ...gymDetailsDraft(ORG), name: '   ' })).toMatch(/needs a name/i);
  });

  it('asks for a time zone the same way, and says what it decides', () => {
    const problem = gymDetailsProblem({ ...gymDetailsDraft(ORG), timezone: '' });
    expect(problem).toMatch(/time zone/i);
    expect(problem).toMatch(/day ends/i);
  });

  /** THE CONTROL, and it is what makes the two above a bound rather than a wall:
   *  an ordinary form has no problem. */
  it('finds nothing wrong with an ordinary form', () => {
    expect(gymDetailsProblem(gymDetailsDraft(ORG))).toBeNull();
  });

  /** An empty COUNTRY is not an error — it is what every pre-`0014` gym holds.
   *  Refusing to save a name because a gym was never asked where it is would be
   *  this screen inventing a requirement the server does not have. */
  it('does NOT treat an unrecorded country as a problem', () => {
    const draft = gymDetailsDraft({ ...ORG, country: null });
    expect(gymDetailsProblem(draft)).toBeNull();
  });
});

describe('what actually gets sent', () => {
  it('sends nothing at all when nothing moved', () => {
    expect(gymDetailsPatch(gymDetailsDraft(ORG), ORG)).toBeNull();
  });

  /** THE ONE WITH TEETH. A gym on a subscription is refused with 409
   *  `currency_locked` when the country it sends resolves to a different
   *  currency, and the server's first version refused a whole save merely for
   *  MENTIONING the country (:19656 C/H-1). A form that restated every box it
   *  drew would put the gym's money on the table every time somebody fixed a
   *  typo in the name. */
  it('renames a gym WITHOUT mentioning its country', () => {
    const patch = gymDetailsPatch({ ...gymDetailsDraft(ORG), name: 'Iron House Gym' }, ORG);
    expect(patch).toEqual({ name: 'Iron House Gym' });
    expect(Object.keys(patch)).not.toContain('country');
  });

  it('sends the country when — and only when — somebody picked a different one', () => {
    expect(gymDetailsPatch({ ...gymDetailsDraft(ORG), country: 'IN' }, ORG)).toEqual({
      country: 'IN',
    });
  });

  /** The server upper-cases at its own boundary and the column's CHECK is two
   *  capitals, so a lower-case write is a 23514 — a 500 where an owner should see
   *  their country saved. Compared upper-cased too, or `us` would read as a
   *  change to a gym already in `US`. */
  it('upper-cases the country, and does not call `us` a change from `US`', () => {
    expect(gymDetailsPatch({ ...gymDetailsDraft(ORG), country: 'in' }, ORG)).toEqual({
      country: 'IN',
    });
    expect(gymDetailsPatch({ ...gymDetailsDraft(ORG), country: 'us' }, ORG)).toBeNull();
  });

  /** A gym that has never been asked can record one — which is how every
   *  pre-`0014` gym heals itself, and the server allows it precisely because the
   *  country it records resolves to the currency it is already billed in. */
  it('lets a gym with NO country on record set one', () => {
    const older = { ...ORG, country: null };
    expect(gymDetailsPatch({ ...gymDetailsDraft(older), country: 'US' }, older)).toEqual({
      country: 'US',
    });
  });

  /** An empty country is left OUT, not sent as `''`. The field is `.length(2)`,
   *  so an empty string is a 400 — and there is nothing to say. */
  it('never sends an EMPTY country', () => {
    const older = { ...ORG, country: null };
    const patch = gymDetailsPatch({ ...gymDetailsDraft(older), name: 'Renamed' }, older);
    expect(patch).toEqual({ name: 'Renamed' });
  });

  /** `city` is the one field with three states, and the PATCH's whole point:
   *  absent leaves it alone, `null` clears it. */
  it('clears a city with null, and sets one that was never there', () => {
    expect(gymDetailsPatch({ ...gymDetailsDraft(ORG), city: '  ' }, ORG)).toEqual({ city: null });
    const noCity = { ...ORG, city: null };
    expect(gymDetailsPatch({ ...gymDetailsDraft(noCity), city: 'Austin' }, noCity)).toEqual({
      city: 'Austin',
    });
  });

  /** The server trims on the way in, so an untrimmed comparison lights Save up
   *  for a save that stores nothing — a button that promises a change the
   *  database will not make. */
  it('treats a trailing space as no change, because the server trims', () => {
    expect(gymDetailsPatch({ ...gymDetailsDraft(ORG), name: 'Iron House  ' }, ORG)).toBeNull();
    expect(gymDetailsPatch({ ...gymDetailsDraft(ORG), city: ' Austin ' }, ORG)).toBeNull();
  });

  it('sends a trimmed value when it IS a change', () => {
    expect(gymDetailsPatch({ ...gymDetailsDraft(ORG), name: '  Iron House Two  ' }, ORG)).toEqual({
      name: 'Iron House Two',
    });
  });

  /** An empty NAME is never sent — `gymDetailsProblem` refuses the save first,
   *  and this is the second door: without it, clearing the name would quietly
   *  send a patch that says nothing about the name. */
  it('never sends an empty name or an empty time zone', () => {
    expect(gymDetailsPatch({ ...gymDetailsDraft(ORG), name: '' }, ORG)).toBeNull();
    expect(gymDetailsPatch({ ...gymDetailsDraft(ORG), timezone: '' }, ORG)).toBeNull();
  });

  it('carries a real time-zone change, which is the whole reason this form exists', () => {
    expect(
      gymDetailsPatch({ ...gymDetailsDraft(ORG), timezone: 'Asia/Kolkata' }, ORG),
    ).toEqual({ timezone: 'Asia/Kolkata' });
  });

  it('sends several fields at once when several moved', () => {
    const patch = gymDetailsPatch(
      { name: 'Iron House Two', city: 'Dallas', country: 'IN', timezone: 'Asia/Kolkata' },
      ORG,
    );
    expect(patch).toEqual({
      name: 'Iron House Two',
      city: 'Dallas',
      country: 'IN',
      timezone: 'Asia/Kolkata',
    });
  });
});
