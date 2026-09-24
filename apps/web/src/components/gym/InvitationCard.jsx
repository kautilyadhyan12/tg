import { useState } from 'react';
import { INVITATION_WORDS, orgWords, yourPlanWords } from '@app/shared';
import { AlertTriangle, CheckCircle2, Info, Loader2, Mail } from 'lucide-react';
import OrgVisibilitySheet from './OrgVisibilitySheet';
import { errorText, orgService } from '../../api/orgsApi';

// One invitation to one gym (Part 3 §10.2): who invited you, what the gym can see,
// and under it the ONE tap — Join. No thanks tells the gym; a declined invitation
// keeps its Join while the gym's list still holds the person (RULINGS 2026-09-23).
// "Not me" tells the gym its address reached the wrong person (gap A); a person who
// pays for their own plan is told what the gym gives and what their plan still adds
// (gap D).
//
// `onAnswered({ kind, invitationId })` once the server has answered: `joined`,
// `declined` or `not_me`.
export default function InvitationCard({ invitation, onAnswered }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [state, setState] = useState(invitation.state);
  const [notMe, setNotMe] = useState(invitation.notMe === true);
  const [joined, setJoined] = useState(null);
  const { gym } = invitation;
  const words = orgWords(gym.orgType);
  const planWords = invitation.yourPlan && invitation.canTakeMembers ? yourPlanWords(gym.name, invitation.yourPlan) : null;

  const answer = async (kind) => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'join') {
        const res = await orgService.acceptInvitation(invitation.id);
        setJoined(res.data.gym);
        onAnswered?.({ kind: 'joined', invitationId: invitation.id });
      } else if (kind === 'not_me') {
        await orgService.notMeInvitation(invitation.id);
        setState('declined');
        setNotMe(true);
        onAnswered?.({ kind: 'not_me', invitationId: invitation.id });
      } else {
        await orgService.declineInvitation(invitation.id);
        setState('declined');
        onAnswered?.({ kind: 'declined', invitationId: invitation.id });
      }
    } catch (err) {
      setError(errorText(err, "We couldn't reach the server. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  if (joined !== null) {
    return (
      <div
        className="rounded-2xl p-5 flex items-start gap-3"
        style={{ background: '#121110', border: '1px solid rgba(74,222,128,0.25)' }}
      >
        <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#4ade80' }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: '#fff' }}>
            You&apos;re in {joined.name}.
          </p>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Your {words.itToMembers}&apos;s features are on.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-4"
      style={{ background: 'rgba(255,138,31,0.06)', border: '1px solid rgba(255,138,31,0.25)' }}
    >
      <div className="flex items-start gap-3">
        <Mail className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#FF8A1F' }} />
        <div className="min-w-0">
          <p className="text-base font-semibold" style={{ color: '#fff' }}>
            You&apos;re invited to {gym.name}
          </p>
          {gym.city ? (
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
              {gym.city}
            </p>
          ) : null}
          {state === 'declined' && notMe ? (
            <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {INVITATION_WORDS.said_not_me(gym.name)}
            </p>
          ) : state === 'declined' ? (
            <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {invitation.canTakeMembers ? 'You said no thanks. You can still join.' : 'You said no thanks.'}
            </p>
          ) : null}
        </div>
      </div>

      {/* What the gym can see sits above Join, the tap it is about. A gym that cannot
          take members has no Join yet, so it says that instead; No thanks is always
          there, so the invitation can be answered either way. */}
      {invitation.canTakeMembers ? (
        <OrgVisibilitySheet orgName={gym.name} orgType={gym.orgType} />
      ) : (
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
          {INVITATION_WORDS.gym_not_taking_members(gym.name, gym.orgType)}
        </p>
      )}

      {planWords !== null ? (
        <div
          data-testid="your-plan"
          className="rounded-xl p-4 flex items-start gap-3"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }} />
          <div className="text-sm flex flex-col gap-1" style={{ color: 'rgba(255,255,255,0.8)' }}>
            <p>{planWords.lead}</p>
            <p style={{ color: 'rgba(255,255,255,0.6)' }}>{planWords.cancel}</p>
          </div>
        </div>
      ) : null}

      {invitation.canTakeMembers || state === 'pending' ? (
        <div className="flex flex-wrap items-center gap-3">
          {invitation.canTakeMembers ? (
            <button
              type="button"
              onClick={() => answer('join')}
              disabled={busy !== null}
              className="rounded-xl px-6 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
              style={{ background: '#FF8A1F', color: '#0A0908', minHeight: 44 }}
            >
              {busy === 'join' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {busy === 'join' ? 'Joining…' : 'Join'}
            </button>
          ) : null}
          {state === 'pending' ? (
            <button
              type="button"
              onClick={() => answer('decline')}
              disabled={busy !== null}
              className="rounded-xl px-5 py-3 text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              style={{ border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.85)', minHeight: 44 }}
            >
              {busy === 'decline' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              No thanks
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Somebody the gym did not mean to invite: the gym typed a wrong address. Nothing
          on this card says whom the gym meant. */}
      {!notMe ? (
        <div className="flex flex-wrap items-center gap-x-2 text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
          <span>Not a {words.person} of {gym.name}?</span>
          <button
            type="button"
            onClick={() => answer('not_me')}
            disabled={busy !== null}
            className="font-medium underline underline-offset-2 flex items-center gap-1.5 disabled:opacity-50"
            style={{ color: 'rgba(255,255,255,0.85)', minHeight: 44 }}
          >
            {busy === 'not_me' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Not me
          </button>
        </div>
      ) : null}

      {error !== null ? (
        <div
          role="alert"
          className="rounded-2xl p-4 flex items-start gap-3"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }}
        >
          <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: '#ef4444' }} />
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
            {error}
          </p>
        </div>
      ) : null}
    </div>
  );
}
