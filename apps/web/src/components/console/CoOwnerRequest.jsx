import { useEffect, useState } from 'react';
import { Check, Loader2, ShieldCheck } from 'lucide-react';
import { formatJoinedAt } from '../../pages/console/consoleView';
import { planStopsForYou } from '../../pages/console/staffView';
import { errorText, orgService } from '../../api/orgsApi';

// "BE A CO-OWNER OF {GYM}" (ROADMAP 4b-i): the gym's owner asked the person reading this
// Overview to be a co-owner. Accept makes them one; Decline tells the owner no. What
// happened is said in this same place. Nothing is drawn when no request waits, and a read
// that fails draws nothing: the email says where to come back to.
//
// `kind="owner"` is the same card for "Be the owner of {gym}" (ROADMAP 4b-ii): the owner
// asked this co-owner to take the gym over.

const KINDS = {
  'co-owner': {
    read: (gymId) => orgService.getMyCoOwnerRequest(gymId),
    answer: (gymId, id, accept) => orgService.answerCoOwnerRequest(gymId, id, accept),
    testId: 'co-owner-request',
    title: (gym) => `Be a co-owner of ${gym}`,
    asked: 'asked you to be a co-owner.',
    what: () => 'A co-owner can do everything in the console, including staff, billing and settings, except add, change or remove co-owners.',
    yes: (gym) => `You're now a co-owner of ${gym}.`,
  },
  owner: {
    read: (gymId) => orgService.getMyOwnerRequest(gymId),
    answer: (gymId, id, accept) => orgService.answerOwnerRequest(gymId, id, accept),
    testId: 'owner-request',
    title: (gym) => `Be the owner of ${gym}`,
    asked: 'asked you to be the owner.',
    what: (who, request) => {
      const plan = planStopsForYou(request?.planStops);
      const square = request?.squareConnected === true ? ' Their Square account is disconnected, and you connect your own.' : '';
      return `As the owner you can also add and remove co-owners. ${who} stays on as a co-owner.${plan === null ? '' : ` ${plan}`}${square}`;
    },
    yes: (gym) => `You're now the owner of ${gym}.`,
  },
};

export default function CoOwnerRequest({ gymId, gymName, onAccepted, kind = 'co-owner' }) {
  const words = KINDS[kind];
  const [request, setRequest] = useState(null);
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    let live = true;
    words
      .read(gymId)
      .then((res) => {
        if (live) setRequest(res.data?.request ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [gymId, words]);

  const answer = async (accept) => {
    setBusy(accept ? 'accept' : 'decline');
    setProblem(null);
    try {
      await words.answer(gymId, request.id, accept);
      setDone(accept ? words.yes(gymName) : `You said no. ${request.ownerName || 'The owner'} can ask you again.`);
      setRequest(null);
      if (accept) onAccepted?.();
    } catch (err) {
      setProblem(errorText(err, "We couldn't send your answer. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  if (done !== null) {
    return (
      <p role="status" className="text-sm flex items-center gap-2" style={{ color: '#4ade80' }} data-testid={`${words.testId}-done`}>
        <Check aria-hidden="true" className="w-4 h-4" />
        {done}
      </p>
    );
  }
  if (request === null) return null;
  const who = request.ownerName || `The owner of ${gymName}`;
  return (
    <div
      data-testid={words.testId}
      className="rounded-2xl p-5 flex flex-col gap-3"
      style={{ background: '#121110', border: '1px solid rgba(255,138,31,0.35)' }}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,138,31,0.15)' }}>
          <ShieldCheck aria-hidden="true" className="w-5 h-5" style={{ color: '#FF8A1F' }} />
        </div>
        <div className="min-w-0">
          <div className="font-semibold" style={{ color: '#fff' }}>
            {words.title(gymName)}
          </div>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
            {who} {words.asked}
          </p>
        </div>
      </div>
      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
        {words.what(request.ownerName || 'The owner', request)} The request works until {formatJoinedAt(request.expiresAt)}.
      </p>
      {problem !== null ? (
        <p role="alert" className="text-xs" style={{ color: '#ef4444' }}>
          {problem}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void answer(true)}
          disabled={busy !== null}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2 disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg,#FF8A1F,#FFB347)', color: '#0A0908', minHeight: 44 }}
        >
          {busy === 'accept' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Accept
        </button>
        <button
          type="button"
          onClick={() => void answer(false)}
          disabled={busy !== null}
          className="rounded-xl px-4 py-2.5 text-sm flex items-center gap-2 disabled:opacity-40"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', minHeight: 44 }}
        >
          {busy === 'decline' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Decline
        </button>
      </div>
    </div>
  );
}
