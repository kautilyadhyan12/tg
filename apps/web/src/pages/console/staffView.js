import { OWNER_ONLY_PRIVILEGES, ROLE_PRIVILEGES, STAFF_INVITE_EMAIL_REASON_WORDS, STAFF_INVITE_RESENDS_MAX, orgWords, withArticle } from '@app/shared';
import { formatJoinedAt, roleLabel } from './consoleView';

// Pure view helpers for Members → Staff (it was Settings' Staff box until 23c-ii) — Part 3 §4.7 ("list,
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
      ? "Can see who's in the app and who came in."
      : `Can see who came in. They can't see your ${words.people} in the app yet.`;
  return [
    {
      value: 'manager',
      label: 'Manager',
      hint: `Can keep your ${words.person} list, invite people and remove ${words.people}.`,
    },
    { value: 'trainer', label: words.coachCap, hint: trainerHint },
  ];
}

/** THE ROLES THIS PERSON CAN BE GIVEN from their own panel: manager and trainer, and the
 *  gym's own roles (RULINGS 2026-10-07), less the one they hold. Each carries what the
 *  server is sent (`body`), the button's words and the question asked first. The owner
 *  gets none: the server refuses their row (`owner_role_locked`).
 *
 *  A role of the gym's own is a trainer's underneath, so somebody on one is offered plain
 *  trainer as well; and one whose own role has since been deleted keeps its name and is
 *  offered every role there is. The role they hold is left out only while they hold its
 *  ticks too: a role made again under the same name, or ticks changed by hand since, and
 *  it is offered, to give them the role as it now stands. */
export function roleTargets(person, roles, orgType) {
  if (!canChangeStaff(person)) return [];
  const ownName = typeof person.roleName === 'string' && person.roleName !== '' ? person.roleName : null;
  const builtIn = ['manager', 'trainer']
    .filter((role) => ownName !== null || role !== person.role)
    .map((role) => ({
      key: role,
      body: { role },
      label: `Make ${roleLabel(role, orgType).toLowerCase()}`,
      question: roleChangeWarning(person, role, orgType),
    }));
  const own = (Array.isArray(roles) ? roles : [])
    .filter((r) => r.name !== ownName || privilegesDiffer(heldPrivileges(person), r.privileges))
    .map((r) =>
      // The role they already hold by name, offered because their ticks are not its: the
      // button says what it does, and does not offer them a role their tag says they have.
      r.name === ownName
        ? {
            key: r.id,
            body: { roleId: r.id },
            label: `Reset to ${r.name}'s permissions`,
            question: `Give ${person.displayName ?? 'them'} the permissions saved for ${r.name}? This replaces what is ticked now.`,
          }
        : {
            key: r.id,
            body: { roleId: r.id },
            label: `Make ${r.name}`,
            question: `Make ${person.displayName ?? 'them'} ${withArticle(r.name)}? Their permissions become the ones saved for that role.`,
          },
    );
  return [...builtIn, ...own];
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

/** "3 people run your gym", from the whole list.
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
  return n === 1 ? `1 person runs your ${it}` : `${n} people run your ${it}`;
}

/** WHAT BECOMING STAFF COSTS A GYM, in one sentence the screen can print (spec Part 3
 *  §10.4): a staff login is free; using the member app takes a place, whoever uses it.
 *  An appointment changes no join-code number either, so the sentence names none. */
export function staffSeatsNote() {
  return 'Staff use the console free. Using the member app here takes one of your places.';
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
      label: "See who's in the app",
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
      hint: 'Who checked in each day, and the live list on Attendance.',
    },
    {
      // Spec Part 3 §12.5 (16b-ii): owner and manager by default; the owner can tick it
      // for a trainer who works the front desk.
      value: 'attendance.mark',
      label: 'Check people in',
      hint: 'Find a person on Attendance and check them in by hand.',
    },
    {
      // Spec Part 3 §15.5 (19a-iii): owner and manager by default.
      value: 'leaderboard.manage',
      label: 'Run the leaderboard',
      hint: `See everyone on the boards and what counted, take somebody off, and choose which boards ${words.people} see.`,
    },
    {
      // Spec Part 3 §15.2 (19b-i): owner and manager by default.
      value: 'posts.manage',
      label: 'Post updates',
      hint: `Write posts your ${words.people} read in their app, pin them and remove them.`,
    },
    {
      // Spec Part 3 §13.3 (17b-i): owner and manager by default. It had no box until
      // 23c-ii, so every manager's panel said they held a permission the screen could
      // not show.
      value: 'schedule.manage',
      label: 'Run classes and personal training',
      hint: `Set up classes, the calendar and class bookings, and every ${words.coach}'s hours and sessions.`,
    },
    {
      value: 'members.confirm',
      label: `Keep the ${words.person} list and invite`,
      hint: `Import and change the list, send invitations, and see Leads and your ${words.it}'s page.`,
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
      // Spec Part 3 §13.1 (17a-i): owner and manager by default; the owner can tick it
      // for anyone on staff.
      value: 'memberships.manage',
      label: 'Change membership types and prices',
      hint: `What your ${words.it} sells and what each costs, in Memberships.`,
    },
    {
      // The owner's by default: drawn on the owner's own row (`OWNER_ROW_ONLY`).
      value: 'org.manage',
      label: `Change ${words.it} details`,
      hint: "The name, address and time zone, when you're open, the front desk's devices and follow-up emails to leads.",
    },
    {
      value: 'billing.manage',
      label: 'Manage the plan and billing',
      hint: "Choose the plan's size, pay for it, change how it is paid and cancel it.",
    },
    {
      value: 'staff.manage',
      label: 'Manage staff',
      hint: 'Invite people, change what they can do, and remove them from staff.',
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
 *  is, wherever the request comes from, and the person's panel still shows the
 *  server's sentence if one arrives.
 *
 *  An unknown role takes the REFUSING side, like `canManageStaff` above: a role
 *  invented later is offered the smaller set until somebody decides otherwise. */
export function privilegeChoices(role, orgType) {
  const copy = privilegeCopy(orgType).filter((choice) => !isRetiredPrivilege(choice.value));
  if (role === 'owner') return copy;
  return copy.filter((choice) => !isOwnerOnlyPrivilege(choice.value) && !OWNER_ROW_ONLY.includes(choice.value));
}

/** Ticks drawn on the owner's own row and offered to nobody else. They are the owner's by
 *  default, and whether another member of staff may be given them from this screen has
 *  not been decided; the server does not refuse them, so one held by somebody else is
 *  carried through a save (`carriedPrivileges`). */
const OWNER_ROW_ONLY = ['org.manage', 'billing.manage'];

/** The join code's two ticks: kept on a person and carried through a save, but no box
 *  is drawn, since join codes are switched off and they let nobody do anything (ROADMAP
 *  3c; spec Part 3 §10.6). */
const RETIRED_PRIVILEGES = ['codes.invite', 'codes.manage'];

export function isRetiredPrivilege(privilege) {
  return RETIRED_PRIVILEGES.includes(privilege);
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
  const held = heldPrivileges(person);
  return PRIVILEGE_ORDER.filter((value) => held.includes(value));
}

/** The ticks this person holds: the stored set, or, from a server that sends none, what
 *  their role gives. */
export function heldPrivileges(person) {
  return Array.isArray(person?.privileges)
    ? person.privileges.filter((value) => typeof value === 'string')
    : [...(ROLE_PRIVILEGES[person?.role] ?? [])];
}

/** THE TICKS A SAVE CARRIES THROUGH UNCHANGED: held by this person, with no box on their
 *  row.
 *
 *  **The whole set is what gets saved**, so a tick the screen draws no box for would be
 *  stripped from that person by an owner who never saw it: a real loss of access,
 *  silently. Three kinds are carried: the retired join-code ticks; a tick this row is not
 *  offered (`OWNER_ROW_ONLY`, held by somebody who is not the owner); and one this build
 *  has no words for at all (the api can gain a privilege before the web is redeployed).
 *
 *  **One is dropped on purpose**: "Manage staff" on a row that is not the owner's. The
 *  server refuses it there (409 `owner_only_privilege`), so carrying it would make every
 *  save of that row fail. */
export function carriedPrivileges(person, orgType) {
  const offered = privilegeChoices(person?.role, orgType).map((choice) => choice.value);
  const ownerRow = person?.role === 'owner';
  return [...new Set(heldPrivileges(person))].filter(
    (value) => !offered.includes(value) && (ownerRow || !isOwnerOnlyPrivilege(value)),
  );
}

/** The sentence for the carried ticks that let somebody do something, or null when there
 *  are none (the retired ticks do nothing, so they are not counted). Said rather than
 *  omitted: an owner pressing Save is entitled to know the boxes are not the whole story. */
export function carriedNote(person, orgType) {
  const carried = carriedPrivileges(person, orgType).filter((value) => !isRetiredPrivilege(value));
  if (carried.length === 0) return null;
  const you = person?.isYou === true;
  // Named where this screen has the words (the two drawn only on the owner's row), counted
  // where it has none.
  const copy = privilegeCopy(orgType);
  const named = copy.filter((choice) => carried.includes(choice.value)).map((choice) => choice.label);
  const unnamed = carried.length - named.length;
  const parts = [];
  if (named.length > 0) parts.push(`${you ? 'You' : 'They'} can also: ${named.join(', ')}.`);
  if (unnamed > 0) {
    const also = you ? 'You also have' : 'They also have';
    parts.push(unnamed === 1 ? `${also} 1 permission this screen has no box for.` : `${also} ${unnamed} permissions this screen has no box for.`);
  }
  // The owner's row is never saved.
  if (person?.role !== 'owner') parts.push(carried.length === 1 ? 'Saving leaves it alone.' : 'Saving leaves these alone.');
  return parts.join(' ');
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

// ── STAFF INVITED BY EMAIL (Part 3 §10.3; ROADMAP 4a-i) ─────────────────────

/** A role's usual ticks: what the invite form starts with when the role is chosen. */
export function roleTicks(role) {
  return [...(ROLE_PRIVILEGES[role] ?? [])];
}

/** What the invite sends: the boxes ticked on the form, plus the role's usual ticks this
 *  screen has no box for (as Save permissions keeps them), never "Manage staff" and never
 *  the join code ticks, which let nobody do anything now (ROADMAP 3c). */
export function inviteTicks(role, ticked, orgType) {
  const offered = privilegeChoices(role, orgType).map((choice) => choice.value);
  const unseen = roleTicks(role).filter((value) => !offered.includes(value) && !isRetiredPrivilege(value));
  return [...new Set([...ticked.filter((value) => offered.includes(value)), ...unseen])];
}

/** The permissions an invitation gives, as the tick boxes name them, least powerful
 *  first: shown on the person's Accept card. */
export function abilityLabels(privileges, orgType) {
  return privilegeCopy(orgType)
    .filter((choice) => privileges.includes(choice.value) && !isRetiredPrivilege(choice.value))
    .map((choice) => choice.label);
}

/** Email reasons Send again cannot help: the address bounced, refused, complained or
 *  unsubscribed. The reason line already says what to do. */
const BLOCKED_REASONS = ['bounced', 'refused', 'complained', 'unsubscribed'];

/** One invitation's line on Members → Staff: who, as what, and where it stands, and
 *  whether Send again is offered (4a-ii) or, when it is not, why. */
export function staffInviteView(invite, orgType, now = Date.now()) {
  const role = invite.roleName || roleLabel(invite.role, orgType);
  const status =
    invite.state === 'declined'
      ? `Said no thanks${invite.declinedAt ? ` · ${formatJoinedAt(invite.declinedAt)}` : ''}`
      : invite.state === 'ended'
        ? `Ended ${formatJoinedAt(invite.expiresAt)} · not accepted`
        : `Waiting for them to accept · until ${formatJoinedAt(invite.expiresAt)}`;
  const sentAgain = invite.lastSentAt !== undefined && invite.lastSentAt !== invite.invitedAt;
  const email =
    invite.state !== 'waiting'
      ? null
      : invite.emailStatus === 'sent'
        ? sentAgain
          ? `Email sent again · ${formatJoinedAt(invite.lastSentAt)}`
          : 'Email sent'
        : invite.emailStatus === 'sending'
          ? 'Sending the email…'
          : (STAFF_INVITE_EMAIL_REASON_WORDS[invite.emailReason] ?? 'Email not sent.');
  const blocked = invite.emailStatus === 'not_sent' && BLOCKED_REASONS.includes(invite.emailReason);
  const left = invite.resendsLeft ?? 0;
  // The week's 3 emails to this address have gone: the day another may (round one, L1).
  const waitWeek = typeof invite.sendAgainFrom === 'string' && Date.parse(invite.sendAgainFrom) > now;
  return {
    title: invite.email,
    meta: `${role} · ${status}`,
    email,
    emailProblem: invite.state === 'waiting' && invite.emailStatus === 'not_sent',
    // The one reason that needs something done in another place (`sentencePlace`).
    emailPlace: invite.state === 'waiting' && invite.emailStatus === 'not_sent' && invite.emailReason === 'gym_name' ? 'gymName' : null,
    action: invite.state === 'waiting' ? 'Cancel invitation' : 'Remove',
    canSendAgain: left > 0 && invite.emailStatus !== 'sending' && !blocked && !waitWeek,
    // Said, never hidden, once the button is gone for having been used up or for the week.
    sendAgainNote:
      left === 0 && !blocked
        ? `Sent ${STAFF_INVITE_RESENDS_MAX + 1} times, so it can't be sent again. Remove it and invite them again if they still need it.`
        : waitWeek && !blocked
          ? `3 emails went to this address this week. You can send it again on ${formatJoinedAt(invite.sendAgainFrom)}.`
          : null,
  };
}

/** What the owner is told once Send again has worked. */
export function sentAgainNotice(invite) {
  return `Sent again to ${invite.email}. The invitation now works until ${formatJoinedAt(invite.expiresAt)}.`;
}
