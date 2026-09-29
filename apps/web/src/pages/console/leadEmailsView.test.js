import { describe, expect, it } from 'vitest';
import {
  leadEmailsBody,
  leadEmailsChanged,
  leadEmailsDraft,
  leadEmailsProblem,
  tickSendForMe,
  usedThisMonthLine,
} from './leadEmailsView';

const OFF = { sendForMe: false, replyTo: null, perMonth: 100, usedThisMonth: 0, hasPostalAddress: true, stopped: false };
const ON = { ...OFF, sendForMe: true, replyTo: 'desk@ironhouse.example.com', usedThisMonth: 37 };

describe('Settings → Follow-up emails to leads (20c-v)', () => {
  it('starts from what the server holds, and nothing has changed', () => {
    expect(leadEmailsDraft(OFF)).toEqual({ sendForMe: false, replyTo: '' });
    expect(leadEmailsDraft(ON)).toEqual({ sendForMe: true, replyTo: 'desk@ironhouse.example.com' });
    expect(leadEmailsChanged(leadEmailsDraft(OFF), OFF)).toBe(false);
    expect(leadEmailsChanged(leadEmailsDraft(ON), ON)).toBe(false);
  });

  it("ticking the switch fills in the owner's own address only when none is there", () => {
    expect(tickSendForMe({ sendForMe: false, replyTo: '' }, true, 'owner@example.com')).toEqual({ sendForMe: true, replyTo: 'owner@example.com' });
    expect(tickSendForMe({ sendForMe: false, replyTo: 'desk@gym.com' }, true, 'owner@example.com')).toEqual({ sendForMe: true, replyTo: 'desk@gym.com' });
    expect(tickSendForMe({ sendForMe: true, replyTo: 'desk@gym.com' }, false, 'owner@example.com')).toEqual({ sendForMe: false, replyTo: 'desk@gym.com' });
    expect(tickSendForMe({ sendForMe: false, replyTo: '' }, true, undefined)).toEqual({ sendForMe: true, replyTo: '' });
  });

  it('switching on needs a postal address and a reply address; switching off needs nothing', () => {
    expect(leadEmailsProblem({ sendForMe: true, replyTo: 'desk@gym.com' }, OFF)).toBeNull();
    expect(leadEmailsProblem({ sendForMe: true, replyTo: 'desk@gym.com' }, { ...OFF, hasPostalAddress: false })).toMatch(/postal address/);
    expect(leadEmailsProblem({ sendForMe: true, replyTo: '' }, OFF)).toBe('Add the email address replies should go to.');
    expect(leadEmailsProblem({ sendForMe: true, replyTo: 'not an address' }, OFF)).toBe('Add the email address replies should go to.');
    expect(leadEmailsProblem({ sendForMe: false, replyTo: 'nonsense' }, { ...OFF, hasPostalAddress: false })).toBeNull();
  });

  it('sends the address as the server keeps it, and a change of case or spaces is no change', () => {
    expect(leadEmailsBody({ sendForMe: true, replyTo: '  Desk@Gym.com ' })).toEqual({ sendForMe: true, replyTo: 'desk@gym.com' });
    expect(leadEmailsBody({ sendForMe: false, replyTo: '' })).toEqual({ sendForMe: false, replyTo: null });
    expect(leadEmailsBody({ sendForMe: false, replyTo: 'nonsense' })).toEqual({ sendForMe: false, replyTo: null });
    expect(leadEmailsChanged({ sendForMe: true, replyTo: ' DESK@ironhouse.example.com' }, ON)).toBe(false);
    expect(leadEmailsChanged({ sendForMe: false, replyTo: 'desk@ironhouse.example.com' }, ON)).toBe(true);
    expect(leadEmailsChanged({ sendForMe: true, replyTo: 'other@ironhouse.example.com' }, ON)).toBe(true);
  });

  it('says how many of the month are used', () => {
    expect(usedThisMonthLine(ON)).toBe('37 of 100 new leads emailed for you this month.');
  });
});
