import { OWNER_ONLY_PRIVILEGES, ROLE_PRIVILEGES, orgWords } from '@app/shared';
import { roleLabel } from './consoleView';

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
 *  **IT ASKS FOR THE POWER, NOT THE JOB TITLE — T3 round 1's re-review, L-1.**
 *  This read `staffRole === 'owner'` and was the THIRD gate of the class round 1
 *  called Critical, left behind because its two siblings were the ones the
 *  defect showed up on. The commit that fixed them said "no screen may DECIDE on
 *  `staffRole`", and that sentence was not true of the shipped tree.
 *
 *  **Nothing false reached a user, which is why the reviewer tagged it Low and
 *  did not tag it Critical:** `staff.manage` cannot diverge from `role ===
 *  'owner'` on any row you can reach today — the server 409s an owner-only
 *  privilege onto a non-owner row, the last owner cannot be ticked out of it, an
 *  owner's role cannot be changed, and `owner` is not a role this screen hands
 *  out. **It stops being Low the day a second owner or delegated staff
 *  management ships, and both have live `OWED.md` lines** — which is exactly the
 *  reason to fix it now rather than when it starts lying.
 *
 *  Reads the set `viewerPrivileges` resolves, the same shape as
 *  `canManageCodes` and `canRemoveMembers`. */
export function canManageStaff(privileges) {
  return Array.isArray(privileges) && privileges.includes('staff.manage');
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
 *  would promise a gym owner powers they are about to go looking for.
 *
 *  **THE TRAINER HINT DEPENDS ON THE ORG TYPE.** "Can see your member list and
 *  your join code" is FALSE for a STUDIO: `listOrgMembers` refuses a trainer
 *  with 403 `trainer_scope_unavailable` unless `orgType` is `gym` or
 *  `personal_trainer`, because §2.3 makes group scoping CORE for studios and
 *  nothing assigns a trainer to a group yet (`gym_staff` has no group column).
 *  Studio is offered in the create wizard, so this is reachable: a studio owner
 *  reads the sentence, appoints a trainer for exactly that, and the trainer
 *  opens Clients and is turned away. **The rule above is what that broke — a
 *  hint naming what the MATRIX grants rather than what this org's trainer gets.**
 *
 *  A PERSONAL TRAINER's assistant gets the client list (there is one list and no
 *  group to scope it to). The word for the people follows the type — a gym has
 *  members, a studio and a trainer have clients — in the promise AND in the
 *  refusal, so one screen never uses two words for the same people.
 *
 *  Taking the org type as an argument rather than reading it: this file is pure,
 *  and an unknown type is treated as NOT a gym — the refusing side — so a type
 *  added later cannot silently promise access it does not have. */
export function staffRoleChoices(orgType) {
  const words = orgWords(orgType);
  const trainerHint =
    orgType === 'gym' || orgType === 'personal_trainer'
      ? `Can see your ${words.person} list and your join code.`
      : `Can see your join code. They can't see your ${words.person} list yet.`;
  return [
    {
      value: 'manager',
      label: 'Manager',
      hint: `Can confirm people joining, remove ${words.people}, and manage your join codes.`,
    },
    { value: 'trainer', label: words.coachCap, hint: trainerHint },
  ];
}

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
export function staffCountLabel(staff, orgType) {
  if (!Array.isArray(staff)) return null;
  const it = orgWords(orgType).it;
  const n = staff.length;
  // AN EMPTY ARRAY IS THE SAME CLAIM AS AN UNREADABLE ONE (T3 Low). Only
  // non-arrays were guarded, so an empty list printed "0 people run this gym" —
  // the sentence this helper exists to make impossible. Unreachable today (the
  // owner's own row is always in the list), and one empty array away, which is
  // the distance :5104 F5 says not to leave.
  if (n === 0) return null;
  return n === 1 ? `1 person runs this ${it}` : `${n} people run this ${it}`;
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
export function staffSeatsNote(orgType) {
  return `Staff don't use up one of your paid ${orgWords(orgType).person} seats.`;
}

// ── THE TICK BOXES (Kd ruling :11429, settled :15381) ───────────────────────
//
// The ROLE picks what somebody starts with; the TICKS are what the server
// actually enforces. Everything below exists so the screen shows the same set
// the server would, and never offers a box whose save is guaranteed to fail.

/** WHAT EACH TICK MEANS, in words a gym owner reads.
 *
 *  **The order is least powerful first**, so an owner scanning down the list
 *  meets "see who has joined" before "take somebody out of the gym", and
 *  `staff.manage` — the one that hands over the gym itself — is last.
 *
 *  **The words describe what the PERSON can do, never what the code is called.**
 *  `members.confirm` is "Let people into the gym"; nobody outside this repo has
 *  ever heard of an application being confirmed. */
function privilegeCopy(orgType) {
  const words = orgWords(orgType);
  return [
    {
      value: 'members.read',
      label: `See the ${words.person} list`,
      hint: `Who has joined your ${words.it}, and when.`,
    },
    {
      value: 'codes.invite',
      label: 'Share the join code',
      hint: 'See the code and hand it out to new people.',
    },
    {
      // KD'S RULING 18's SECOND HALF, AND IT LIVES HERE AND NOWHERE ELSE
      // (:28107): *"also stafs can see it too default permission owner can
      // change it"*. Without a box, "the owner can change it" is a sentence
      // with no control behind it — the gap `org.manage` and `billing.manage`
      // are already in, which `OWED.md` carries.
      //
      // A READ, so it sits high in the least-powerful-first order: seeing who
      // came in is a smaller thing than letting somebody into the gym.
      value: 'attendance.read',
      label: 'See who came in',
      hint: 'The list of people who marked themselves in each day.',
    },
    {
      value: 'members.confirm',
      label: `Let people into the ${words.it}`,
      hint: 'Say yes or no to people waiting to join.',
    },
    {
      value: 'members.remove',
      label: `Remove ${words.people}`,
      hint: `Take somebody out of your ${words.it}.`,
    },
    {
      value: 'codes.manage',
      label: 'Change join codes',
      hint: 'Make a new code, pause one, or give it an end date.',
    },
    {
      value: 'staff.manage',
      label: 'Manage staff',
      hint: 'Add people, change what they can do, and take their keys back.',
    },
  ];
}

/** The ticks in drawing order, as plain strings.
 *
 *  **Read off the GYM's copy, and the words are irrelevant to it** — it is the
 *  `value` list, which is identical for every org type. Taking it from one
 *  known type rather than threading a type through `effectivePrivileges` keeps
 *  "what order do ticks draw in" a single answer for the whole console. */
const PRIVILEGE_ORDER = privilegeCopy('gym').map((p) => p.value);

/** THE BOXES THIS ROW MAY BE GIVEN — and for anybody but the owner, "Manage
 *  staff" is not among them.
 *
 *  **The server refuses it with 409 `owner_only_privilege`** (:15534 C/H-1: the
 *  ticks route is gated on that very privilege, so handing it to a manager let
 *  that manager strip the owner, who then got 403 on their own member list).
 *  Drawing a box whose every save is refused is the "greyed control over a live
 *  route" :11429 rule 4 names in advance — so it is not drawn.
 *
 *  **This is NOT the enforcement and must never be read as it** (R3.3). The 409
 *  is, wherever the request comes from, and `StaffPanel` still shows the
 *  server's sentence if one arrives.
 *
 *  An unknown role takes the REFUSING side, like `canManageStaff` above: a role
 *  invented later is offered the smaller set until somebody decides otherwise. */
export function privilegeChoices(role, orgType) {
  const copy = privilegeCopy(orgType);
  if (role === 'owner') return copy;
  return copy.filter((choice) => !isOwnerOnlyPrivilege(choice.value));
}

/** Is this one of the ticks only an owner's row may carry? Read from the shared
 *  list the server refuses on, never from a copy written here. */
export function isOwnerOnlyPrivilege(privilege) {
  return OWNER_ONLY_PRIVILEGES.includes(privilege);
}

/** WHAT THIS PERSON CAN ACTUALLY DO, as the screen should draw it.
 *
 *  **The stored set wins; the role's template is only the fallback** — the same
 *  order of preference the server's own `privilegesFor` uses, so the screen and
 *  the door cannot disagree about a row.
 *
 *  **THE FALLBACK IS THE POINT AND IT IS NOT DEFENSIVE PADDING.**
 *  `orgStaffSchema.privileges` is optional on purpose (:12660,
 *  expand-then-contract): a REQUIRED key would destroy this whole screen during
 *  any window where the web is newer than the API. What must never happen in
 *  that window is a row drawn with NOTHING ticked — that reads as a colleague
 *  who can do nothing, which is false, and an owner "fixing" it would save that
 *  falsehood into the database. So an absent field falls back to what the ROLE
 *  grants, which is exactly what that person could do before the column existed.
 *
 *  Ordered by `PRIVILEGE_ORDER` rather than by the server's order so one row
 *  cannot list its ticks differently from the next. */
export function effectivePrivileges(person) {
  const held = Array.isArray(person?.privileges)
    ? person.privileges
    : (ROLE_PRIVILEGES[person?.role] ?? []);
  return PRIVILEGE_ORDER.filter((value) => held.includes(value));
}

/** TICKS THIS BUILD HAS NO WORDS FOR — held by the row, unknown to this screen.
 *
 *  **Empty today and it must not stay unhandled, because the whole set is what
 *  gets saved.** The api can gain a privilege before the web is redeployed (they
 *  ship separately — Vercel and Hetzner), and `OWED.md` already schedules a
 *  BILLING tick. If this screen simply drew the six it knows and then saved
 *  them, the seventh would be stripped from that person by an owner who never
 *  saw it and never agreed to it — a real loss of access, silently, which is
 *  worse than anything a tick box was meant to fix.
 *
 *  So they are carried through the save UNCHANGED, and the panel says a line
 *  about them rather than pretending they are not there. */
export function unknownPrivileges(person) {
  if (!Array.isArray(person?.privileges)) return [];
  return person.privileges.filter(
    (value) => typeof value === 'string' && !PRIVILEGE_ORDER.includes(value),
  );
}

/** The sentence for those, or null when there are none. Said rather than
 *  omitted (:9390's "say it" shape): an owner pressing Save is entitled to know
 *  the save is not the whole story. */
export function unknownPrivilegesNote(person) {
  const extra = unknownPrivileges(person);
  if (extra.length === 0) return null;
  return extra.length === 1
    ? 'They also have 1 permission this screen is too old to show. Saving leaves it alone.'
    : `They also have ${extra.length} permissions this screen is too old to show. Saving leaves them alone.`;
}

/** Has the owner actually moved anything? Compared as SETS, because the order a
 *  list arrives in is not a change anybody made — and a Save button that lights
 *  up for nothing teaches an owner to ignore it. */
export function privilegesDiffer(before, after) {
  const a = [...new Set(before ?? [])].sort();
  const b = [...new Set(after ?? [])].sort();
  return a.length !== b.length || a.some((value, i) => value !== b[i]);
}

/** WHAT CHANGING SOMEBODY'S ROLE REALLY DOES, before the tap rather than after.
 *
 *  **A role change RESETS the ticks to the new role's defaults** (:15381 — and
 *  it is deliberate: without it "change them to trainer" would leave every
 *  manager power standing, so the one control an owner reaches for to REDUCE
 *  access would reduce nothing).
 *
 *  **The wording is T3 round 1's Low-6 and the correction matters.** "Your
 *  changes will be lost" describes only half of what happens: the new defaults
 *  BECOME the set, so for somebody an owner had hand-NARROWED the reset can
 *  hand back MORE than they had. "Their permissions become the defaults for the
 *  new role" is true in both directions. */
export function roleChangeWarning(person, nextRole, orgType) {
  const name = person?.displayName ?? 'them';
  return `Make ${name} a ${roleLabel(nextRole, orgType).toLowerCase()}? Their permissions become the defaults for the new role.`;
}
