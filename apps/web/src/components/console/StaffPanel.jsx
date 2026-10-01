import { useEffect, useState } from 'react';
import { STAFF_ROLE_NAME_MAX, orgWords, withArticle } from '@app/shared';
import { Loader2, Plus, UserMinus, X } from 'lucide-react';
import { ConsoleFailed, ConsoleLoading, ConsoleSection } from './ConsoleStates';
import { formatJoinedAt, roleLabel } from '../../pages/console/consoleView';
import {
  staffSeatsNote,
  canChangeStaff,
  canManageStaff,
  effectivePrivileges,
  otherStaffRole,
  privilegeChoices,
  privilegesDiffer,
  roleChangeWarning,
  staffCountLabel,
  staffRoleChoices,
  inviteTicks,
  roleTicks,
  sentAgainNotice,
  staffInviteView,
  unknownPrivileges,
  unknownPrivilegesNote,
} from '../../pages/console/staffView';
import { readOnlyNote } from '../../pages/console/billingView';
import { orgService, errorText, isRetryable } from '../../api/orgsApi';

// WHO RUNS THIS GYM — Part 3 §4.7's Staff surface, on §3.1's Settings screen.
//
// Until the server half landed a gym had exactly ONE person who could do
// anything: the only `INSERT INTO gym_staff` in the product was the owner's own,
// hard-coded at creation, so two of the three roles had been unreachable since
// the first migration and the join door was built around a front desk no gym
// could have. This is the screen that makes a front desk possible.
//
// WHO SEES IT: the owner and nobody else. §2.2's Staff-management row is
// owner-only and the server gates the READ with it too, so a manager opening
// this would get a 404 rather than a read-only list — `canManageStaff` keeps the
// section from being drawn at somebody who could only see an error. R3.3 holds:
// hiding is not the enforcement, the refusal is.
//
// IT OWNS ITS OWN READ AND ITS OWN FAILURE, the way the confirm queue does. A
// staff list that cannot be read must not take the rest of Settings down with
// it, and it must never be drawn as an empty gym — a gym always has its owner,
// so "nobody runs this gym" is never a true sentence and this panel cannot
// produce it.

/** INVITE STAFF (Part 3 §10.3; ROADMAP 4a-i). The email; the role, as one row of buttons
 *  — Manager, Trainer, the gym's own roles and "+ New role" (Kd, RULINGS 2026-10-01) —
 *  with what that role can do ticked straight underneath, for the owner to change before
 *  sending. The server emails an invitation, or, when the address is somebody already in
 *  this gym, makes them staff at once; its reply is the same whether or not the address
 *  has an account.
 *
 *  **`readOnly` REACHES THE FIELDS AND THE SEND BUTTON, not only the "Invite staff"
 *  opener that mounts this form (T3 round 1, C/H-1's second half).** The opener was
 *  guarded and these were not, so a gym lapsing while the form was open left a live
 *  button under the panel's own "needs a plan" note. Cancel stays pressable on purpose —
 *  putting the form down is not a change. Nobody reaches that state today (the section is
 *  the owner's, and an owner of a lapsed gym meets `PlanModal`); it is pinned by tests. */
function AddStaffForm({
  email,
  setEmail,
  role,
  onChooseRole,
  roles,
  ticks,
  setTicks,
  fieldError,
  busy,
  readOnly,
  onAdd,
  onCancel,
  onMakeRole,
  onDeleteRole,
  orgType,
}) {
  const words = orgWords(orgType);
  const builtIn = staffRoleChoices(orgType);
  const own = roles.find((r) => r.id === role) ?? null;
  // A role of the gym's own is a trainer's underneath: every box but Manage staff.
  const tickChoices = privilegeChoices(own === null ? role : 'trainer', orgType);
  const toggleTick = (value) =>
    setTicks((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  // Making a role: its name; the boxes below are its ticks.
  const [newRole, setNewRole] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const hint = newRole !== null ? null : own !== null ? 'One of your own roles.' : (builtIn.find((c) => c.value === role)?.hint ?? null);

  const chip = (selected) => ({
    background: selected ? 'rgba(255,138,31,0.14)' : 'rgba(255,255,255,0.04)',
    border: selected ? '1px solid rgba(255,138,31,0.5)' : '1px solid rgba(255,255,255,0.1)',
    color: selected ? '#FF8A1F' : '#fff',
  });

  const saveRole = async () => {
    const name = (newRole?.name ?? '').replace(/\s+/g, ' ').trim();
    if (name === '') {
      setNewRole({ name: newRole?.name ?? '', error: 'Give the role a name.' });
      return;
    }
    const error = await onMakeRole(name, ticks);
    if (error === null) setNewRole(null);
    else setNewRole({ name, error });
  };

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <label className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
        Their email address
        <input
          id="staff-email"
          type="email"
          value={email}
          disabled={busy || readOnly}
          placeholder="name@example.com"
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mt-1 rounded-xl px-3 py-2 text-sm disabled:opacity-40"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#fff',
          }}
        />
      </label>

      <div className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
        <span id="staff-role-label">Role</span>
        <div className="flex flex-wrap gap-2 mt-1.5" role="radiogroup" aria-labelledby="staff-role-label">
          {[...builtIn.map((c) => ({ key: c.value, label: c.label, own: false })), ...roles.map((r) => ({ key: r.id, label: r.name, own: true }))].map(
            (item) => {
              const selected = newRole === null && role === item.key;
              return (
                <span key={item.key} className="inline-flex items-center rounded-full" style={chip(selected)}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={busy || readOnly}
                    onClick={() => {
                      setNewRole(null);
                      setDeleting(null);
                      onChooseRole(item.key);
                    }}
                    className={`text-sm font-medium py-1.5 disabled:opacity-40 ${item.own ? 'pl-3 pr-1' : 'px-3'}`}
                    style={{ color: 'inherit' }}
                  >
                    {item.label}
                  </button>
                  {item.own ? (
                    <button
                      type="button"
                      aria-label={`Delete the role ${item.label}`}
                      disabled={busy || readOnly}
                      onClick={() => setDeleting(item.key)}
                      className="pr-2 pl-1 py-1.5 disabled:opacity-40"
                      style={{ color: 'rgba(255,255,255,0.45)' }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                </span>
              );
            },
          )}
          <button
            type="button"
            disabled={busy || readOnly}
            onClick={() => {
              setDeleting(null);
              setNewRole({ name: '', error: null });
            }}
            className="text-sm rounded-full px-3 py-1.5 flex items-center gap-1 disabled:opacity-40"
            style={chip(newRole !== null)}
          >
            <Plus className="w-3.5 h-3.5" />
            New role
          </button>
        </div>

        {deleting !== null ? (
          <div className="mt-2 flex flex-wrap items-center gap-2" role="alert">
            <span style={{ color: 'rgba(255,255,255,0.75)' }}>
              Delete the role {roles.find((r) => r.id === deleting)?.name}? Staff who have it keep it and what they can do.
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const id = deleting;
                setDeleting(null);
                await onDeleteRole(id);
              }}
              className="rounded-lg px-3 py-1 font-semibold disabled:opacity-40"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
            >
              Delete role
            </button>
            <button
              type="button"
              onClick={() => setDeleting(null)}
              className="rounded-lg px-3 py-1"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
            >
              Keep it
            </button>
          </div>
        ) : null}

        {hint !== null ? <p className="mt-1.5">{hint}</p> : null}

        {newRole !== null ? (
          <div className="mt-2 flex flex-col gap-1.5">
            <label>
              Role name
              <input
                id="staff-new-role"
                value={newRole.name}
                maxLength={STAFF_ROLE_NAME_MAX}
                placeholder="Front desk"
                onChange={(e) => setNewRole({ name: e.target.value, error: null })}
                className="w-full mt-1 rounded-xl px-3 py-2 text-sm"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
              />
            </label>
            <span>Tick what this role can do below, then save it. You can use it again next time.</span>
            {newRole.error ? <span style={{ color: '#ef4444' }}>{newRole.error}</span> : null}
          </div>
        ) : null}
      </div>

      <fieldset className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
        <legend>What they can do</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 mt-1.5" data-testid="invite-ticks">
          {tickChoices.map((choice) => {
            const on = ticks.includes(choice.value);
            return (
              <label key={choice.value} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy || readOnly}
                  onChange={() => toggleTick(choice.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm" style={{ color: on ? '#fff' : 'rgba(255,255,255,0.5)' }}>
                    {choice.label}
                  </span>
                  <span className="block" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    {choice.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {newRole !== null ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={saveRole}
            disabled={busy || readOnly}
            className="rounded-xl px-4 py-2 text-sm font-semibold flex items-center gap-2 disabled:opacity-40"
            style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save role
          </button>
          <button
            type="button"
            onClick={() => setNewRole(null)}
            disabled={busy}
            className="rounded-xl px-4 py-2 text-sm disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
            We&apos;ll email them an invitation. They sign in with this address and press Accept,
            and they can open your {words.it}&apos;s console. If they&apos;re already a {words.person}{' '}
            of your {words.it}, they get these permissions straight away. You can change what they
            can do at any time. Managing staff stays with you.
          </p>

          {fieldError !== null ? (
            <p className="text-xs" style={{ color: '#ef4444' }}>
              {fieldError}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onAdd}
              disabled={busy || readOnly}
              className="rounded-xl px-4 py-2 text-sm font-semibold flex items-center gap-2 disabled:opacity-40"
              style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Send invitation
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-xl px-4 py-2 text-sm disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** TAKING THE KEYS BACK, and KD RULED WHAT IT MEANS (2026-08-22).
 *
 *  He asked the question this control now answers: *"suppose owner fires a staff
 *  should he be still a member after that?"* The two actions stay separate on
 *  the server — this route ends what somebody can DO, `removeMember` ends
 *  whether they are IN the gym, and only the second costs them the gym's
 *  features — but making an owner REMEMBER the second one is how an ex-employee
 *  keeps a gym's paid perks. So the question offers both outcomes and neither is
 *  a default: an owner picks, every time.
 *
 *  **The order is the server's, not a preference:** `removeMember` refuses
 *  anybody who is still staff, so it is always keys first and membership second.
 *
 *  Both consequences are printed where the choice is made, because they are the
 *  two things an owner is actually deciding between — and the workouts clause is
 *  there because it is the fear the sentence has to answer. */
function RemoveControl({ person, busy, readOnly, words, onRemove }) {
  // THREE STAGES, AND THE THIRD IS KD'S (2026-08-22, from his own smoke).
  //   null            — the Remove button
  //   'choosing'      — which of the two outcomes
  //   false | true    — the chosen outcome, waiting to be confirmed
  //
  // He tapped an outcome and it happened, and reported that as a missing
  // confirmation. The two-stage version DID ask — but a menu of two descriptive
  // options reads as CHOOSING, not as a last chance, and the Members screen one
  // tab away asks the same act as a plain "Remove? / Keep". **The defect was
  // that one act asked two different ways on two screens**, which no test and no
  // mutant can see and a person using the product does.
  //
  // The earlier reasoning here — :13920's "only irreversible things ask first",
  // taking keys back being seconds to undo — was put to Kd and he reaffirmed.
  // It is also weaker than it looked: the DESTRUCTIVE arm of this control is the
  // very act the Members screen already guards, so the inconsistency was the
  // thing to fix, not the extra tap to avoid.
  const [stage, setStage] = useState(null);

  if (stage === null) {
    return (
      <button
        type="button"
        // Somebody who joined by a staff invitation is not a member: there is only
        // their access to take back.
        onClick={() => setStage(person.isMember === false ? false : 'choosing')}
        disabled={busy || readOnly}
        className="text-xs rounded-lg px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40"
        style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
      >
        <UserMinus className="w-3 h-3" />
        Remove
      </button>
    );
  }

  if (stage === 'choosing') {
    return (
      <div className="flex flex-col gap-2 w-full sm:w-auto sm:items-end">
        <span className="text-xs sm:text-right" style={{ color: 'rgba(255,255,255,0.75)' }}>
          Take {person.displayName}&apos;s keys back?
        </span>
        <button
          type="button"
          onClick={() => setStage(false)}
          disabled={busy}
          className="text-xs rounded-lg px-3 py-2 text-left sm:text-right disabled:opacity-40"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)' }}
        >
          <span className="font-semibold block">Just take the keys</span>
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>
            They stay a {words.person} of your {words.it}.
          </span>
        </button>
        <button
          type="button"
          onClick={() => setStage(true)}
          disabled={busy}
          className="text-xs rounded-lg px-3 py-2 text-left sm:text-right disabled:opacity-40"
          style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
        >
          <span className="font-semibold block">Remove from the {words.it} too</span>
          <span style={{ color: 'rgba(239,68,68,0.75)' }}>
            They lose your {words.it}&apos;s features. They keep every workout they have done.
          </span>
        </button>
        <button
          type="button"
          onClick={() => setStage(null)}
          className="text-xs rounded-lg px-3 py-1.5 self-start sm:self-end"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
        >
          Cancel
        </button>
      </div>
    );
  }

  // THE LAST TAP. The sentence names the OUTCOME rather than the button that was
  // pressed, so an owner who mis-tapped upstairs is reading the consequence and
  // not their own click — and the two arms say different things, or the
  // confirmation would be a rubber stamp on a choice it never repeated back.
  const alsoRemoveFromGym = stage === true;
  return (
    <div className="flex flex-col gap-2 w-full sm:w-auto sm:items-end">
      <span className="text-xs sm:text-right" style={{ color: 'rgba(255,255,255,0.75)' }}>
        {alsoRemoveFromGym
          ? `Remove ${person.displayName} from your ${words.it} as well? They lose your ${words.it}'s features. They keep every workout they have done.`
          : person.isMember === false
            ? `Take ${person.displayName}'s keys back? They won't be able to open your ${words.it}'s console.`
            : `Take ${person.displayName}'s keys back? They stay a ${words.person} of your ${words.it}.`}
      </span>
      <div className="flex items-center gap-2 self-start sm:self-end">
        <button
          type="button"
          onClick={() => {
            setStage(null);
            onRemove(alsoRemoveFromGym);
          }}
          disabled={busy || readOnly}
          className="text-xs rounded-lg px-3 py-1.5 font-semibold disabled:opacity-40"
          style={
            alsoRemoveFromGym
              ? { background: 'rgba(239,68,68,0.15)', color: '#ef4444' }
              : { background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }
          }
        >
          {alsoRemoveFromGym ? 'Remove them' : 'Take the keys'}
        </button>
        <button
          type="button"
          onClick={() => setStage(null)}
          className="text-xs rounded-lg px-3 py-1.5"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** THE TICK BOXES — Kd's ruling :11429 ("the three roles stay AND per-staff
 *  privilege ticks go on top"), reaching a person for the first time.
 *
 *  **WHAT IS SENT IS THE WHOLE SET, EVERY TIME, and that is what makes a stale
 *  screen safe.** A diff applied to a row somebody else has edited produces a
 *  set nobody chose. Sending everything means the last writer wins on a set a
 *  human actually looked at — including the ticks this build has no words for,
 *  which travel through untouched rather than being stripped by an owner who
 *  never saw them.
 *
 *  **"Manage staff" is not offered here for anybody but the owner** — see
 *  `privilegeChoices`. Hiding it is not the enforcement (R3.3, :11429 rule 4);
 *  the server's 409 is, and the panel prints its sentence if one ever arrives.
 *
 *  **The owner's own row is READ-ONLY, and that is a smaller claim than it
 *  looks.** It draws the boxes and does not let them be tapped. The reason is
 *  the reason the row already has no Remove and no role button: every owner is
 *  the LAST owner, so the two ticks §2.2 keeps for the owner alone cannot come
 *  off (the server answers `last_owner_locked`), and the rest would only ever
 *  take an owner's own access away from them with no other route to put it back
 *  on this screen. It shows the REAL stored set rather than claiming "you can do
 *  everything", because that claim is one direct API call away from being false
 *  and a screen must not print what it has not been told.
 *
 *  **ONE STRIP IS DELIBERATE AND IS NOT THE `unknownPrivileges` CASE.** A
 *  MANAGER's row holding `staff.manage` gets no box for it (that box is the
 *  owner's alone) and is therefore saved without it — silently narrowed. That is
 *  the safe direction and it is the state the server now refuses to create at
 *  all (409 `owner_only_privilege`, :15534 C/H-1), so such a row could only be a
 *  leftover from before that fix; re-adding it is refused anyway. Unknown ticks
 *  are carried through precisely because the opposite is true of them — nothing
 *  refuses those, so dropping one would be a loss nobody chose. */
/** `readOnly` (the gym has no plan) and `ownerRow` (this row is the owner's) are
 *  two different locks and this component now holds both, so **the local one was
 *  RENAMED rather than the prop bent to fit**: it used to be called `readOnly`
 *  too, and two things called read-only in one component, one of them about a
 *  PERSON and one about the GYM, is a trap for whoever edits it next.
 *
 *  They also say different things on screen, which is why neither can stand in
 *  for the other: `ownerRow` is permanent and explains itself (*"a gym has to
 *  keep somebody who can hand out the keys"*), while `readOnly` is the gym's
 *  temporary state and is explained once at the top of the panel. */
function PrivilegesControl({ person, busy, readOnly, orgType, onSave }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);

  const current = effectivePrivileges(person);
  // WHOSE ROW THIS IS and WHETHER IT CAN BE EDITED are two questions, and T3
  // round 1 Low-2 is that they were one. An OWNER's row is read-only — every
  // owner is the last owner, so the two ticks §2.2 keeps for them cannot come
  // off — but "you" is about identity, and the server already answers it with
  // `isYou`. With a second owner (OWED.md keeps that live) the old code told one
  // owner that another owner's row was their own.
  const ownerRow = person.role === 'owner';
  const isSelf = person.isYou === true;
  const choices = privilegeChoices(person.role, orgType);
  const extraNote = unknownPrivilegesNote(person);
  // T3 round 1 Low-3. The comment above says a manager row holding
  // `staff.manage` is "saved without it — silently narrowed", and it was not:
  // `current` is the STORED set, so the tick rode through into the save and the
  // server answered 409 `owner_only_privilege` — every save on such a row
  // failed. Narrowed HERE, to the boxes this row is actually offered, which
  // makes the sentence true. Unknown ticks are added back at the save (they are
  // the opposite case: nothing refuses those, so dropping one is a loss nobody
  // chose).
  const offered = choices.map((choice) => choice.value);
  const ticked = (draft ?? current).filter((value) => offered.includes(value));

  const openIt = () => {
    setDraft(current);
    setOpen(true);
  };
  const closeIt = () => {
    setOpen(false);
    setDraft(null);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={openIt}
        className="text-xs rounded-lg px-3 py-1.5 self-start"
        style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
      >
        {isSelf ? 'What you can do' : 'What they can do'}
      </button>
    );
  }

  const toggle = (value) => {
    if (ownerRow) return;
    setDraft((prev) => {
      const base = prev ?? current;
      return base.includes(value) ? base.filter((v) => v !== value) : [...base, value];
    });
  };

  // `readOnly` is NOT folded in here, and that is deliberate: `dirty` means
  // "these ticks differ from the stored set", which stays true of a lapsed gym.
  // The SAVE button is what read-only takes away — mixing the two would make an
  // edited-but-unsaveable panel claim nothing had been touched.
  const dirty = !ownerRow && privilegesDiffer(current, ticked);

  return (
    <div
      data-testid={`privileges-${person.userId}`}
      className="rounded-xl p-3 flex flex-col gap-2 w-full"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      {choices.map((choice) => {
        const on = ticked.includes(choice.value);
        return (
          <label key={choice.value} className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={on}
              disabled={busy || ownerRow || readOnly}
              onChange={() => toggle(choice.value)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm" style={{ color: on ? '#fff' : 'rgba(255,255,255,0.5)' }}>
                {choice.label}
              </span>
              <span className="block" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {choice.hint}
              </span>
            </span>
          </label>
        );
      })}

      {extraNote !== null ? (
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {extraNote}
        </p>
      ) : null}

      {ownerRow ? (
        <>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {isSelf ? 'This is what you can do.' : 'This is what the owner can do.'} It can&apos;t be
            changed here — a gym has to keep somebody who can hand out the keys.
          </p>
          <button
            type="button"
            onClick={closeIt}
            className="text-xs rounded-lg px-3 py-1.5 self-start"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
          >
            Close
          </button>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy || readOnly || !dirty}
            onClick={async () => {
              const saved = await onSave([...ticked, ...unknownPrivileges(person)]);
              if (saved) closeIt();
            }}
            className="text-xs rounded-lg px-3 py-1.5 font-semibold disabled:opacity-40"
            style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
          >
            {busy ? 'Saving…' : 'Save permissions'}
          </button>
          <button
            type="button"
            onClick={closeIt}
            disabled={busy}
            className="text-xs rounded-lg px-3 py-1.5 disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** CHANGING SOMEBODY'S ROLE ASKS FIRST, and the question is the whole reason it
 *  exists: **a role change RESETS their ticks to the new role's defaults**
 *  (:15381). Before this the tap was immediate, so an owner who had hand-tuned
 *  somebody's boxes lost that work — or, for somebody they had narrowed, handed
 *  MORE back — with nothing on screen saying so.
 *
 *  The wording is fixed by T3 round 1's Low-6 and is not free to reword: "your
 *  changes will be lost" is only half true, because the defaults BECOME the set
 *  in both directions. `roleChangeWarning` owns the sentence. */
function RoleChangeControl({ person, nextRole, busy, readOnly, orgType, onConfirm }) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={busy || readOnly}
        className="text-xs rounded-lg px-3 py-1.5 self-start disabled:opacity-40"
        style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
      >
        Make {roleLabel(nextRole, orgType).toLowerCase()}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 w-full sm:w-auto sm:items-end">
      <span className="text-xs sm:text-right" style={{ color: 'rgba(255,255,255,0.75)' }}>
        {roleChangeWarning(person, nextRole, orgType)}
      </span>
      <div className="flex items-center gap-2 self-start sm:self-end">
        <button
          type="button"
          onClick={() => {
            setAsking(false);
            onConfirm();
          }}
          disabled={busy || readOnly}
          className="text-xs rounded-lg px-3 py-1.5 font-semibold disabled:opacity-40"
          style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
        >
          Make {roleLabel(nextRole, orgType).toLowerCase()}
        </button>
        <button
          type="button"
          onClick={() => setAsking(false)}
          className="text-xs rounded-lg px-3 py-1.5"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function StaffRow({
  person,
  busy,
  readOnly,
  orgType,
  words,
  onChangeRole,
  onRemove,
  onSavePrivileges,
}) {
  const changeable = canChangeStaff(person);
  const nextRole = otherStaffRole(person.role);
  // Absent rather than an em dash: `users.email` is nullable by design (an
  // account created through Google carries none), and a dash where an address
  // belongs reads as a value that failed to load.
  const meta = [
    person.email,
    person.roleName || roleLabel(person.role, orgType),
    `since ${formatJoinedAt(person.since)}`,
  ]
    .filter((part) => typeof part === 'string' && part !== '')
    .join(' · ');

  return (
    <div
      data-testid={`staff-${person.userId}`}
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate" style={{ color: '#fff' }}>
            {person.displayName}
            {person.isYou ? (
              <span className="ml-2 text-xs font-normal" style={{ color: 'rgba(255,255,255,0.45)' }}>
                (you)
              </span>
            ) : null}
          </div>
          <div className="text-xs mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {meta}
          </div>
        </div>

        {changeable ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-shrink-0">
            {nextRole !== null ? (
              <RoleChangeControl
                person={person}
                nextRole={nextRole}
                busy={busy}
                readOnly={readOnly}
                orgType={orgType}
                onConfirm={onChangeRole}
              />
            ) : null}
            <RemoveControl
              person={person}
              busy={busy}
              readOnly={readOnly}
              words={words}
              onRemove={onRemove}
            />
          </div>
        ) : (
          /* THE OWNER'S ROW GETS THE REASON, NOT TWO DEAD BUTTONS. Both mutations
             refuse it — the role change with `owner_role_locked`, the removal with
             `last_owner` — and both refusals come from the same fact: nothing in
             the product can appoint a second owner, so every owner is the LAST
             owner. A greyed control over a guaranteed refusal is the defect §2.2's
             own rules warn about; a sentence states the rule instead. */
          <span
            className="text-xs flex-shrink-0 sm:text-right"
            style={{ color: 'rgba(255,255,255,0.35)' }}
          >
            A {words.it} can&apos;t be left with nobody in charge.
          </span>
        )}
      </div>

      {/* THE TICKS SIT UNDER THE PERSON THEY BELONG TO, on every row including
          the owner's — read-only there. Kd's ruling is per-STAFF-MEMBER, so a
          screen that put them anywhere else would be describing a different
          feature. */}
      <PrivilegesControl
        person={person}
        busy={busy}
        readOnly={readOnly}
        orgType={orgType}
        onSave={onSavePrivileges}
      />
    </div>
  );
}

/** THE INVITATIONS (4a-i): each address, its role, where it stands and whether its email
 *  went, with Send again (4a-ii) and Cancel (or Remove, for one that ended or was
 *  declined). Nothing is drawn when there are none. */
function InvitedList({ invites, orgType, busyId, readOnly, onCancel, onResend }) {
  if (invites.loading) return null;
  if (invites.error !== null) {
    return (
      <p className="text-xs" style={{ color: '#ef4444' }}>
        {invites.error}
      </p>
    );
  }
  if (invites.list.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="staff-invites">
      <h3 className="text-xs font-semibold uppercase tracking-wide mt-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
        Invited
      </h3>
      {invites.list.map((invite) => {
        const view = staffInviteView(invite, orgType);
        return (
          <div
            key={invite.id}
            data-testid={`staff-invite-${invite.id}`}
            className="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
            style={{ background: '#121110', border: '1px dashed rgba(255,255,255,0.12)' }}
          >
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate" style={{ color: '#fff' }}>
                {view.title}
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {view.meta}
              </div>
              {view.email !== null ? (
                <div className="text-xs mt-0.5" style={{ color: view.emailProblem ? '#f59e0b' : 'rgba(255,255,255,0.45)' }}>
                  {view.email}
                </div>
              ) : null}
              {view.sendAgainNote !== null ? (
                <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {view.sendAgainNote}
                </div>
              ) : null}
            </div>
            <div className="self-start sm:self-center flex gap-2 flex-shrink-0">
              {view.canSendAgain ? (
                <button
                  type="button"
                  onClick={() => onResend(invite)}
                  disabled={busyId === invite.id || readOnly}
                  className="text-xs rounded-lg px-3 py-1.5 font-semibold disabled:opacity-40"
                  style={{ background: 'rgba(249,115,22,0.15)', color: '#f97316' }}
                >
                  Send again
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onCancel(invite)}
                disabled={busyId === invite.id || readOnly}
                className="text-xs rounded-lg px-3 py-1.5 disabled:opacity-40"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
              >
                {view.action}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function StaffPanel({ gymId, privileges, orgType, readOnly = false }) {
  const allowed = canManageStaff(privileges);
  // The words this panel speaks (roadmap 2b).
  const words = orgWords(orgType);

  const [state, setState] = useState({ loading: true, error: null, staff: [] });
  const [attempt, setAttempt] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  // TRAINER IS THE DEFAULT because it is the smaller of the two grants. A form
  // that opens on the more powerful role hands out more authority to an owner
  // who does not read it, and this form's whole subject is authority.
  const [role, setRole] = useState('trainer');
  const [ticks, setTicks] = useState(() => roleTicks('trainer'));
  const [fieldError, setFieldError] = useState(null);
  // The invitations waiting, ended or declined (4a-i). Their own read and failure: a
  // list that cannot be read must not hide who already runs the gym.
  const [invites, setInvites] = useState({ loading: true, error: null, list: [] });
  // The gym's own roles (Kd, RULINGS 2026-10-01), offered beside Manager and Trainer.
  const [roles, setRoles] = useState([]);
  // What the last invitation did: "Invitation sent to …" or "… is now a manager".
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!allowed || gymId === null) return undefined;
    let cancelled = false;
    orgService
      .getStaffRoles(gymId)
      .then((res) => {
        if (!cancelled) setRoles(res.data?.roles ?? []);
      })
      .catch(() => {
        // The form still offers Manager and Trainer; a role of the gym's own can be picked
        // once the list reads.
      });
    orgService
      .getStaffInvites(gymId)
      .then((res) => {
        if (!cancelled) setInvites({ loading: false, error: null, list: res.data?.invites ?? [] });
      })
      .catch((err) => {
        if (!cancelled) {
          setInvites({ loading: false, error: errorText(err, "We couldn't load your invitations."), list: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [gymId, attempt, allowed]);

  useEffect(() => {
    // Not merely a UI guard: without it a manager's Settings screen would fire a
    // request the server answers 404, and the panel would render nothing while
    // an error sat in the network tab.
    if (!allowed || gymId === null) return undefined;
    let cancelled = false;
    orgService
      .getStaff(gymId)
      .then((res) => {
        if (cancelled) return;
        setState({ loading: false, error: null, staff: res.data?.staff ?? [] });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: errorText(err, `We couldn't load who runs this ${words.it}.`),
          staff: [],
        });
      });
    return () => {
      cancelled = true;
    };
  }, [gymId, attempt, allowed, words]);

  if (!allowed) return null;

  /** Every change re-reads from the server rather than patching the row it has
   *  in hand. The list IS the server's answer — it carries `isYou`, the eligibility
   *  rule and the ordering — and a screen that edits its own copy is a screen
   *  that can disagree with the next reload. */
  const reload = () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    setAttempt((n) => n + 1);
  };

  const retry = () => {
    setActionError(null);
    reload();
  };

  const changeRole = async (person) => {
    const next = otherStaffRole(person.role);
    if (gymId === null || next === null) return;
    setBusyId(person.userId);
    setActionError(null);
    try {
      await orgService.updateStaffRole(gymId, person.userId, { role: next });
      reload();
    } catch (err) {
      setActionError({
        message: errorText(err, "We couldn't change what they can do. Please try again."),
        retryable: isRetryable(err),
      });
    } finally {
      setBusyId(null);
    }
  };

  /** SAVING THE TICKS. Returns whether it landed, so the control can close on
   *  success and stay open — with what the owner ticked still on screen — when
   *  it did not. Closing on a refusal would throw away the edit and hide the
   *  sentence explaining why, which is the join-code editor's recorded defect
   *  (:14174 L-7) and the same rule the add form follows above.
   *
   *  **The two refusals only this route gives are shown in the SERVER's own
   *  words**: `owner_only_privilege` ("Managing staff stays with the gym's
   *  owner…") and `last_owner_locked` ("A gym's last owner has to keep both
   *  staff management and billing…"). Both are already sentences a person can
   *  read, and re-wording them here is how the screen and the door drift apart.
   *
   *  **That drift is not hypothetical — it happened to this very comment.** The
   *  server's sentence changed when `billing.manage` joined the guard, and this
   *  block went on quoting the old one until T3 round 2 (Low-3). **Nothing a user
   *  sees was affected, precisely because the panel prints `errorText` from the
   *  server rather than a copy** — which is the rule this paragraph exists to
   *  state, vindicated by its own comment going stale.
   *
   *  **No Try again** (the rule the add form and the half-done removal already
   *  follow): `retry` re-reads the LIST, which cannot save anything, and both
   *  refusals above are permanent for the set that was sent — a button offering
   *  to redo them would be promising something it does not do. */
  const savePrivileges = async (person, privileges) => {
    if (gymId === null) return false;
    setBusyId(person.userId);
    setActionError(null);
    try {
      await orgService.updateStaffPrivileges(gymId, person.userId, { privileges });
      reload();
      return true;
    } catch (err) {
      setActionError({
        message: errorText(err, "We couldn't save those permissions. Please try again."),
        retryable: false,
      });
      return false;
    } finally {
      setBusyId(null);
    }
  };

  /** KD'S RULING, IMPLEMENTED AS TWO CALLS IN A FIXED ORDER.
   *
   *  The failure that matters is the SECOND one: the keys are already gone and
   *  the membership is not. That is a real state and the screen SAYS so — it
   *  does not report the whole thing as a failure (the first half landed, and
   *  claiming otherwise would send an owner to undo something that already
   *  happened), and it does not swallow it (an owner who thinks somebody is out
   *  of their gym when they are not is the exact outcome this control exists to
   *  prevent). It names the Members screen, which is where the remaining half
   *  can be finished. */
  const removePerson = async (person, alsoRemoveFromGym) => {
    if (gymId === null) return;
    setBusyId(person.userId);
    setActionError(null);
    try {
      await orgService.removeStaff(gymId, person.userId);
    } catch (err) {
      setActionError({
        message: errorText(err, "We couldn't take their keys back. Please try again."),
        retryable: isRetryable(err),
      });
      setBusyId(null);
      return;
    }
    if (alsoRemoveFromGym) {
      try {
        await orgService.removeMember(gymId, person.userId);
      } catch (err) {
        // THE INSTRUCTION IS UNCONDITIONAL AND THE REASON IS APPENDED, not the
        // other way round. Putting "you can finish this on the Members screen"
        // inside `errorText`'s fallback loses it exactly when it is needed most:
        // a dropped connection HAS no server sentence, so the fallback never
        // runs and the owner is left holding half a change with no next step.
        // NO RETRY ON THIS ONE (T3 Low). The failed half was `removeMember`, and
        // `retry` re-reads the STAFF LIST — it cannot finish the membership, so a
        // Try again here offers to redo something it does not do. The sentence
        // already names the surface that can (Members), which is the honest
        // next step.
        setActionError({
          message:
            `${person.displayName} no longer runs your ${words.it}, but they are still a ${words.person} of it. ` +
            `${errorText(err, `We couldn't remove them from the ${words.it}.`)} ` +
            `You can remove them on the ${words.peopleCap} screen.`,
          retryable: false,
        });
      }
    }
    setBusyId(null);
    reload();
  };

  const add = async () => {
    const value = email.trim();
    if (value === '') {
      setFieldError('Type the email address they use for the app.');
      return;
    }
    // The server's refusals of a bad address are raw (`email: invalid_string`), so the
    // form says it first in words: sign-in's own rule (`authEmailSchema`, at most 254)
    // is an email shape, and this is the same rough shape.
    if (value.length < 3) {
      setFieldError('That looks too short for an email address.');
      return;
    }
    if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setFieldError("That doesn't look like an email address.");
      return;
    }
    if (gymId === null) return;
    setFieldError(null);
    setBusyId('add');
    setActionError(null);
    setNotice(null);
    try {
      const own = roles.find((r) => r.id === role) ?? null;
      const base = own === null ? role : 'trainer';
      const res = await orgService.inviteStaff(gymId, {
        email: value,
        role: base,
        privileges: inviteTicks(base, ticks, orgType),
        ...(own === null ? {} : { roleId: own.id }),
      });
      const done = res.data;
      setNotice(
        done.outcome === 'added'
          ? `${done.staff.displayName} is now ${withArticle(done.staff.roleName || (done.staff.role === 'manager' ? 'manager' : words.coach))} here.`
          : `Invited ${done.invite.email}. We're sending the email now; the invitation works for 7 days.`,
      );
      setEmail('');
      setRole('trainer');
      setTicks(roleTicks('trainer'));
      setAdding(false);
      reload();
    } catch (err) {
      // THE FORM STAYS OPEN AND THE TYPING SURVIVES. Closing it on a refusal
      // discards what the owner typed and hides the sentence explaining why —
      // the join-code editor shipped that defect and it has its own recorded
      // finding. The server's own message is what gets shown: "Nobody in this
      // gym has that email address…" names the fix better than a rewrite could.
      // NO RETRY (T3 Low): the FORM is the retry surface and it stays open with
      // the typing in it. `retry` re-reads the list, which cannot add anybody —
      // and over the `not_a_member` 404 (the commonest refusal here) it would
      // promise that pressing a button fixes an address that is simply not in
      // this gym.
      setActionError({
        message: errorText(err, "We couldn't send that invitation. Please try again."),
        retryable: false,
      });
    } finally {
      setBusyId(null);
    }
  };

  const chooseRole = (key) => {
    setRole(key);
    const own = roles.find((r) => r.id === key);
    setTicks(own ? [...own.privileges] : roleTicks(key));
  };

  /** Save a role of the gym's own and choose it. Returns null, or the reason it was refused. */
  const makeRole = async (name, privileges) => {
    if (gymId === null) return 'Please try again.';
    setBusyId('add');
    try {
      const res = await orgService.createStaffRole(gymId, { name, privileges: inviteTicks('trainer', privileges, orgType) });
      const made = res.data.role;
      setRoles((prev) => [...prev, made].sort((a, b) => a.name.localeCompare(b.name)));
      setRole(made.id);
      setTicks([...made.privileges]);
      return null;
    } catch (err) {
      return errorText(err, "We couldn't save that role. Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const deleteRole = async (roleId) => {
    if (gymId === null) return;
    setBusyId('add');
    setActionError(null);
    try {
      await orgService.deleteStaffRole(gymId, roleId);
      setRoles((prev) => prev.filter((r) => r.id !== roleId));
      if (role === roleId) chooseRole('trainer');
    } catch (err) {
      setActionError({ message: errorText(err, "We couldn't delete that role. Please try again."), retryable: false });
    } finally {
      setBusyId(null);
    }
  };

  const resendInvite = async (invite) => {
    if (gymId === null) return;
    setBusyId(invite.id);
    setActionError(null);
    setNotice(null);
    try {
      const res = await orgService.resendStaffInvite(gymId, invite.id);
      setNotice(sentAgainNotice(res.data.invite));
      reload();
    } catch (err) {
      // The server's sentence says why and what to do (a bounced address, the week's
      // three, still sending); pressing again would get the same answer.
      setActionError({
        message: errorText(err, "We couldn't send that invitation again. Please try again."),
        retryable: false,
      });
    } finally {
      setBusyId(null);
    }
  };

  const cancelInvite = async (invite) => {
    if (gymId === null) return;
    setBusyId(invite.id);
    setActionError(null);
    setNotice(null);
    try {
      await orgService.cancelStaffInvite(gymId, invite.id);
      reload();
    } catch (err) {
      setActionError({
        message: errorText(err, "We couldn't cancel that invitation. Please try again."),
        retryable: isRetryable(err),
      });
    } finally {
      setBusyId(null);
    }
  };

  const countLabel = staffCountLabel(state.staff, orgType);

  return (
    /* CLOSED BY DEFAULT (Kd, 2026-08-26) — and this panel is the one that NEEDS
       `forceOpen`. It reads the staff list on mount whether the section is open
       or not, so a failed read can arrive while nobody is looking; a closed row
       over that error card would say nothing at all, which is worse than the
       error and is the silence :12660 was ruled on. A failure opens the section
       and keeps it open.
       THE COUNT STAYS ON THE CLOSED HEADING because it is the one number an
       owner glances at — and the withholding is `staffCountLabel`'s job, not
       this line's. It was written here as `!state.loading && state.error ===
       null ? countLabel : null` and mutant C71 came back ALIVE against it: on
       both of those paths `state.staff` is `[]`, and `staffCountLabel([])` is
       already null, so the condition could never change what reaches the screen.
       **Two guards, either one sufficient, and therefore neither falsifiable —
       :12343's J11 exactly, fixed the way that entry fixed it: in the SOURCE, so
       ONE line does the work.** The guarantee ("0 people run this gym" is never
       a true sentence about a gym) lives in `staffCountLabel`, which asserts the
       empty case and now carries the mutant for it too. */
    <ConsoleSection
      title="Staff"
      summary={`Who can help you run this ${words.it}. ${staffSeatsNote(orgType)}`}
      aside={countLabel}
      forceOpen={!state.loading && state.error !== null}
    >
      {state.loading ? <ConsoleLoading label={`Loading who runs this ${words.it}…`} /> : null}

      {!state.loading && state.error !== null ? (
        <ConsoleFailed message={state.error} onRetry={retry} />
      ) : null}

      {actionError !== null ? (
        <div className="mb-3">
          <ConsoleFailed
            message={actionError.message}
            onRetry={actionError.retryable ? retry : undefined}
          />
        </div>
      ) : null}

      {readOnly ? (
        <p className="mb-3 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {readOnlyNote(orgType)}
        </p>
      ) : null}

      {notice !== null ? (
        <p role="status" className="mb-3 text-sm" style={{ color: '#22c55e' }}>
          {notice}
        </p>
      ) : null}

      {!state.loading && state.error === null ? (
        <div className="flex flex-col gap-3">
          {state.staff.map((person) => (
            <StaffRow
              key={person.userId}
              person={person}
              busy={busyId === person.userId}
              readOnly={readOnly}
              orgType={orgType}
              words={words}
              onChangeRole={() => changeRole(person)}
              onRemove={(alsoRemoveFromGym) => removePerson(person, alsoRemoveFromGym)}
              onSavePrivileges={(privileges) => savePrivileges(person, privileges)}
            />
          ))}

          <InvitedList
            invites={invites}
            orgType={orgType}
            busyId={busyId}
            readOnly={readOnly}
            onCancel={cancelInvite}
            onResend={resendInvite}
          />

          {adding ? (
            <AddStaffForm
              orgType={orgType}
              email={email}
              setEmail={setEmail}
              role={role}
              onChooseRole={chooseRole}
              roles={roles}
              onMakeRole={makeRole}
              onDeleteRole={deleteRole}
              ticks={ticks}
              setTicks={setTicks}
              fieldError={fieldError}
              busy={busyId === 'add'}
              readOnly={readOnly}
              onAdd={add}
              onCancel={() => {
                setAdding(false);
                setFieldError(null);
                setActionError(null);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                setNotice(null);
              }}
              disabled={readOnly}
              className="self-start rounded-xl px-4 py-2 text-sm font-medium flex items-center gap-2 disabled:opacity-40"
              style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
            >
              <Plus className="w-4 h-4" />
              Invite staff
            </button>
          )}
        </div>
      ) : null}
    </ConsoleSection>
  );
}
