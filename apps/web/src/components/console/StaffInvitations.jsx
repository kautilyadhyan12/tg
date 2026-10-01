import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, UserPlus } from 'lucide-react';
import { orgWords, staffRoleWord } from '@app/shared';
import { formatJoinedAt } from '../../pages/console/consoleView';
import { startingAbilities } from '../../pages/console/staffView';
import { refreshConsoleOrgs } from '../../pages/console/consoleOrgs';
import { errorText, orgService } from '../../api/orgsApi';

// "YOU'RE INVITED TO HELP RUN {GYM}" (Part 3 §10.3; ROADMAP 4a-i): the staff invitations
// waiting for the signed-in address, on the console's front page. Accept opens that gym's
// console; No thanks tells the owner. Accepting makes nobody a member: it opens the
// console only, which the card says.

const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

function InvitationCard({ invitation, onAnswered }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState(null);
  const gym = invitation.gym;
  const words = orgWords(gym.orgType);
  const role = staffRoleWord(invitation.role, gym.orgType);
  const who = invitation.invitedBy ?? gym.name;
  const declined = invitation.state === 'declined';

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
    <div
      data-testid={`staff-invitation-${invitation.id}`}
      className="rounded-2xl p-5 flex flex-col gap-3"
      style={{ background: '#121110', border: '1px solid rgba(255,138,31,0.35)' }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255,138,31,0.15)' }}
        >
          <UserPlus className="w-5 h-5" style={{ color: '#FF8A1F' }} />
        </div>
        <div className="min-w-0">
          <div className="font-semibold" style={{ color: '#fff' }}>
            Help run {gym.name}
            {gym.city ? <span style={{ color: 'rgba(255,255,255,0.45)' }}> · {gym.city}</span> : null}
          </div>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
            {who} invited you to help run {gym.name} as {article(role)} {role}.
          </p>
        </div>
      </div>

      <div className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
        <span className="font-semibold">As {article(role)} {role} you can:</span>{' '}
        {startingAbilities(invitation.role, gym.orgType).join(' · ')}. The owner can change this later.
      </div>
      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
        This opens {gym.name}&apos;s console. It doesn&apos;t make you a {words.person} of the {words.it}.
        {declined
          ? ` You said no thanks. You can still accept until ${formatJoinedAt(invitation.expiresAt)}.`
          : ` The invitation works until ${formatJoinedAt(invitation.expiresAt)}.`}
      </p>

      {problem !== null ? (
        <p role="alert" className="text-xs" style={{ color: '#ef4444' }}>
          {problem}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={accept}
          disabled={busy !== null}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2 disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg,#FF8A1F,#FFB347)', color: '#0A0908', minHeight: 44 }}
        >
          {busy === 'accept' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Accept
        </button>
        {declined ? null : (
          <button
            type="button"
            onClick={decline}
            disabled={busy !== null}
            className="rounded-xl px-4 py-2.5 text-sm flex items-center gap-2 disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', minHeight: 44 }}
          >
            {busy === 'decline' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            No thanks
          </button>
        )}
      </div>
    </div>
  );
}

/** The cards, or nothing when there are none. `invitations` is the server's list. */
export default function StaffInvitations({ invitations, onAnswered }) {
  if (invitations.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 mb-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.5)' }}>
        You&apos;re invited
      </h2>
      {invitations.map((invitation) => (
        <InvitationCard key={invitation.id} invitation={invitation} onAnswered={onAnswered} />
      ))}
    </div>
  );
}
