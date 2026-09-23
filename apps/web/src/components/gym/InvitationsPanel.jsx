import { useEffect, useState } from 'react';
import { INVITATION_WORDS } from '@app/shared';
import { Loader2 } from 'lucide-react';
import InvitationCard from './InvitationCard';
import { forgetInvitations, loadInvitations } from './invitationsStore';
import { useAuth } from '../../context/AuthContext';
import { errorText } from '../../api/orgsApi';
import { refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';

// Every invitation still open for the signed-in address, a declined one included
// (Part 3 §10.2; RULINGS 2026-09-23), in Settings → Gym and on /invitations.
// `showEmpty` says so when there is none, naming the address the gym must have.
// `onJoined` after a Join, so a screen can re-read what it shows about gyms.
export default function InvitationsPanel({ showEmpty = false, onJoined }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (userId === null) return undefined;
    let live = true;
    loadInvitations(userId, { fresh: true }).then(
      (read) => {
        if (live) setData(read);
      },
      (err) => {
        if (live) setError(errorText(err, "We couldn't load your invitations."));
      },
    );
    return () => {
      live = false;
    };
  }, [userId]);

  const onAnswered = ({ kind }) => {
    forgetInvitations();
    if (kind === 'joined') {
      refreshConsoleOrgsAfterChange();
      onJoined?.();
    }
  };

  if (error !== null) {
    return (
      <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
        {error}
      </p>
    );
  }
  if (data === null) {
    return <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'rgba(255,255,255,0.35)' }} aria-label="Loading invitations" />;
  }
  if (data.invitations.length === 0) {
    return showEmpty ? (
      <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
        {INVITATION_WORDS.no_invitation(data.address)}
      </p>
    ) : null;
  }
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold" style={{ color: '#fff' }}>
        Invitations
      </h2>
      {data.invitations.map((invitation) => (
        <InvitationCard key={invitation.id} invitation={invitation} onAnswered={onAnswered} />
      ))}
    </section>
  );
}
