import { describe, expect, it } from 'vitest';
import { inviteView } from './inviteView';

describe('the invite page words, each in its place', () => {
  it('with a gift', () => {
    expect(inviteView({ gymName: 'Iron House', friendGift: { code: 'WELCOME20', words: '20% off a membership' } })).toEqual({
      invited: 'A member of Iron House has invited you.',
      offer: 'Your welcome offer: 20% off a membership. Use code WELCOME20 when you join.',
      touch: 'Leave your details and Iron House will be in touch.',
      setBy: 'This offer is set by Iron House and may change.',
    });
  });
  it('without one, no offer and nobody said to have set one', () => {
    expect(inviteView({ gymName: 'Iron House', friendGift: null })).toEqual({
      invited: 'A member of Iron House has invited you.',
      offer: null,
      touch: 'Leave your details and Iron House will be in touch.',
      setBy: null,
    });
  });
});
