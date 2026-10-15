import { describe, expect, it } from 'vitest';
import { inviteView } from './inviteView';

describe('the invite page words, each in its place', () => {
  it('with a gift, and the first name of who invited them', () => {
    expect(inviteView({ gymName: 'Iron House', inviterFirstName: 'Maya', friendGift: { code: 'WELCOME20', words: '20% off a membership' } })).toEqual({
      invited: 'Maya invited you to join Iron House.',
      offer: 'Your welcome offer: 20% off a membership. Use code WELCOME20 when you join.',
      touch: 'Leave your details and Iron House will be in touch.',
      setBy: 'This offer is set by Iron House and may change.',
    });
  });
  it('without a gift or a name, no offer, nobody named and nobody said to have set an offer', () => {
    expect(inviteView({ gymName: 'Iron House', inviterFirstName: null, friendGift: null })).toEqual({
      invited: 'A member of Iron House has invited you.',
      offer: null,
      touch: 'Leave your details and Iron House will be in touch.',
      setBy: null,
    });
  });
});
