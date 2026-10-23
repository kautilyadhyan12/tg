// Gym details for a gym stored in a country a business can no longer be in (ROADMAP 18s):
// the line under the picker names the country and asks for the right one.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ROLE_PRIVILEGES } from '@app/shared';
import GymDetailsPanel from './GymDetailsPanel';

afterEach(cleanup);

const org = (country, orgType = 'gym') => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Harbour Fitness',
  slug: 'harbour-fitness',
  orgType,
  city: 'Helsinki',
  country,
  timezone: 'Europe/Helsinki',
  locale: 'en',
  currencyDisplay: 'USD',
  postalAddress: null,
  contactPhone: null,
  contactEmail: null,
  billingMobile: null,
  role: 'owner',
  privileges: [...ROLE_PRIVILEGES.owner],
});

const show = (gym) =>
  render(
    <MemoryRouter>
      <GymDetailsPanel org={gym} privileges={[...ROLE_PRIVILEGES.owner]} startOpen />
    </MemoryRouter>,
  );

describe('a gym in a country that left the list', () => {
  it('says so by name, and asks for the country it is in', () => {
    show(org('FI'));
    expect(screen.getByText("We no longer take businesses in Finland. If your gym is in another country, choose it here.")).toBeTruthy();
    expect(screen.queryByText(/We don't have your country on record/)).toBeNull();
  });

  it("uses the business's own word", () => {
    show(org('DE', 'studio'));
    expect(screen.getByText("We no longer take businesses in Germany. If your studio is in another country, choose it here.")).toBeTruthy();
  });

  it('says nothing of the kind for a country on the list, or for none', () => {
    for (const country of ['JP', 'AU', 'FR', 'IN']) {
      show(org(country));
      expect(screen.queryByText(/We no longer take businesses in/), country).toBeNull();
      cleanup();
    }
    show(org(null));
    expect(screen.queryByText(/We no longer take businesses in/)).toBeNull();
    expect(screen.getByText(/We don't have your country on record/)).toBeTruthy();
  });
});
