import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, UserPlus } from 'lucide-react';
import { orgWords, staffRoleWord, withArticle } from '@app/shared';
import { formatJoinedAt } from '../../pages/console/consoleView';
import { abilityLabels } from '../../pages/console/staffView';
import { refreshConsoleOrgs } from '../../pages/console/consoleOrgs';
import { errorText, orgService } from '../../api/orgsApi';

// "YOU'RE INVITED TO HELP RUN {GYM}" (Part 3 §10.3; ROADMAP 4a-i): the staff invitations
// waiting for the signed-in address, on the console's front page. Accept opens that gym's
// console; No thanks tells the owner. Accepting makes nobody a member: it opens the
// console only, which the card says. Drawn in the third look (V5-d, board `Orgs`): a box of
// its own above the organisations, its one orange answer Accept.


function InvitationCard({ invitation, onAnswered }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState(null);
  const gym = invitation.gym;
  const words = orgWords(gym.orgType);
  const role = invitation.roleName || staffRoleWord(invitation.role, gym.orgType);
  const who = invitation.invitedBy ?? gym.name;
  const declined = invitation.state === 'declined';
  const abilities = abilityLabels(invitation.privileges ?? [], gym.orgType);
  const titleId = `invite-${invitation.id}`;

  const accept = async () => {
    setBusy('accept');
    setProblem(null);
    try {
      const res = await orgService.acceptStaffInvitation(invitation.id);
      refreshConsoleOrgs();
      navigate(`/console/${res.data.gym.slug}`);
    } catch (err) {
      setProblem(errorText(err, "We couldn't accept it. Please try again."));
      setBusy(null);
    }
  };

  const decline = async () => {
    setBusy('decline');
    setProblem(null);
    try {
      await orgService.declineStaffInvitation(invitation.id);
      onAnswered();
    } catch (err) {
      setProblem(errorText(err, "We couldn't send your answer. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section data-testid={`staff-invitation-${invitation.id}`} className="c-card c-invite" aria-labelledby={titleId}>
      <span className="c-invite-ic" aria-hidden="true">
        <UserPlus size={22} />
      </span>
      <div className="c-stack-s">
        <div className="c-stack-xs">
          <span className="c-eyebrow">You&apos;re invited</span>
          <h2 id={titleId} className="c-h2">
            Help run {gym.name}
            {gym.city ? <span className="c-t2"> · {gym.city}</span> : null}
          </h2>
        </div>
        <p className="c-sub">
          {who} invited you to help run {gym.name} as {withArticle(role)}.
        </p>
        <p className="c-s14 c-t2 c-invite-p">
          {abilities.length === 0 ? (
            <>You can open the console. The owner hasn&apos;t given you anything else to do yet.</>
          ) : (
            <>
              <span className="c-w6 c-t1">As {withArticle(role)} you can:</span> {abilities.join(' · ')}. The owner
              can change this later.
            </>
          )}
        </p>
        <p className="c-s14 c-t2 c-invite-p">
          This opens {gym.name}&apos;s console. It doesn&apos;t make you a {words.person} of the {words.it}.
          {declined
            ? ` You said no thanks. You can still accept until ${formatJoinedAt(invitation.expiresAt)}.`
            : ` The invitation works until ${formatJoinedAt(invitation.expiresAt)}.`}
        </p>

        {problem !== null ? (
          <p role="alert" className="c-err c-invite-p">
            {problem}
          </p>
        ) : null}

        <div className="c-flow-s">
          <button type="button" onClick={accept} disabled={busy !== null} className="c-btn c-btn-lg c-btn-p">
            {busy === 'accept' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
            Accept
          </button>
          {declined ? null : (
            <button type="button" onClick={decline} disabled={busy !== null} className="c-btn c-btn-lg c-btn-s">
              {busy === 'decline' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
              No thanks
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** The boxes, or nothing when there are none. `invitations` is the server's list. */
export default function StaffInvitations({ invitations, onAnswered }) {
  if (invitations.length === 0) return null;
  return (
    <div className="c-stack-s">
      {invitations.map((invitation) => (
        <InvitationCard key={invitation.id} invitation={invitation} onAnswered={onAnswered} />
      ))}
    </div>
  );
}
