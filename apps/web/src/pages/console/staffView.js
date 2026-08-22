// Pure view helpers for the console's Staff section — Part 3 §4.7 ("list,
// invite by email/phone with role, change role, remove; every staff mutation
// audit-logged; last-owner removal blocked"), behind §2.2's owner-only "Staff
// management" row.
//
// Same shape as `consoleView.js` and `codesView.js`: no React, no network, so
// the rules the screen leans on are tested directly rather than through a
// render. Everything here exists to stop the screen offering something the
// server will refuse, or claiming something that is not true.
//
// THERE IS NO SORTING HELPER HERE, DELIBERATELY. `listStaff` already orders
// `(role = 'owner') DESC, created_at ASC, user_id ASC` — owner first, then
// oldest first — so a second ordering written here would be a second opinion
// about the same list, and the two would disagree the day either moved. The
// panel renders the server's order.

/** WHO SEES THE STAFF SECTION AT ALL — the OWNER, and nobody else.
 *
 *  §2.2's "Staff management" row is one of only two the matrix grants to the
 *  owner alone (billing is the other), and the server enforces it as the
 *  `staff.manage` privilege on all four routes **including the read**: §2.2 has
 *  no "view staff" row, so a manager gets 404 on the list rather than a
 *  read-only copy of it. A section drawn for them would be an error card.
 *
 *  **Hiding is not the enforcement** (R3.3): the refusal stays exactly where it
 *  is. This stops the console DRAWING a control it knows will be refused —
 *  the defect measured one component away on the Members screen, where a
 *  trainer was handed a Remove button the server turns down.
 *
 *  Written as an equality rather than `!== 'trainer'` so a role invented later
 *  is refused by DEFAULT instead of silently handed the keys to a gym. */
export function canManageStaff(staffRole) {
  return staffRole === 'owner';
}

/** The roles this screen can HAND OUT, with what each one can actually do.
 *
 *  **`owner` is absent and it is a deferral, not an oversight** — the same one
 *  `staffAssignableRoleSchema` records on the server. Making a second owner is
 *  the first half of handing a gym over, and the second half (what happens to
 *  the outgoing owner, their seat, their billing) is a question nobody has been
 *  asked. The server refuses `owner` here, so an option added to this list
 *  would be a 400 with a picker in front of it.
 *
 *  **THE HINTS NAME ONLY WHAT IS BUILT.** §2.2 grants a manager rather more
 *  than this — TV-mode tokens, CSV export, the rest of Settings — and none of
 *  it has a route yet. A hint describing the matrix instead of the product
 *  would promise a gym owner powers they are about to go looking for. */
export const STAFF_ROLE_CHOICES = [
  {
    value: 'manager',
    label: 'Manager',
    hint: 'Can confirm people joining, remove members, and manage your join codes.',
  },
  {
    value: 'trainer',
    label: 'Trainer',
    hint: 'Can see your member list and your join code.',
  },
];

/** The role the "switch to…" button offers, or null when there is nothing to
 *  offer. There are exactly two assignable roles, so a change is a single tap
 *  rather than a picker — and an OWNER gets null, because `updateStaffRole`
 *  refuses the owner's row with a 409 and a button that fails is worse than no
 *  button at all. */
export function otherStaffRole(role) {
  if (role === 'manager') return 'trainer';
  if (role === 'trainer') return 'manager';
  return null;
}

/** Does this row get controls?
 *
 *  Only the OWNER's row does not. Both mutations refuse it — the role change
 *  with `owner_role_locked`, the removal with `last_owner` — and the reason is
 *  the same one in both: **every owner is the LAST owner**, because nothing in
 *  the product can appoint a second one. So the row carries the reason in
 *  words instead of two buttons that are guaranteed to fail. */
export function canChangeStaff(person) {
  return person?.role === 'manager' || person?.role === 'trainer';
}

/** "3 people run this gym", from the whole list.
 *
 *  It takes the ARRAY and not a page because `listStaff` has no LIMIT and no
 *  cursor — a gym's staff is small by construction and the endpoint returns all
 *  of it — so unlike the roster's count this one is exact rather than a bound.
 *  If that ever changes, this function is where it has to be dealt with.
 *
 *  A non-array is null rather than zero: "nobody runs this gym" is a claim, and
 *  it is never true (a gym always has its owner), so a reader that could not
 *  read the list has no business making it. */
export function staffCountLabel(staff) {
  if (!Array.isArray(staff)) return null;
  const n = staff.length;
  return n === 1 ? '1 person runs this gym' : `${n} people run this gym`;
}

/** WHAT BECOMING STAFF COSTS A GYM, in one sentence the screen can print.
 *
 *  **This is NOT the sentence the server card said the web half owed, and the
 *  difference is the point.** That entry (DECISIONS :14262) promised to explain
 *  that "promoting a member to staff makes the number beside a join code fall
 *  by one", which was true of the FIRST implementation — appointing wrote
 *  `gym_members.complimentary`, and the join code's `joined` figure excludes
 *  complimentary rows. T3 round 1's C/H-1 took that write out (it corrupted a
 *  flag meaning "did not join") and moved Kd's ruling into `claimSeat`'s own
 *  count. **So nothing writes `complimentary` any more, `joined` is unchanged
 *  by an appointment, and printing that sentence would put a false statement on
 *  screen** — :5807's class, arriving through a stale note rather than through
 *  code. The claim is struck in :14262 in place.
 *
 *  What IS true after that fix, and what this says: staff are excluded from the
 *  seat cap, so appointing somebody does not use up a paid member seat. */
export const STAFF_SEATS_NOTE =
  "Staff don't use up one of your paid member seats.";
