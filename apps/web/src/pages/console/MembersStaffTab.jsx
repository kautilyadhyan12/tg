import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, X } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { staffRoleText } from './consoleView';
import { Tick } from './MemberListPanel';

// The Members screen's Staff tab (Kd's 4a-ii click-through: staff were mixed in with the
// members). Everyone who runs the gym, the owner first, with "Uses the app" for those who
// also train here; they are on "In the app" as well, tagged Staff. A row opens the person,
// with Remove from staff (and, ticked, from the app in the same step). Inviting and what
// each may do are on Settings, Staff, which this tab names and links to. The list is the
// owner's (`staff.manage`), so only the owner is shown this tab.

/** One person who runs the gym, opened: who they are, and Remove from staff. */
function StaffSheet({ person, words, readOnly, busy, error, onClose, onRemove }) {
  const [asking, setAsking] = useState(false);
  const [alsoApp, setAlsoApp] = useState(false);
  const owner = person.role === 'owner';
  const name = person.displayName;
  return (
    <div className="fixed inset-0 z-50" style={{ background: 'var(--scrim)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={name}
        className="c-sheet absolute inset-0 md:left-auto md:w-[480px] md:border-l flex flex-col overflow-y-auto"
        style={{ borderColor: 'var(--card-line)' }}
      >
        <div className="flex items-start gap-3 px-4 pt-5 pb-4 md:px-7 md:pt-7 md:pb-5 border-b" style={{ borderColor: 'var(--line)' }}>
          <div className="flex flex-col gap-1 flex-grow min-w-0">
            <h2 className="c-h1 c-ell" style={{ fontSize: 28, lineHeight: '34px' }}>
              {name}
            </h2>
            {person.email ? <span className="c-s14 c-t2 c-ell">{person.email}</span> : null}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="c-icon-btn">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-4 py-5 md:px-7">
          <span className="flex flex-wrap gap-1.5">
            <span className="c-tag c-tag-soft">{staffRoleText(person.role, person.roleName ?? null, words)}</span>
            {person.isMember ? <span className="c-tag c-tag-good">Uses the app</span> : null}
          </span>
          <p className="c-s14 c-t2" data-testid="staff-place-line">
            {person.isMember
              ? `Uses the member app here, which takes one of your places, like any ${words.person}.`
              : 'Uses the console only, which is free. Not in the member app here.'}
          </p>
          {owner ? (
            <p className="c-s14 c-t2">The owner runs the {words.it} and can&apos;t be removed from staff.</p>
          ) : !asking ? (
            <button type="button" onClick={() => setAsking(true)} disabled={busy || readOnly} className="c-btn c-btn-s self-start">
              Remove from staff
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="c-s14 c-t1">Remove {name} from staff? They can&apos;t open the console any more.</p>
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
                  disabled={busy || readOnly}
                  className="c-btn c-btn-sm c-btn-danger"
                >
                  {alsoApp ? 'Remove from staff and app' : 'Remove from staff'}
                </button>
                <button type="button" onClick={() => setAsking(false)} disabled={busy || readOnly} className="c-btn c-btn-sm c-btn-s">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {error !== null ? (
            <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function MembersStaffTab({ gymId, orgSlug, words, readOnly = false, onChanged }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ loading: true, error: null, staff: [] });
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    orgService
      .getStaff(gymId)
      .then((res) => {
        if (!cancelled) setState({ loading: false, error: null, staff: res.data?.staff ?? [] });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: errorText(err, "We couldn't load your staff."), staff: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [gymId, attempt]);

  const reload = () => {
    setState({ loading: true, error: null, staff: [] });
    setAttempt((n) => n + 1);
  };

  // Ticked: one step on the server takes both their place in the app and their staff
  // access (`removeMember` with `alsoStaff`). Unticked: their staff access only.
  const remove = async (person, { alsoApp }) => {
    setBusy(true);
    setRemoveError(null);
    try {
      if (alsoApp) await orgService.removeMember(gymId, person.userId, { alsoStaff: true });
      else await orgService.removeStaff(gymId, person.userId);
      setOpenId(null);
      reload();
      onChanged?.();
    } catch (err) {
      setRemoveError(errorText(err, "We couldn't remove them. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  if (state.loading) return <ConsoleLoading label="Loading your staff…" newLook />;
  if (state.error !== null) return <ConsoleFailed message={state.error} onRetry={reload} newLook />;

  const n = state.staff.length;
  const open = openId === null ? null : (state.staff.find((person) => person.userId === openId) ?? null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="c-s14 c-t2">The people who run your {words.it}. Those who also train here use the app and are on In the app too.</p>
        <Link to={`/console/${orgSlug}/settings`} className="c-btn c-btn-s self-start md:self-auto">
          Invite or manage staff in Settings
        </Link>
      </div>
      <section className="c-card overflow-hidden" aria-label="Staff" data-testid="staff-tab">
        <h2 className="c-s14 c-t2 px-5 pt-4 pb-3">
          {n.toLocaleString('en')} {n === 1 ? 'person runs' : 'people run'} your {words.it}
        </h2>
        <ul>
          {state.staff.map((person) => (
            <li key={person.userId} className="border-t" style={{ borderColor: 'var(--line)' }}>
              <button
                type="button"
                data-testid={`staff-tab-${person.userId}`}
                onClick={() => {
                  setRemoveError(null);
                  setOpenId(person.userId);
                }}
                className="w-full text-left grid gap-x-3 gap-y-1 items-center min-h-11 px-5 py-3.5"
                style={{ gridTemplateColumns: 'minmax(0, 1fr) auto 18px' }}
              >
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className="c-s15 c-w6 c-t1 c-ell">
                    {person.displayName}
                    {person.isYou ? <span className="c-t2"> (you)</span> : null}
                  </span>
                  {person.email ? <span className="c-s13 c-t2 c-ell">{person.email}</span> : null}
                </span>
                <span className="flex flex-wrap justify-end gap-1.5">
                  <span className="c-tag c-tag-soft">{staffRoleText(person.role, person.roleName ?? null, words)}</span>
                  {person.isMember ? <span className="c-tag c-tag-good">Uses the app</span> : null}
                </span>
                <ChevronRight aria-hidden="true" className="w-[18px] h-[18px] c-t3" />
              </button>
            </li>
          ))}
        </ul>
      </section>
      {open !== null ? (
        <StaffSheet
          key={open.userId}
          person={open}
          words={words}
          readOnly={readOnly}
          busy={busy}
          error={removeError}
          onClose={() => setOpenId(null)}
          onRemove={(options) => remove(open, options)}
        />
      ) : null}
    </div>
  );
}
