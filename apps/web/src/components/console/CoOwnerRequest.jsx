import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, ShieldCheck } from 'lucide-react';
import { formatJoinedAt } from '../../pages/console/consoleView';
import { errorText, orgService } from '../../api/orgsApi';
import { closePaddleCheckout, openPaddleCheckout } from '../../utils/paddleCheckout';

// "BE A CO-OWNER OF {GYM}" (ROADMAP 4b-i): the gym's owner asked the person reading this
// Overview to be a co-owner. Accept makes them one; Decline tells the owner no. What
// happened is said in this same place. Nothing is drawn when no request waits, and a read
// that fails draws nothing: the email says where to come back to.
//
// `kind="owner"` is the same card for "Be the owner of {gym}" (ROADMAP 4b-ii): the owner
// asked this co-owner to take the gym over. A gym paying through Paddle (4b-iii-a): Accept opens
// Paddle's window for their own card, and the gym is theirs once it is saved; closed without a
// card, nothing has changed and the request still waits.

/** How many times, two seconds apart, a saved card is asked after before the card says it
 *  will show in a minute. */
const CARD_TRIES = 30;
const CARD_GAP_MS = 2000;

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
    what: (who) => `As the owner you can also add and remove co-owners. ${who} stays on as a co-owner.`,
    yes: (gym) => `You're now the owner of ${gym}.`,
    // Paying through Paddle: the plan is theirs to pay from the hand-over on.
    card: {
      what: (who) => `As the owner you can also add and remove co-owners, and you pay for the plan from now on with your own card. ${who} stays on as a co-owner and won't be charged again.`,
      accept: 'Accept and add your card',
      yes: (gym) => `You're now the owner of ${gym}. Your card pays for the plan from now on.`,
      notSaved: "Your card wasn't saved, so nothing has changed. Press Accept and add your card to try again.",
      slow: "Your card was saved. It can take a minute to show you as the owner: reload this page then.",
    },
  },
};

export default function CoOwnerRequest({ gymId, gymName, onAccepted, kind = 'co-owner' }) {
  const words = KINDS[kind];
  const [request, setRequest] = useState(null);
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState(null);
  const [done, setDone] = useState(null);
  const mounted = useRef(true);
  // Paddle says "closed" after "completed" too: a card being confirmed is not "not saved".
  const confirming = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      closePaddleCheckout();
    };
  }, []);
  const card = request?.cardNeeded === true ? words.card ?? null : null;

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

  /** Ask until the saved card has made the gym theirs. The worker finishes it on its own too,
   *  so running out of tries only means this card stops waiting. */
  const confirmCard = async (requestId, cardWords) => {
    for (let tries = 0; tries < CARD_TRIES; tries += 1) {
      try {
        const res = await orgService.ownerCardSaved(gymId, requestId);
        if (res.data?.status === 'accepted') {
          closePaddleCheckout();
          if (!mounted.current) return;
          setBusy(null);
          setDone(cardWords.yes(gymName));
          setRequest(null);
          onAccepted?.();
          return;
        }
      } catch (err) {
        if (err?.response?.status === 409 || err?.response?.status === 404) {
          closePaddleCheckout();
          if (!mounted.current) return;
          setBusy(null);
          setProblem(errorText(err, words.card?.notSaved ?? ''));
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, CARD_GAP_MS));
      if (!mounted.current) return;
    }
    closePaddleCheckout();
    if (!mounted.current) return;
    setBusy(null);
    setDone(cardWords.slow);
    setRequest(null);
  };

  const openCard = async (requestId, window, cardWords) => {
    setBusy('card');
    confirming.current = false;
    await openPaddleCheckout({
      environment: window.environment,
      clientToken: window.clientToken,
      transactionId: window.transactionId,
      email: window.email,
      onEvent: (event) => {
        if (!mounted.current) return;
        if (event.type === 'completed') {
          confirming.current = true;
          setBusy('confirming');
          void confirmCard(requestId, cardWords);
        } else if (event.type === 'closed' && !confirming.current) {
          setBusy(null);
          setProblem(cardWords.notSaved);
        }
      },
    });
  };

  const answer = async (accept) => {
    setBusy(accept ? 'accept' : 'decline');
    setProblem(null);
    try {
      const res = await words.answer(gymId, request.id, accept);
      if (accept && res.data?.status === 'card_needed') {
        await openCard(request.id, res.data.card, words.card);
        return;
      }
      setDone(accept ? words.yes(gymName) : `You said no. ${request.ownerName || 'The owner'} can ask you again.`);
      setRequest(null);
      if (accept) onAccepted?.();
      setBusy(null);
    } catch (err) {
      setProblem(errorText(err, "We couldn't send your answer. Please try again."));
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
        {(card ?? words).what(request.ownerName || 'The owner')} The request works until {formatJoinedAt(request.expiresAt)}.
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
          {busy !== null && busy !== 'decline' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {busy === 'confirming' ? 'Saving your card…' : card !== null ? card.accept : 'Accept'}
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
