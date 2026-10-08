// A SERVER SENTENCE'S BUTTON (ROADMAP 23d-ii), drawn: the link for whoever can open the
// place, a line saying who can for anybody else, and the question first where leaving
// would lose something.
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SentencePlace from './SentencePlace';

const GYM = { slug: 'iron-house', orgType: 'gym' };
const draw = (props) =>
  render(
    <MemoryRouter>
      <SentencePlace {...props} />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe('the button under a sentence that names another place', () => {
  it('the owner gets the button to that exact place', () => {
    draw({ kind: 'gymName', gym: { ...GYM, staffRole: 'owner' } });
    expect(screen.getByRole('link', { name: 'Open Gym details' }).getAttribute('href')).toBe('/console/iron-house/settings#gym-details');
  });

  it('a trainer, and a manager without the permission, get no button and read who can', () => {
    for (const gym of [{ ...GYM, staffRole: 'trainer' }, { ...GYM, staffRole: 'manager', privileges: ['members.read', 'members.remove'] }, undefined]) {
      draw({ kind: 'staff', gym });
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.getByText('The owner can change their access.')).toBeTruthy();
      cleanup();
    }
  });

  it('where leaving would lose something, the press asks first', () => {
    draw({ kind: 'country', gym: { ...GYM, staffRole: 'owner' }, guard: true });
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Set your country' }));
    expect(screen.getByRole('link', { name: 'Leave this page' }).getAttribute('href')).toBe('/console/iron-house/settings#country');
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(screen.getByRole('button', { name: 'Set your country' })).toBeTruthy();
  });

  it('a sentence that names no place draws nothing', () => {
    const { container } = draw({ kind: null, gym: { ...GYM, staffRole: 'owner' } });
    expect(container.textContent).toBe('');
  });
});
