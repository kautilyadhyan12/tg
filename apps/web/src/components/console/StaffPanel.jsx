import { useEffect, useState } from 'react';
import { Loader2, Plus, UserMinus } from 'lucide-react';
import { ConsoleCard, ConsoleFailed, ConsoleLoading } from './ConsoleStates';
import { formatJoinedAt, roleLabel } from '../../pages/console/consoleView';
import {
  STAFF_ROLE_CHOICES,
  STAFF_SEATS_NOTE,
  canChangeStaff,
  canManageStaff,
  otherStaffRole,
  staffCountLabel,
} from '../../pages/console/staffView';
import { orgService, errorText } from '../../api/orgsApi';

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

/** ADD SOMEBODY. Email plus one of two roles, which is the whole form.
 *
 *  **The email must already belong to a member of this gym.** §4.7 says "invite
 *  by email", and inviting a stranger means SENDING them one — nothing in this
 *  product has ever sent an email, so that half is deferred rather than faked.
 *  The other reason is security and it is the one that will outlive the first: a
 *  lookup across all accounts would answer "does this address have an account"
 *  for anything an owner cares to type. The server scopes it to this gym's own
 *  roster and its refusal names the fix, so the sentence below says the same
 *  thing BEFORE the refusal rather than after it. */
function AddStaffForm({ email, setEmail, role, setRole, fieldError, busy, onAdd, onCancel }) {
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
          disabled={busy}
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
        <span id="staff-role-label">What they can do</span>
        <div className="flex flex-col gap-2 mt-1.5" role="radiogroup" aria-labelledby="staff-role-label">
          {STAFF_ROLE_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={role === choice.value}
              disabled={busy}
              onClick={() => setRole(choice.value)}
              className="text-left rounded-xl px-3 py-2.5 disabled:opacity-40"
              style={{
                background: role === choice.value ? 'rgba(255,138,31,0.14)' : 'rgba(255,255,255,0.04)',
                border:
                  role === choice.value
                    ? '1px solid rgba(255,138,31,0.5)'
                    : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <span
                className="text-sm font-medium"
                style={{ color: role === choice.value ? '#FF8A1F' : '#fff' }}
              >
                {choice.label}
              </span>
              <span className="block text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {choice.hint}
              </span>
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
        They have to be a member of your gym already. If they haven&apos;t joined yet, send them your
        join code first.
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
          disabled={busy}
          className="rounded-xl px-4 py-2 text-sm font-semibold flex items-center gap-2 disabled:opacity-40"
          style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Add
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
function RemoveControl({ person, busy, onRemove }) {
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
        onClick={() => setStage('choosing')}
        disabled={busy}
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
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>They stay a member of your gym.</span>
        </button>
        <button
          type="button"
          onClick={() => setStage(true)}
          disabled={busy}
          className="text-xs rounded-lg px-3 py-2 text-left sm:text-right disabled:opacity-40"
          style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
        >
          <span className="font-semibold block">Remove from the gym too</span>
          <span style={{ color: 'rgba(239,68,68,0.75)' }}>
            They lose your gym&apos;s features. They keep every workout they have done.
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
          ? `Remove ${person.displayName} from your gym as well? They lose your gym's features. They keep every workout they have done.`
          : `Take ${person.displayName}'s keys back? They stay a member of your gym.`}
      </span>
      <div className="flex items-center gap-2 self-start sm:self-end">
        <button
          type="button"
          onClick={() => {
            setStage(null);
            onRemove(alsoRemoveFromGym);
          }}
          disabled={busy}
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

function StaffRow({ person, busy, onChangeRole, onRemove }) {
  const changeable = canChangeStaff(person);
  const nextRole = otherStaffRole(person.role);
  // Absent rather than an em dash: `users.email` is nullable by design (an
  // account created through Google carries none), and a dash where an address
  // belongs reads as a value that failed to load.
  const meta = [person.email, roleLabel(person.role), `since ${formatJoinedAt(person.since)}`]
    .filter((part) => typeof part === 'string' && part !== '')
    .join(' · ');

  return (
    <div
      data-testid={`staff-${person.userId}`}
      className="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
      style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.06)' }}
    >
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
            <button
              type="button"
              onClick={onChangeRole}
              disabled={busy}
              className="text-xs rounded-lg px-3 py-1.5 self-start disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
            >
              Make {roleLabel(nextRole).toLowerCase()}
            </button>
          ) : null}
          <RemoveControl person={person} busy={busy} onRemove={onRemove} />
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
          A gym can&apos;t be left with nobody in charge.
        </span>
      )}
    </div>
  );
}

export default function StaffPanel({ gymId, staffRole }) {
  const allowed = canManageStaff(staffRole);

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
  const [fieldError, setFieldError] = useState(null);

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
          error: errorText(err, "We couldn't load who runs this gym."),
          staff: [],
        });
      });
    return () => {
      cancelled = true;
    };
  }, [gymId, attempt, allowed]);

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
      setActionError(errorText(err, "We couldn't change what they can do. Please try again."));
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
      setActionError(errorText(err, "We couldn't take their keys back. Please try again."));
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
        setActionError(
          `${person.displayName} no longer runs your gym, but they are still a member of it. ` +
            `${errorText(err, "We couldn't remove them from the gym.")} ` +
            'You can remove them on the Members screen.',
        );
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
    if (gymId === null) return;
    setFieldError(null);
    setBusyId('add');
    setActionError(null);
    try {
      await orgService.addStaff(gymId, { email: value, role });
      setEmail('');
      setRole('trainer');
      setAdding(false);
      reload();
    } catch (err) {
      // THE FORM STAYS OPEN AND THE TYPING SURVIVES. Closing it on a refusal
      // discards what the owner typed and hides the sentence explaining why —
      // the join-code editor shipped that defect and it has its own recorded
      // finding. The server's own message is what gets shown: "Nobody in this
      // gym has that email address…" names the fix better than a rewrite could.
      setActionError(errorText(err, "We couldn't add them. Please try again."));
    } finally {
      setBusyId(null);
    }
  };

  const countLabel = staffCountLabel(state.staff);

  return (
    <ConsoleCard>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Staff
        </div>
        {!state.loading && state.error === null ? (
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {countLabel}
          </span>
        ) : null}
      </div>
      <p className="text-sm mb-3" style={{ color: 'rgba(255,255,255,0.45)' }}>
        Who can help you run this gym. {STAFF_SEATS_NOTE}
      </p>

      {state.loading ? <ConsoleLoading label="Loading who runs this gym…" /> : null}

      {!state.loading && state.error !== null ? (
        <ConsoleFailed message={state.error} onRetry={retry} />
      ) : null}

      {actionError !== null ? (
        <div className="mb-3">
          <ConsoleFailed message={actionError} onRetry={retry} />
        </div>
      ) : null}

      {!state.loading && state.error === null ? (
        <div className="flex flex-col gap-3">
          {state.staff.map((person) => (
            <StaffRow
              key={person.userId}
              person={person}
              busy={busyId === person.userId}
              onChangeRole={() => changeRole(person)}
              onRemove={(alsoRemoveFromGym) => removePerson(person, alsoRemoveFromGym)}
            />
          ))}

          {adding ? (
            <AddStaffForm
              email={email}
              setEmail={setEmail}
              role={role}
              setRole={setRole}
              fieldError={fieldError}
              busy={busyId === 'add'}
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
              onClick={() => setAdding(true)}
              className="self-start rounded-xl px-4 py-2 text-sm font-medium flex items-center gap-2"
              style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
            >
              <Plus className="w-4 h-4" />
              Add someone
            </button>
          )}
        </div>
      ) : null}
    </ConsoleCard>
  );
}
