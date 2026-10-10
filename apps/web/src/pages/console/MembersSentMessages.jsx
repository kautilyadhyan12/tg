import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { GYM_SENT_MESSAGES_KEPT_WORDS, MEMBER_NOTE_NO_AUTHOR_WORDS, orgWords } from '@app/shared';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import ScrollJump from '../../components/console/ScrollJump';
import { orgService, errorText } from '../../api/orgsApi';
import { useConsoleOrg } from './useConsoleOrg';
import { viewerPrivileges } from './consoleView';
import { sentToWords, sentWhen } from './memberListPeople';

// SENT MESSAGES (spec Part 3 §16.8; ROADMAP 20f-ii): the messages this gym sent to the
// people it chose, newest first, twenty at a time: the words, who sent it, when on the
// gym's own clock, and to how many. Never who got it by name. Members' Sent messages
// button opens it, for staff who may send one; the address can be typed by anybody, so
// somebody without the tick is told, and nothing is asked for them.

export default function MembersSentMessages() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const words = orgWords(org?.orgType);
  const gymId = org?.id ?? null;
  const may = viewerPrivileges(org).includes('members.confirm');

  const [page, setPage] = useState({ loading: true, error: null, messages: [], next: null });
  const [tick, setTick] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (gymId === null || !may) return undefined;
    let live = true;
    setPage((was) => ({ ...was, loading: true, error: null }));
    orgService.getSentMessages(gymId, null).then(
      (res) => {
        if (live) setPage({ loading: false, error: null, messages: res.data.page.messages, next: res.data.page.next });
      },
      (err) => {
        if (live) setPage({ loading: false, error: errorText(err, "We couldn't load your sent messages."), messages: [], next: null });
      },
    );
    return () => {
      live = false;
    };
  }, [gymId, may, tick]);

  const loadMore = useCallback(async () => {
    if (gymId === null || page.next === null) return;
    setLoadingMore(true);
    try {
      const more = (await orgService.getSentMessages(gymId, page.next)).data.page;
      setPage((was) => {
        // A message already shown is never drawn twice.
        const have = new Set(was.messages.map((one) => one.id));
        return { ...was, error: null, messages: [...was.messages, ...more.messages.filter((one) => !have.has(one.id))], next: more.next };
      });
    } catch (err) {
      setPage((was) => ({ ...was, error: errorText(err, "We couldn't load more.") }));
    } finally {
      setLoadingMore(false);
    }
  }, [gymId, page.next]);

  if (orgLoading) {
    return (
      <div className="c-page">
        <ConsoleLoading newLook />
      </div>
    );
  }
  if (orgError !== null) {
    return (
      <div className="c-page">
        <ConsoleFailed message={orgError} onRetry={reload} newLook />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="c-page">
        <section className="c-card p-5 md:p-6 flex flex-col gap-3">
          <p className="c-s15 c-t2">We couldn&apos;t find an organisation you run at this address.</p>
          <Link to="/console" className="c-s15 c-w6 c-lk self-start">
            Your organisations
          </Link>
        </section>
      </div>
    );
  }

  const back = `/console/${orgSlug}/members`;
  const first = page.messages.length === 0;
  return (
    <div className="c-page" data-testid="sent-messages-page">
      <header className="flex flex-col gap-2">
        <Link to={back} className="c-s14 c-w6 c-lk self-start flex items-center gap-1.5">
          <ArrowLeft aria-hidden="true" className="w-4 h-4" />
          {words.peopleCap}
        </Link>
        <h1 className="c-h1">Sent messages</h1>
        {may ? (
          <p className="c-sub">
            {`The messages you sent to ${words.people} you selected. They read them in their inbox in the app. ${GYM_SENT_MESSAGES_KEPT_WORDS}`}
          </p>
        ) : null}
      </header>

      {!may ? (
        <section className="c-card p-5 md:p-6 flex flex-col gap-3" data-testid="sent-messages-not-allowed">
          <p className="c-s15 c-t2">Your role doesn&apos;t allow you to see sent messages. Ask the owner if you need to.</p>
          <Link to={back} className="c-btn c-btn-s c-btn-lg self-start">
            {`Back to ${words.people}`}
          </Link>
        </section>
      ) : null}

      {may && page.loading ? <ConsoleLoading label="Loading…" newLook /> : null}
      {may && page.error !== null ? <ConsoleFailed message={page.error} onRetry={first ? () => setTick((n) => n + 1) : () => void loadMore()} newLook /> : null}

      {may && !page.loading && page.error === null && first ? (
        <section className="c-card px-6 py-12 flex flex-col items-center gap-3 text-center" data-testid="sent-messages-none">
          <h2 className="c-h2">You haven&apos;t sent a message yet</h2>
          <p className="c-s15 c-t2 max-w-[460px]">{`To send one, tick the ${words.people} you want on your list, then press Send message.`}</p>
          <Link to={back} className="c-btn c-btn-p c-btn-lg mt-2">
            {`Go to ${words.people}`}
          </Link>
        </section>
      ) : null}

      {may && !page.loading && !first ? (
        <>
          <section className="c-card overflow-hidden">
            <ul>
              {page.messages.map((one, i) => (
                <li key={one.id} className={`flex flex-col gap-2 px-4 py-4 md:px-5${i > 0 ? ' border-t' : ''}`} style={{ borderColor: 'var(--line)' }} data-testid="sent-message">
                  <p className="c-s15 c-t1 m-0 whitespace-pre-wrap break-words" data-testid="sent-message-words">
                    {one.body}
                  </p>
                  <p className="c-s14 c-t2 m-0 flex flex-col md:flex-row md:flex-wrap gap-x-2 gap-y-1" data-testid="sent-message-facts">
                    <span className="c-w6 c-t1 c-num">{sentToWords(one.people)}</span>
                    <span aria-hidden="true" className="hidden md:inline">·</span>
                    <span>{sentWhen(one.sentAt, org?.timezone, org?.clockFormat)}</span>
                    <span aria-hidden="true" className="hidden md:inline">·</span>
                    <span>{`Sent by ${one.sentByName ?? MEMBER_NOTE_NO_AUTHOR_WORDS.toLowerCase()}`}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
          {page.next !== null ? (
            <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="c-btn c-btn-s c-btn-lg w-full md:w-auto md:self-start">
              {loadingMore ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
        </>
      ) : null}

      <ScrollJump />
    </div>
  );
}
