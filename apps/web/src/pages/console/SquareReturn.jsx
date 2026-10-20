import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { orgService, errorText } from '../../api/orgsApi';
import { ConsoleCard, ConsoleLoading } from '../../components/console/ConsoleStates';
import { placeTo } from './consolePlaces';
import { NOT_FROM_SQUARE, pressedGym, squareAnswer } from './paymentsView';

// WHERE SQUARE SENDS THE GYM BACK (ROADMAP 18d-i): Square's answer goes to the server as it
// came, and the person lands on their gym's Payments box, which says what happened. The page
// is replaced in the history, so Back never sends Square's code again.

export default function SquareReturn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const answer = useMemo(() => squareAnswer(params), [params]);
  const [failed, setFailed] = useState(null);
  const problem = answer === null ? NOT_FROM_SQUARE : failed;
  // Sent once, however often the page is drawn: a code works only once.
  const sent = useRef(false);

  useEffect(() => {
    if (answer === null || sent.current) return;
    sent.current = true;
    orgService
      .finishSquare(answer)
      .then((res) => {
        const to = placeTo(res.data.gymSlug, 'payments') ?? '/console';
        navigate(to, { replace: true, state: { squareOutcome: { outcome: res.data.outcome, refusal: res.data.refusal } } });
      })
      .catch((err) => setFailed(errorText(err, "We couldn't finish connecting Square. Press Connect Square again.")));
  }, [answer, navigate]);

  if (problem === null) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleLoading label="Connecting Square…" />
      </div>
    );
  }
  const back = placeTo(pressedGym(), 'payments');
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
      <ConsoleCard>
        <p role="alert" className="text-sm m-0" style={{ color: 'rgba(255,255,255,0.85)' }}>
          {problem}
        </p>
        <Link to={back ?? '/console'} replace className="c-lk text-sm inline-block mt-3">
          {back === null ? 'Open your console' : 'Back to Payments'}
        </Link>
      </ConsoleCard>
    </div>
  );
}
