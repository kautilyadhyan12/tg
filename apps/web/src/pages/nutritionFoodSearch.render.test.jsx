// The Add food search box: the app's own foods read plainly, a packaged product
// from Open Food Facts reads as one and a USDA food names its own source
// (RULINGS 2026-09-14 and 2026-09-16). The server puts the product's brand in
// its name, and decides the order the three sources come back in.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/nutritionApi', async (importOriginal) => ({ ...(await importOriginal()), nutritionService: svc }));

const Nutrition = (await import('./Nutrition')).default;

const food = (canonical, name, source) => ({
  canonical, name, source, kcal: 563, proteinG: 22, carbsG: 25, fatG: 47, fiberG: null, serving: 32, unit: 'g',
});

afterEach(() => cleanup());

describe('the Add food search box', () => {
  it("labels a packaged product with its source, and the app's own food not at all", async () => {
    svc.listMealsForDay = vi.fn(async () => ({ meals: [], truncated: false }));
    svc.listDishware = vi.fn(async () => ({ data: { items: [], nextCursor: null } }));
    svc.getTargets = vi.fn(async () => ({ data: { targets: null, missing: ['goal'], targetWrongSide: false } }));
    svc.searchFoods = vi.fn(async () => ({
      data: {
        items: [
          food('peanut_butter', 'Peanut butter', 'curated'),
          food('off_1', 'Peanut butter · Happy Shopper', 'openfoodfacts'),
          food('off_2', 'Peanut butter · Whole Earth', 'openfoodfacts'),
        ],
      },
    }));
    render(
      <MemoryRouter initialEntries={['/nutrition']}>
        <Nutrition />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Add to Breakfast' }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'peanut butter' } });

    const packaged = (await screen.findByText('Peanut butter · Happy Shopper')).closest('button');
    const second = screen.getByText('Peanut butter · Whole Earth').closest('button');
    const own = screen.getByText('Peanut butter').closest('button');
    expect(within(packaged).getByText('Packaged product · Open Food Facts')).toBeTruthy();
    expect(within(second).getByText('Packaged product · Open Food Facts')).toBeTruthy();
    expect(within(own).queryByText(/Packaged product/)).toBeNull();
    expect(screen.getAllByText('Packaged product · Open Food Facts')).toHaveLength(2);
    expect(svc.searchFoods).toHaveBeenCalledWith('peanut butter', 15);
    // The licence's notice once under the list, however many packaged products it
    // holds, its two names linked to the database and to the licence's text.
    expect(screen.getAllByText(/which is made available here under the/)).toHaveLength(1);
    const database = screen.getAllByRole('link', { name: 'Open Food Facts' });
    const licence = screen.getAllByRole('link', { name: 'Open Database License (ODbL)' });
    expect(database).toHaveLength(1);
    expect(licence).toHaveLength(1);
    expect(database[0].getAttribute('href')).toBe('https://openfoodfacts.org');
    expect(licence[0].getAttribute('href')).toBe('https://opendatacommons.org/licenses/odbl/1-0/');
    for (const link of [database[0], licence[0]]) expect(link.getAttribute('target')).toBe('_blank');
    expect(within(packaged).queryByRole('link')).toBeNull();
  });

  it('names USDA under a food of its table, and credits USDA once under the list', async () => {
    svc.listMealsForDay = vi.fn(async () => ({ meals: [], truncated: false }));
    svc.listDishware = vi.fn(async () => ({ data: { items: [], nextCursor: null } }));
    svc.getTargets = vi.fn(async () => ({ data: { targets: null, missing: ['goal'], targetWrongSide: false } }));
    svc.searchFoods = vi.fn(async () => ({
      data: {
        items: [
          food('paneer', 'Paneer (Indian cottage cheese)', 'curated'),
          food('usda_fndds_2710472', 'Coffee, Cappuccino', 'usda'),
          food('usda_sr_167512', 'Biscuits, refrigerated dough', 'usda'),
          food('off_1', 'Bottled coffee · Costa', 'openfoodfacts'),
        ],
      },
    }));
    render(
      <MemoryRouter initialEntries={['/nutrition']}>
        <Nutrition />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Add to Breakfast' }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'coffee' } });

    const usda = (await screen.findByText('Coffee, Cappuccino')).closest('button');
    const own = screen.getByText('Paneer (Indian cottage cheese)').closest('button');
    const packaged = screen.getByText('Bottled coffee · Costa').closest('button');
    expect(within(usda).getByText('USDA FoodData Central')).toBeTruthy();
    expect(within(usda).queryByText(/Packaged product/)).toBeNull();
    expect(within(own).queryByText(/USDA FoodData Central/)).toBeNull();
    expect(within(packaged).queryByText(/USDA FoodData Central/)).toBeNull();
    // One line under each of the two USDA foods, plus the credit's own link:
    // the credit appears once under the whole list, however many it holds.
    expect(screen.getAllByText('USDA FoodData Central')).toHaveLength(3);
    expect(screen.getAllByText(/U.S. Department of Agriculture/)).toHaveLength(1);
    const credit = screen.getAllByRole('link', { name: 'USDA FoodData Central' });
    expect(credit).toHaveLength(1);
    expect(credit[0].getAttribute('href')).toBe('https://fdc.nal.usda.gov');
    expect(credit[0].getAttribute('target')).toBe('_blank');
    // The three sources are shown in the order the server sent them.
    const shown = screen.getAllByRole('button').map((b) => b.textContent).filter((t) => t.includes('kcal'));
    expect(shown[0]).toContain('Paneer');
    expect(shown[1]).toContain('Coffee, Cappuccino');
    expect(shown[3]).toContain('Bottled coffee');
  });

  it("shows no licence or USDA notice when every result is the app's own food", async () => {
    svc.listMealsForDay = vi.fn(async () => ({ meals: [], truncated: false }));
    svc.listDishware = vi.fn(async () => ({ data: { items: [], nextCursor: null } }));
    svc.getTargets = vi.fn(async () => ({ data: { targets: null, missing: ['goal'], targetWrongSide: false } }));
    svc.searchFoods = vi.fn(async () => ({ data: { items: [food('peanut_butter', 'Peanut butter', 'curated')] } }));
    render(
      <MemoryRouter initialEntries={['/nutrition']}>
        <Nutrition />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Add to Breakfast' }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'peanut butter' } });

    expect(await screen.findByText('Peanut butter')).toBeTruthy();
    expect(screen.queryByText(/Open Database License/)).toBeNull();
    expect(screen.queryByText(/Packaged product/)).toBeNull();
    expect(screen.queryByText(/USDA/)).toBeNull();
  });
});
