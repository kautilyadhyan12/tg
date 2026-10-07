import { useEffect, useRef, useState } from 'react';
import { STAFF_ROLE_NAME_MAX } from '@app/shared';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { ConfirmInline, ConsoleFailed } from '../../components/console/ConsoleStates';
import { readOnlyNote } from './billingView';
import { formatJoinedAt, staffRoleText } from './consoleView';
import {
  carriedNote,
  carriedPrivileges,
  effectivePrivileges,
  heldPrivileges,
  inviteTicks,
  privilegeChoices,
  privilegesDiffer,
  roleTargets,
  roleTicks,
  staffRoleChoices,
} from './staffView';
import { Tick } from './MemberListPanel';

// The two panels of Members → Staff (ROADMAP 23c-ii): Invite staff, and one person who
// runs the gym. Both open over the page from the right, as a member's page does.

const TICK = { accentColor: 'var(--accent)' };
const LINE = { borderColor: 'var(--line)' };

/** Bring a question into view when it opens: it is drawn under the button that asked. */
function useInView(open) {
  const ref = useRef(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);
  return ref;
}

// `foot`: what stays at the bottom of the panel however far it is scrolled (the form's
// buttons, so Send is never below the fold).
function Panel({ label, title, sub = null, foot = null, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50" style={{ background: 'var(--scrim)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="c-sheet absolute inset-0 md:left-auto md:w-[520px] md:border-l flex flex-col overflow-y-auto"
        style={{ borderColor: 'var(--card-line)' }}
      >
        <div className="flex items-start gap-3 px-4 pt-5 pb-4 md:px-7 md:pt-7 md:pb-5 border-b" style={LINE}>
          <div className="flex flex-col gap-1 flex-grow min-w-0">
            <h2 className="c-h1 break-words" style={{ fontSize: 28, lineHeight: '34px' }}>
              {title}
            </h2>
            {sub}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="c-icon-btn">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="flex flex-col gap-5 px-4 py-5 md:px-7">{children}</div>
        {foot !== null ? (
          <div className="sticky bottom-0 mt-auto flex flex-col gap-3 px-4 py-3 md:px-7 md:py-4 border-t" style={{ ...LINE, background: 'var(--sheet)' }}>
            {foot}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A refusal, said under the button that was pressed and brought into view there. */
function Refusal({ error, onRetry }) {
  const ref = useInView(error !== null);
  if (error === null) return null;
  return (
    <div ref={ref}>
      <ConsoleFailed message={error.message} onRetry={error.retryable ? onRetry : undefined} newLook />
    </div>
  );
}

/** The tick boxes: each permission in words, with what it lets the person do. */
function TickList({ choices, ticked, disabled, onToggle, testId }) {
  return (
    <div className="flex flex-col" data-testid={testId}>
      {choices.map((choice) => {
        const on = ticked.includes(choice.value);
        return (
          <label key={choice.value} className="flex items-start gap-3 min-h-11 py-1.5 c-s15 c-t1">
            <input
              type="checkbox"
              className="w-[18px] h-[18px] mt-0.5 flex-shrink-0"
              style={TICK}
              checked={on}
              disabled={disabled}
              onChange={() => onToggle(choice.value)}
            />
            <span className="flex flex-col gap-0.5">
              <span>{choice.label}</span>
              <span className="c-s13 c-t2">{choice.hint}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** INVITE STAFF (spec Part 3 §10.3): the email; the role, as one row of choices (Manager,
 *  Trainer, the gym's own roles and New role); and what that role can do, ticked underneath
 *  for the owner to change before sending. The server emails an invitation, or makes
 *  somebody already in this gym staff at once; its reply is the same whether or not the
 *  address has an account.
 *
 *  Trainer is the starting role because it is the smaller grant. `readOnly` (a gym with no
 *  plan) reaches every field and Send; Cancel stays pressable. A refusal is said here,
 *  beside the button, with the typing kept. */
export function StaffInvitePanel({ orgType, words, roles, readOnly, busy, error, onSend, onMakeRole, onDeleteRole, onClose }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('trainer');
  const [ticks, setTicks] = useState(() => roleTicks('trainer'));
  const [fieldError, setFieldError] = useState(null);
  // Making a role: its name; the boxes below are its ticks.
  const [newRole, setNewRole] = useState(null);
  const [deleting, setDeleting] = useState(null);
  // A role just saved is chosen in the row of roles, which may be scrolled out of the
  // panel by then: counted, so the row is brought back into view each time.
  const [rolesSaved, setRolesSaved] = useState(0);
  const rolesRow = useRef(null);
  useEffect(() => {
    if (rolesSaved > 0) rolesRow.current?.scrollIntoView?.({ block: 'nearest' });
  }, [rolesSaved]);

  const builtIn = staffRoleChoices(orgType);
  const own = roles.find((r) => r.id === role) ?? null;
  // A role of the gym's own is a trainer's underneath: every box but Manage staff.
  const base = own === null ? role : 'trainer';
  const off = busy || readOnly;
  const hint = newRole !== null ? null : own !== null ? 'One of your own roles.' : (builtIn.find((c) => c.value === role)?.hint ?? null);

  const chooseRole = (key) => {
    setNewRole(null);
    setDeleting(null);
    setRole(key);
    const picked = roles.find((r) => r.id === key);
    setTicks(picked ? [...picked.privileges] : roleTicks(key));
  };
  const toggle = (value) => setTicks((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

  const saveRole = async () => {
    const name = (newRole?.name ?? '').replace(/\s+/g, ' ').trim();
    if (name === '') {
      setNewRole({ name: newRole?.name ?? '', error: 'Give the role a name.' });
      return;
    }
    const answer = await onMakeRole(name, inviteTicks('trainer', ticks, orgType));
    if (answer.role) {
      setNewRole(null);
      setRole(answer.role.id);
      setTicks([...answer.role.privileges]);
      setRolesSaved((n) => n + 1);
    } else {
      setNewRole({ name, error: answer.error });
    }
  };

  const send = () => {
    const value = email.trim();
    if (value === '') {
      setFieldError('Type the email address they use for the app.');
      return;
    }
    // The server's refusals of a bad address are raw (`email: invalid_string`), so the
    // form says it first in words, on sign-in's own rule (an email shape, at most 254).
    if (value.length < 3) {
      setFieldError('That looks too short for an email address.');
      return;
    }
    if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setFieldError("That doesn't look like an email address.");
      return;
    }
    setFieldError(null);
    onSend({
      email: value,
      role: base,
      privileges: inviteTicks(base, ticks, orgType),
      ...(own === null ? {} : { roleId: own.id }),
    });
  };

  const deletingRole = deleting === null ? null : (roles.find((r) => r.id === deleting) ?? null);
  const refusal = error !== null ? <ConsoleFailed message={error.message} newLook /> : null;

  const foot =
    newRole !== null ? (
      <>
        {refusal}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void saveRole()} disabled={off} className="c-btn c-btn-p">
            {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            Save role
          </button>
          <button type="button" onClick={() => setNewRole(null)} disabled={busy} className="c-btn c-btn-s">
            Cancel
          </button>
        </div>
      </>
    ) : (
      <>
        {fieldError !== null ? (
          <p className="c-s14 m-0" role="alert" style={{ color: 'var(--bad)' }}>
            {fieldError}
          </p>
        ) : null}
        {refusal}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={send} disabled={off} className="c-btn c-btn-p">
            {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            Send invitation
          </button>
          <button type="button" onClick={onClose} disabled={busy} className="c-btn c-btn-s">
            Cancel
          </button>
        </div>
      </>
    );

  return (
    <Panel label="Invite staff" title="Invite staff" foot={foot} onClose={onClose}>
      {/* The panel covers the page, so it says itself why its controls are grey. */}
      {readOnly ? <p className="c-s14 c-t2 m-0">{readOnlyNote(orgType)}</p> : null}
      <div className="c-field">
        <label className="c-label" htmlFor="staff-email">
          Their email address
        </label>
        <input
          id="staff-email"
          type="email"
          className="c-input"
          value={email}
          disabled={off}
          placeholder="name@example.com"
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div ref={rolesRow} className="c-field">
        <span id="staff-role-label" className="c-label">
          Role
        </span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="staff-role-label">
          {builtIn.map((choice) => {
            const selected = newRole === null && role === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={off}
                onClick={() => chooseRole(choice.value)}
                className={`${selected ? 'c-chip c-chip-on' : 'c-chip'} disabled:opacity-50`}
              >
                {choice.label}
              </button>
            );
          })}
          {roles.map((r) => {
            const selected = newRole === null && role === r.id;
            return (
              <span key={r.id} className={selected ? 'c-chip c-chip-on' : 'c-chip'} style={{ paddingRight: 0 }}>
                <button type="button" role="radio" aria-checked={selected} disabled={off} onClick={() => chooseRole(r.id)} className="self-stretch -my-px flex items-center disabled:opacity-50">
                  {r.name}
                </button>
                <button
                  type="button"
                  aria-label={`Delete the role ${r.name}`}
                  disabled={off}
                  onClick={() => setDeleting(r.id)}
                  className="self-stretch -my-px flex items-center justify-center w-11 md:w-8 disabled:opacity-50"
                >
                  <X aria-hidden="true" className="w-3.5 h-3.5" />
                </button>
              </span>
            );
          })}
          <button
            type="button"
            disabled={off}
            aria-pressed={newRole !== null}
            onClick={() => {
              setDeleting(null);
              setNewRole({ name: '', error: null });
            }}
            className={`${newRole !== null ? 'c-chip c-chip-on' : 'c-chip'} disabled:opacity-50`}
          >
            <Plus aria-hidden="true" className="w-3.5 h-3.5" />
            New role
          </button>
        </div>

        {deletingRole !== null ? (
          <div className="rounded-[14px] p-3" style={{ background: 'var(--raise)' }} role="alert">
            <ConfirmInline
              newLook
              question={`Delete the role ${deletingRole.name}? Staff who have it keep it and what they can do.`}
              confirmLabel="Delete role"
              busy={busy}
              onConfirm={async () => {
                const id = deletingRole.id;
                setDeleting(null);
                if ((await onDeleteRole(id)) && role === id) chooseRole('trainer');
              }}
              onCancel={() => setDeleting(null)}
            />
          </div>
        ) : null}

        {hint !== null ? <span className="c-hint">{hint}</span> : null}
      </div>

      {newRole !== null ? (
        <div className="c-field">
          <label className="c-label" htmlFor="staff-new-role">
            Role name
          </label>
          <input
            id="staff-new-role"
            className="c-input"
            value={newRole.name}
            maxLength={STAFF_ROLE_NAME_MAX}
            placeholder="Front desk"
            onChange={(e) => setNewRole({ name: e.target.value, error: null })}
          />
          <span className="c-hint">Tick what this role can do below, then save it. You can use it again next time.</span>
          {newRole.error ? (
            <p className="c-s14 m-0" role="alert" style={{ color: 'var(--bad)' }}>
              {newRole.error}
            </p>
          ) : null}
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-1 m-0 p-0 border-0 min-w-0">
        <legend className="c-label p-0">What they can do</legend>
        <TickList choices={privilegeChoices(base, orgType)} ticked={ticks} disabled={off} onToggle={toggle} testId="invite-ticks" />
      </fieldset>

      {newRole === null ? (
        <p className="c-s14 c-t2 m-0">
          We&apos;ll email them an invitation. They sign in with this address and press Accept, and they can open your{' '}
          {words.it}&apos;s console. If they&apos;re already a {words.person} of your {words.it}, they get these permissions
          straight away. You can change what they can do at any time. Managing staff stays with you.
        </p>
      ) : null}
    </Panel>
  );
}

/** A person's role, and a button for each other role they can be given: manager, trainer
 *  and the gym's own roles (`roleTargets`). A change asks first, because it replaces their
 *  ticks with the new role's: the question is the target's own. */
function RoleSection({ person, roles, orgType, words, off, error, onRetry, onChange }) {
  const [asking, setAsking] = useState(null);
  const targets = roleTargets(person, roles, orgType);
  // A role that went from the list while its question was open has no question any more.
  const target = asking === null ? null : (targets.find((t) => t.key === asking) ?? null);
  const question = useInView(target !== null);
  if (person.role === 'owner') return null;
  return (
    <section className="flex flex-col gap-3 pt-5 border-t" style={LINE} data-testid="staff-role">
      <h3 className="c-h3">Role</h3>
      {target === null ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="c-s15 c-t1">{staffRoleText(person.role, person.roleName ?? null, words)}</span>
          <div className="flex flex-wrap gap-2">
            {targets.map((t) => (
              <button key={t.key} type="button" onClick={() => setAsking(t.key)} disabled={off} className="c-btn c-btn-s c-btn-sm">
                {t.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div ref={question} className="flex flex-col gap-3">
          <p className="c-s14 c-t1 m-0">{target.question}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setAsking(null);
                onChange(target);
              }}
              disabled={off}
              className="c-btn c-btn-sm c-btn-p"
            >
              {target.label}
            </button>
            <button type="button" onClick={() => setAsking(null)} className="c-btn c-btn-sm c-btn-s">
              Cancel
            </button>
          </div>
        </div>
      )}
      <Refusal error={error} onRetry={onRetry} />
    </section>
  );
}

/** WHAT THIS PERSON CAN DO: a box for each permission this row may be given, ticked from
 *  what the server holds.
 *
 *  What is sent is the WHOLE set, every time: the boxes as they stand, plus the ticks held
 *  that have no box on this row (`carriedPrivileges`), which travel through untouched.
 *  "Manage staff" is the owner's alone, so a row that is not the owner's has no box for it
 *  and is saved without it.
 *
 *  An edit not yet saved belongs to the set it was made over: when the server's set for
 *  this person changes (a save, a role change), the edit is dropped and the boxes are the
 *  server's again. The owner's row is drawn and cannot be changed. */
function PermissionsSection({ person, orgType, busy, readOnly, error, onSave }) {
  const current = effectivePrivileges(person);
  const held = `${person.role}|${Array.isArray(person.privileges) ? [...person.privileges].sort().join(',') : 'role'}`;
  const [draft, setDraft] = useState(null);
  const [over, setOver] = useState(held);
  const [outcome, setOutcome] = useState(null);
  const said = useInView(outcome === 'saved' || outcome === 'differs');
  if (over !== held) {
    setOver(held);
    setDraft(null);
  }

  const ownerRow = person.role === 'owner';
  const isSelf = person.isYou === true;
  const choices = privilegeChoices(person.role, orgType);
  const offered = choices.map((choice) => choice.value);
  const ticked = (draft ?? current).filter((value) => offered.includes(value));
  const whole = [...ticked, ...carriedPrivileges(person, orgType)];
  // Whether the set that would be sent differs from the one held.
  const dirty = !ownerRow && privilegesDiffer(heldPrivileges(person), whole);
  const extraNote = carriedNote(person, orgType);

  const toggle = (value) => {
    if (ownerRow) return;
    setOutcome(null);
    setDraft((prev) => {
      const from = prev ?? current;
      return from.includes(value) ? from.filter((v) => v !== value) : [...from, value];
    });
  };

  const save = async () => {
    const answer = await onSave(whole);
    if (answer === 'refused') return;
    setDraft(null);
    setOutcome(answer);
  };

  return (
    <section className="flex flex-col gap-3 pt-5 border-t" style={LINE} data-testid={`privileges-${person.userId}`}>
      <h3 className="c-h3">{isSelf ? 'What you can do' : 'What they can do'}</h3>
      <TickList choices={choices} ticked={ticked} disabled={busy || ownerRow || readOnly} onToggle={toggle} />
      {extraNote !== null ? <p className="c-s14 c-t2 m-0">{extraNote}</p> : null}
      {ownerRow ? (
        <p className="c-s14 c-t2 m-0">
          {isSelf ? 'This is what you can do.' : 'This is what the owner can do.'} It can&apos;t be changed here: a gym has to
          keep somebody who can manage its staff.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || readOnly || !dirty} onClick={() => void save()} className="c-btn c-btn-p">
              {busy ? 'Saving…' : 'Save permissions'}
            </button>
            {dirty && draft !== null ? (
              <button type="button" onClick={() => setDraft(null)} disabled={busy} className="c-btn c-btn-s">
                Cancel
              </button>
            ) : null}
          </div>
          {outcome === 'saved' ? (
            <p ref={said} className="c-s14 c-w5 m-0 flex items-center gap-2" style={{ color: 'var(--good)' }} role="status">
              <Check aria-hidden="true" className="w-4 h-4" />
              Permissions saved.
            </p>
          ) : null}
          {/* The server answered yes and holds another set: the boxes are its, and it is said. */}
          {outcome === 'differs' ? (
            <p ref={said} className="c-s14 m-0" style={{ color: 'var(--warn)' }} role="alert">
              Not everything was kept. The boxes show what they can do now.
            </p>
          ) : null}
          <Refusal error={error} />
        </>
      )}
    </section>
  );
}

/** Remove from staff, and, ticked, from the app in the same step. The owner cannot be
 *  removed: a gym is never left with nobody in charge. */
function RemoveSection({ person, words, off, error, onRemove }) {
  const [asking, setAsking] = useState(false);
  const [alsoApp, setAlsoApp] = useState(false);
  const question = useInView(asking);
  const name = person.displayName;
  return (
    <section className="flex flex-col gap-3 pt-5 border-t" style={LINE} data-testid="staff-remove">
      {person.role === 'owner' ? (
        <p className="c-s14 c-t2 m-0">The owner runs the {words.it} and can&apos;t be removed from staff.</p>
      ) : !asking ? (
        <button type="button" onClick={() => setAsking(true)} disabled={off} className="c-btn c-btn-s self-start">
          Remove from staff
        </button>
      ) : (
        <div ref={question} className="flex flex-col gap-3">
          <p className="c-s14 c-t1 m-0">Remove {name} from staff? They can&apos;t open the console any more.</p>
          {person.isMember ? (
            <div className="flex items-start gap-2">
              <Tick state={alsoApp ? 'on' : 'off'} label={`Also remove ${name} from the app`} onClick={() => setAlsoApp((on) => !on)} />
              <span className="flex flex-col gap-0.5 cursor-pointer" onClick={() => setAlsoApp((on) => !on)}>
                <span className="c-s14 c-w6 c-t1">Also remove {name} from the app</span>
                <span className="c-s13 c-t2">
                  {!alsoApp
                    ? `They keep using the app as a ${words.person}.`
                    : person.movesRecord
                      ? `They'll be moved to past ${words.people} and lose access to your ${words.it} in the app too. Their own workout history isn't affected, and you can put them back at any time.`
                      : `They lose access to your ${words.it} in the app too. Their own workout history isn't affected.`}
                </span>
              </span>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setAsking(false);
                onRemove({ alsoApp: person.isMember === true && alsoApp });
              }}
              disabled={off}
              className="c-btn c-btn-sm c-btn-danger"
            >
              {alsoApp ? 'Remove from staff and app' : 'Remove from staff'}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="c-btn c-btn-sm c-btn-s">
              Cancel
            </button>
          </div>
        </div>
      )}
      <Refusal error={error} />
    </section>
  );
}

/** One person who runs the gym, opened: who they are, their role, what they can do, and
 *  Remove from staff. A change that is refused is said in its own part of the panel,
 *  under the button that was pressed (`error.at`). */
export function StaffPersonPanel({ person, roles, orgType, words, readOnly, busy, error, onRetry, onClose, onChangeRole, onSavePrivileges, onRemove }) {
  const off = busy || readOnly;
  return (
    <Panel label={person.displayName} title={person.displayName} sub={person.email ? <span className="c-s14 c-t2 break-words">{person.email}</span> : null} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <span className="flex flex-wrap gap-1.5">
          <span className="c-tag c-tag-soft">{staffRoleText(person.role, person.roleName ?? null, words)}</span>
          {person.isMember ? <span className="c-tag c-tag-good">Uses the app</span> : null}
        </span>
        <p className="c-s14 c-t2 m-0" data-testid="staff-place-line">
          {person.isMember
            ? `Uses the member app here, which takes one of your places, like any ${words.person}.`
            : 'Uses the console only, which is free. Not in the member app here.'}
        </p>
        <p className="c-s14 c-t2 m-0">On the staff since {formatJoinedAt(person.since)}</p>
        {/* The panel covers the page, so it says itself why its controls are grey. */}
        {readOnly ? <p className="c-s14 c-t2 m-0">{readOnlyNote(orgType)}</p> : null}
      </div>
      <RoleSection person={person} roles={roles} orgType={orgType} words={words} off={off} error={error?.at === 'role' ? error : null} onRetry={onRetry} onChange={onChangeRole} />
      <PermissionsSection person={person} orgType={orgType} busy={busy} readOnly={readOnly} error={error?.at === 'ticks' ? error : null} onSave={onSavePrivileges} />
      <RemoveSection person={person} words={words} off={off} error={error?.at === 'remove' ? error : null} onRemove={onRemove} />
    </Panel>
  );
}
