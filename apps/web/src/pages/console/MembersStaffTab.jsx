import { useCallback, useEffect, useRef, useState } from 'react';
import { withArticle } from '@app/shared';
import { Check, ChevronRight, UserPlus } from 'lucide-react';
import { orgService, errorCode, errorText, isRetryable } from '../../api/orgsApi';
import { ConfirmInline, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { staffRoleText } from './consoleView';
import { StaffInvitePanel, StaffPersonPanel } from './MembersStaffPanels';
import { otherStaffRole, privilegesDiffer, sentAgainNotice, staffCountLabel, staffInviteView, staffSeatsNote } from './staffView';

// The Members screen's Staff tab (spec Part 3 §10.3, §18; ROADMAP 4a-ii, 23c-ii): everyone
// who runs the gym, the owner first, and the invitations still out. Invite staff opens the
// form; a row opens the person, with their role, what they can do and Remove from staff.
// It was Settings' Staff box until 23c-ii.
//
// The list is the owner's (`staff.manage`): the Members screen draws this tab for nobody
// else, and the server refuses the read itself to anybody else.
//
// Every change reads the lists again from the server and never patches its own copy, and
// its control stays busy until that read is back, so a row is never pressed twice over an
// answer the screen has not shown yet.

/** What Send again or Cancel did to one invitation: brought into view where it is drawn. */
function RowNote({ note, onRetry }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [note]);
  return (
    <div ref={ref}>
      {note.good ? (
        <p className="c-s14 c-w5 m-0 flex items-start gap-2" style={{ color: 'var(--good)' }} role="status">
          <Check aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {note.message}
        </p>
      ) : (
        <ConsoleFailed message={note.message} onRetry={note.retryable ? onRetry : undefined} newLook />
      )}
    </div>
  );
}

/** The invitations waiting, ended or declined: each address, its role, where it stands and
 *  whether its email went, with Send again and Cancel invitation (Remove, for one that
 *  ended or was declined). Both of those ask first. Nothing is drawn when there are none. */
function InvitedList({ invites, orgType, busyId, readOnly, note, onRetry, onCancel, onResend }) {
  const [asking, setAsking] = useState(null);
  if (invites.loading) return null;
  if (invites.error !== null) return <ConsoleFailed message={invites.error} newLook />;
  if (invites.list.length === 0) return null;
  return (
    <section className="c-card overflow-hidden" aria-label="Invited" data-testid="staff-invites">
      <h2 className="c-s14 c-t2 px-5 pt-4 pb-3">Invited</h2>
      <ul className="flex flex-col m-0 p-0 list-none">
        {invites.list.map((invite) => {
          const view = staffInviteView(invite, orgType);
          const off = busyId !== null || readOnly;
          return (
            <li
              key={invite.id}
              data-testid={`staff-invite-${invite.id}`}
              className="border-t flex flex-col gap-3 px-5 py-3.5"
              style={{ borderColor: 'var(--line)' }}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <div className="flex flex-col gap-0.5 flex-grow min-w-0">
                  <span className="c-s15 c-w6 c-t1 break-words">{view.title}</span>
                  <span className="c-s13 c-t2">{view.meta}</span>
                  {view.email !== null ? (
                    <span className="c-s13" style={{ color: view.emailProblem ? 'var(--warn)' : 'var(--t2)' }}>
                      {view.email}
                    </span>
                  ) : null}
                  {view.sendAgainNote !== null ? <span className="c-s13 c-t2">{view.sendAgainNote}</span> : null}
                </div>
                {asking === invite.id ? (
                  <div className="md:max-w-[320px]">
                    <ConfirmInline
                      newLook
                      question={
                        invite.state === 'waiting'
                          ? `Cancel the invitation to ${invite.email}? They won't be able to accept it. You can invite them again.`
                          : `Remove the invitation to ${invite.email} from this list? You can invite them again.`
                      }
                      confirmLabel={view.action}
                      busy={off}
                      onConfirm={() => {
                        setAsking(null);
                        onCancel(invite);
                      }}
                      onCancel={() => setAsking(null)}
                    />
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 flex-shrink-0">
                    {view.canSendAgain ? (
                      <button type="button" onClick={() => onResend(invite)} disabled={off} className="c-btn c-btn-soft c-btn-sm">
                        Send again
                      </button>
                    ) : null}
                    <button type="button" onClick={() => setAsking(invite.id)} disabled={off} className="c-btn c-btn-s c-btn-sm">
                      {view.action}
                    </button>
                  </div>
                )}
              </div>
              {note !== null && note.id === invite.id ? <RowNote note={note} onRetry={onRetry} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// `inviting`: whether the Invite staff form is open. The Members page keeps it, because
// an address can ask for the form (Overview's Start here list); `onInviting` sets it.
export default function MembersStaffTab({ gymId, orgType, words, readOnly = false, inviting = false, onInviting = () => undefined, onChanged }) {
  const [staff, setStaff] = useState({ loading: true, error: null, list: [] });
  // Their own read and failure: invitations that cannot be read must not hide who already
  // runs the gym.
  const [invites, setInvites] = useState({ loading: true, error: null, list: [] });
  // The gym's own roles (RULINGS 2026-10-01), offered beside Manager and Trainer.
  const [roles, setRoles] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  // What the last change did; what Send again or Cancel did to one invitation (`id`), said
  // in its own row; and a refusal inside whichever panel is open, with where (`at`).
  const [notice, setNotice] = useState(null);
  const [rowNote, setRowNote] = useState(null);
  const [panelError, setPanelError] = useState(null);
  // Only the newest read is drawn; one still on its way when the tab goes is dropped.
  const reads = useRef(0);

  /** Read who runs the gym, the invitations and the roles. Answers the staff list, or null
   *  when it could not be read or a newer read has started. */
  const read = useCallback(async () => {
    reads.current += 1;
    const mine = reads.current;
    const [staffAnswer, invitesAnswer, rolesAnswer] = await Promise.allSettled([
      orgService.getStaff(gymId),
      orgService.getStaffInvites(gymId),
      orgService.getStaffRoles(gymId),
    ]);
    if (mine !== reads.current) return null;
    // A roles read that fails leaves the form with Manager and Trainer.
    if (rolesAnswer.status === 'fulfilled') setRoles(rolesAnswer.value.data?.roles ?? []);
    setInvites(
      invitesAnswer.status === 'fulfilled'
        ? { loading: false, error: null, list: invitesAnswer.value.data?.invites ?? [] }
        : { loading: false, error: errorText(invitesAnswer.reason, "We couldn't load your invitations."), list: [] },
    );
    if (staffAnswer.status !== 'fulfilled') {
      setStaff({ loading: false, error: errorText(staffAnswer.reason, "We couldn't load your staff."), list: [] });
      return null;
    }
    const list = staffAnswer.value.data?.staff ?? [];
    setStaff({ loading: false, error: null, list });
    return list;
  }, [gymId]);

  // The first read. Nothing is set until the server has answered.
  useEffect(() => {
    void Promise.resolve().then(read);
    return () => {
      reads.current += 1;
    };
  }, [read]);

  const ready = !staff.loading && staff.error === null;

  const retry = () => {
    setRowNote(null);
    setPanelError(null);
    setStaff({ loading: true, error: null, list: [] });
    void read();
  };

  const changeRole = async (person) => {
    const next = otherStaffRole(person.role);
    if (next === null) return;
    setBusyId(person.userId);
    setPanelError(null);
    try {
      await orgService.updateStaffRole(gymId, person.userId, { role: next });
    } catch (err) {
      setPanelError({ at: 'role', message: errorText(err, "We couldn't change their role. Please try again."), retryable: isRetryable(err) });
      setBusyId(null);
      return;
    }
    await read();
    setBusyId(null);
    onChanged?.();
  };

  /** Save one person's ticks: the whole set. Answers 'refused' (the server's sentence is
   *  shown and the edit kept), or, once the list has been read back, 'saved' when the
   *  server holds exactly what was sent, 'differs' when it holds something else, and
   *  'unread' when the list could not be read. No Try again: reading the list again cannot
   *  save anything. */
  const savePrivileges = async (person, privileges) => {
    setBusyId(person.userId);
    setPanelError(null);
    try {
      await orgService.updateStaffPrivileges(gymId, person.userId, { privileges });
    } catch (err) {
      setPanelError({ at: 'ticks', message: errorText(err, "We couldn't save those permissions. Please try again."), retryable: false });
      setBusyId(null);
      return 'refused';
    }
    const list = await read();
    setBusyId(null);
    const now = list?.find((p) => p.userId === person.userId);
    if (!now) return 'unread';
    return Array.isArray(now.privileges) && privilegesDiffer(now.privileges, privileges) ? 'differs' : 'saved';
  };

  // Ticked: one step on the server takes both their place in the app and their staff
  // access (`removeMember` with `alsoStaff`). Unticked: their staff access only.
  const remove = async (person, { alsoApp }) => {
    setBusyId(person.userId);
    setPanelError(null);
    setNotice(null);
    try {
      if (alsoApp) await orgService.removeMember(gymId, person.userId, { alsoStaff: true });
      else await orgService.removeStaff(gymId, person.userId);
    } catch (err) {
      setPanelError({ at: 'remove', message: errorText(err, "We couldn't remove them. Please try again."), retryable: false });
      setBusyId(null);
      return;
    }
    setOpenId(null);
    setNotice(alsoApp ? `${person.displayName} was removed from staff and from the app.` : `${person.displayName} was removed from staff.`);
    await read();
    setBusyId(null);
    onChanged?.();
  };

  // The form stays open with the typing in it when the server refuses, and shows the
  // server's own sentence. No Try again: the form is where it is tried again.
  const sendInvite = async (body) => {
    setBusyId('invite');
    setPanelError(null);
    setNotice(null);
    let done;
    try {
      done = (await orgService.inviteStaff(gymId, body)).data;
    } catch (err) {
      setPanelError({ at: 'form', message: errorText(err, "We couldn't send that invitation. Please try again."), retryable: false });
      setBusyId(null);
      return;
    }
    setNotice(
      done.outcome === 'added'
        ? `${done.staff.displayName} is now ${withArticle(done.staff.roleName || (done.staff.role === 'manager' ? 'manager' : words.coach))} here.`
        : `Invited ${done.invite.email}. We're sending the email now; the invitation works for 7 days.`,
    );
    onInviting(false);
    await read();
    setBusyId(null);
    if (done.outcome === 'added') onChanged?.();
  };

  /** Save a role of the gym's own. Answers `{ role }`, or `{ error }` with the reason. */
  const makeRole = async (name, privileges) => {
    setBusyId('invite');
    try {
      const made = (await orgService.createStaffRole(gymId, { name, privileges })).data.role;
      setRoles((prev) => [...prev, made].sort((a, b) => a.name.localeCompare(b.name)));
      return { role: made };
    } catch (err) {
      return { error: errorText(err, "We couldn't save that role. Please try again.") };
    } finally {
      setBusyId(null);
    }
  };

  /** Delete a role of the gym's own. Answers whether it went. */
  const deleteRole = async (roleId) => {
    setBusyId('invite');
    setPanelError(null);
    try {
      await orgService.deleteStaffRole(gymId, roleId);
      setRoles((prev) => prev.filter((r) => r.id !== roleId));
      return true;
    } catch (err) {
      setPanelError({ at: 'form', message: errorText(err, "We couldn't delete that role. Please try again."), retryable: false });
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const resendInvite = async (invitation) => {
    setBusyId(invitation.id);
    setRowNote(null);
    setNotice(null);
    try {
      const res = await orgService.resendStaffInvite(gymId, invitation.id);
      setRowNote({ id: invitation.id, good: true, message: sentAgainNotice(res.data.invite), retryable: false });
      await read();
    } catch (err) {
      // The server's sentence says why and what to do (a bounced address, the week's
      // three, still sending); pressing again would get the same answer.
      setRowNote({ id: invitation.id, good: false, message: errorText(err, "We couldn't send that invitation again. Please try again."), retryable: false });
      // Already staff, or gone: the server took it off the list, so the list is read again.
      if (['already_staff', 'invite_not_found'].includes(errorCode(err))) await read();
    } finally {
      setBusyId(null);
    }
  };

  const cancelInvite = async (invitation) => {
    setBusyId(invitation.id);
    setRowNote(null);
    setNotice(null);
    try {
      await orgService.cancelStaffInvite(gymId, invitation.id);
      await read();
    } catch (err) {
      setRowNote({ id: invitation.id, good: false, message: errorText(err, "We couldn't cancel that invitation. Please try again."), retryable: isRetryable(err) });
    } finally {
      setBusyId(null);
    }
  };

  const open = openId === null ? null : (staff.list.find((person) => person.userId === openId) ?? null);
  const count = staffCountLabel(staff.list, orgType);
  // An answer about an invitation that is no longer listed (they were already staff) is
  // said over the lists instead.
  const strayNote = rowNote !== null && !invites.list.some((invitation) => invitation.id === rowNote.id) ? rowNote : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        <p className="c-s14 c-t2 m-0" style={{ maxWidth: 640 }}>
          The people who run your {words.it}. {staffSeatsNote()} Those who also train here are on In the app too.
        </p>
        {/* No way to add to a list that could not be read: who is already on it is unknown. */}
        {ready ? (
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setPanelError(null);
              setOpenId(null);
              onInviting(true);
            }}
            disabled={readOnly}
            className="c-btn c-btn-soft c-btn-lg w-full md:w-auto flex-shrink-0"
          >
            <UserPlus aria-hidden="true" className="w-4 h-4" />
            Invite staff
          </button>
        ) : null}
      </div>

      {notice !== null ? (
        <p className="c-s14 c-w5 m-0 flex items-center gap-2" style={{ color: 'var(--good)' }} role="status">
          <Check aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
          {notice}
        </p>
      ) : null}
      {strayNote !== null ? <RowNote note={strayNote} onRetry={retry} /> : null}

      {staff.loading ? <ConsoleLoading label="Loading your staff…" newLook /> : null}
      {!staff.loading && staff.error !== null ? <ConsoleFailed message={staff.error} onRetry={retry} newLook /> : null}

      {ready ? (
        <>
          <section className="c-card overflow-hidden" aria-label="Staff" data-testid="staff-tab">
            {count !== null ? <h2 className="c-s14 c-t2 px-5 pt-4 pb-3">{count}</h2> : null}
            <ul className="flex flex-col m-0 p-0 list-none">
              {staff.list.map((person) => (
                <li key={person.userId} className="border-t" style={{ borderColor: 'var(--line)' }}>
                  <button
                    type="button"
                    data-testid={`staff-tab-${person.userId}`}
                    onClick={() => {
                      setPanelError(null);
                      onInviting(false);
                      setOpenId(person.userId);
                    }}
                    className="w-full text-left flex items-center gap-3 min-h-11 px-5 py-3.5"
                  >
                    <span className="flex flex-col gap-2 flex-grow min-w-0 md:flex-row md:items-center md:gap-3">
                      <span className="flex flex-col gap-0.5 min-w-0 md:flex-grow">
                        <span className="c-s15 c-w6 c-t1 break-words">
                          {person.displayName}
                          {person.isYou ? <span className="c-t2"> (you)</span> : null}
                        </span>
                        {person.email ? <span className="c-s13 c-t2 c-ell">{person.email}</span> : null}
                      </span>
                      <span className="flex flex-wrap gap-1.5 md:justify-end md:flex-shrink-0">
                        <span className="c-tag c-tag-soft">{staffRoleText(person.role, person.roleName ?? null, words)}</span>
                        {person.isMember ? <span className="c-tag c-tag-good">Uses the app</span> : null}
                      </span>
                    </span>
                    <ChevronRight aria-hidden="true" className="w-[18px] h-[18px] c-t3 flex-shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <InvitedList invites={invites} orgType={orgType} busyId={busyId} readOnly={readOnly} note={rowNote} onRetry={retry} onCancel={cancelInvite} onResend={resendInvite} />
        </>
      ) : null}

      {ready && open !== null && !inviting ? (
        <StaffPersonPanel
          key={open.userId}
          person={open}
          orgType={orgType}
          words={words}
          readOnly={readOnly}
          busy={busyId === open.userId}
          error={panelError}
          onRetry={retry}
          onClose={() => {
            setPanelError(null);
            setOpenId(null);
          }}
          onChangeRole={() => changeRole(open)}
          onSavePrivileges={(privileges) => savePrivileges(open, privileges)}
          onRemove={(options) => remove(open, options)}
        />
      ) : null}
      {ready && inviting ? (
        <StaffInvitePanel
          orgType={orgType}
          words={words}
          roles={roles}
          readOnly={readOnly}
          busy={busyId === 'invite'}
          error={panelError}
          onSend={(body) => void sendInvite(body)}
          onMakeRole={makeRole}
          onDeleteRole={deleteRole}
          onClose={() => {
            setPanelError(null);
            onInviting(false);
          }}
        />
      ) : null}
    </div>
  );
}
