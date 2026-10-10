import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Loader2, MessageSquare, User, Users } from 'lucide-react';
import { GYM_SENT_MESSAGES_KEPT_WORDS, MEMBER_NOTE_NO_AUTHOR_WORDS, orgWords } from '@app/shared';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import ScrollJump from '../../components/console/ScrollJump';
import { orgService, errorText } from '../../api/orgsApi';
import { useConsoleOrg } from './useConsoleOrg';
import { canRemoveMembers, viewerPrivileges } from './consoleView';
import { consoleIsReadOnly } from './billingView';
import MemberListPerson from './MemberListPerson';
import { Refusal, Sheet } from './MemberListTags';
import { initialsOf, sentByDay, sentGoneWords, sentTime, sentToWords, sentTodayWords } from './memberListPeople';

// SENT MESSAGES (spec Part 3 §16.8; ROADMAP 20f-ii): the messages this gym sent to the
// people it chose, newest first under a heading for each day, twenty at a time: who sent
// it and when on the gym's own clock, the words, and to how many. "Sent to N people" opens
// their names, and a name opens that person's page. Members' Sent messages button opens
// this page, for staff who may send one; the address can be typed by anybody, so somebody
// without the tick is told, and nothing is asked for them.

/** Who one message went to: its names, asked for when the box opens. */
function SentTo({ gymId, message, onOpenPerson, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, sentTo: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    orgService.getSentMessagePeople(gymId, message.id).then(
      (res) => {
        if (live) setState({ loading: false, error: null, sentTo: res.data.sentTo });
      },
      (err) => {
        if (live) setState({ loading: false, error: errorText(err, "We couldn't load who it was sent to. Please try again."), sentTo: null });
      },
    );
    return () => {
      live = false;
    };
  }, [gymId, message.id, tick]);

  const { sentTo } = state;
  const more = sentTo === null ? 0 : sentTo.named - sentTo.people.length;
  return (
    <Sheet
      title={sentToWords(message.people)}
      testId="sent-to-box"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} className="c-btn c-btn-p c-btn-lg">
          Done
        </button>
      }
    >
      <p className="c-s14 c-t2 m-0 whitespace-pre-wrap break-words" data-testid="sent-to-words">
        {message.body}
      </p>
      {state.loading ? (
        <p className="c-s14 c-t2 flex items-center gap-2">
          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading the names…
        </p>
      ) : null}
      {state.error !== null ? (
        <>
          <Refusal>{state.error}</Refusal>
          <button type="button" onClick={() => {
              setState({ loading: true, error: null, sentTo: null });
              setTick((k) => k + 1);
            }}
            className="c-btn c-btn-s c-btn-lg self-start">
            Try again
          </button>
        </>
      ) : null}
      {sentTo !== null ? (
        <>
          {sentTo.people.length > 0 ? (
            <ul className="flex flex-col" data-testid="sent-to-names">
              {sentTo.people.map((one, i) => (
                <li key={one.entryId ?? `none-${String(i)}`} className={i > 0 ? 'border-t' : ''} style={{ borderColor: 'var(--line)' }}>
                  {one.entryId !== null ? (
                    <button
                      type="button"
                      onClick={() => onOpenPerson(one.entryId)}
                      aria-label={`Open ${one.name || 'No name'}'s page`}
                      className="w-full flex items-center gap-3 text-left min-h-11 py-2"
                    >
                      <span className="c-s15 c-w6 c-t1 c-ell flex-1 min-w-0">{one.name || 'No name'}</span>
                      <ChevronRight aria-hidden="true" className="w-[18px] h-[18px] c-t3 flex-none" />
                    </button>
                  ) : (
                    <span className="flex items-center min-h-11 py-2 c-s15 c-w6 c-t1">{one.name || 'No name'}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {more > 0 ? <p className="c-s14 c-t2 m-0" data-testid="sent-to-more">{`and ${more.toLocaleString('en')} more`}</p> : null}
          {sentTo.gone > 0 ? (
            <p className="c-s14 c-t2 m-0" data-testid="sent-to-gone">
              {sentGoneWords(sentTo.gone)}
            </p>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

export default function MembersSentMessages() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const words = orgWords(org?.orgType);
  const gymId = org?.id ?? null;
  const privileges = viewerPrivileges(org);
  const may = privileges.includes('members.confirm');
  const readOnly = consoleIsReadOnly(org);

  const [page, setPage] = useState({ loading: true, error: null, messages: [], next: null, leftToday: null });
  const [tick, setTick] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  /** The message whose names are open. */
  const [namesFor, setNamesFor] = useState(null);
  /** The record whose page is open, from a name. */
  const [personId, setPersonId] = useState(null);
  /** The gym's own columns, for a person's page; read when a name is first pressed. */
  const [list, setList] = useState(null);

  useEffect(() => {
    if (gymId === null || !may) return undefined;
    let live = true;
    setPage((was) => ({ ...was, loading: true, error: null }));
    orgService.getSentMessages(gymId, null).then(
      (res) => {
        if (live) setPage({ loading: false, error: null, ...res.data.page });
      },
      (err) => {
        if (live) setPage({ loading: false, error: errorText(err, "We couldn't load your sent messages."), messages: [], next: null, leftToday: null });
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
        return { ...was, error: null, messages: [...was.messages, ...more.messages.filter((one) => !have.has(one.id))], next: more.next, leftToday: more.leftToday };
      });
    } catch (err) {
      setPage((was) => ({ ...was, error: errorText(err, "We couldn't load more.") }));
    } finally {
      setLoadingMore(false);
    }
  }, [gymId, page.next]);

  const openPerson = (entryId) => {
    setNamesFor(null);
    setPersonId(entryId);
    if (list === null && gymId !== null) {
      // Without the columns the person's page still opens, with the standard fields.
      orgService.getMemberList(gymId).then(
        (res) => setList(res.data.list),
        () => undefined,
      );
    }
  };

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
  const days = sentByDay(page.messages, org?.timezone);
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
          <span className="c-avatar" aria-hidden="true" style={{ width: 56, height: 56 }}>
            <MessageSquare className="w-6 h-6" />
          </span>
          <h2 className="c-h2">You haven&apos;t sent a message yet</h2>
          <p className="c-s15 c-t2 max-w-[460px]">{`To send one, tick the ${words.people} you want on your list, then press Send message.`}</p>
          <Link to={back} className="c-btn c-btn-p c-btn-lg mt-2">
            {`Go to ${words.people}`}
          </Link>
        </section>
      ) : null}

      {may && !page.loading && !first ? (
        <>
          {/* How many more can go today, and the way to send one: a gym that can change
              nothing sends none, so it has neither. */}
          {!readOnly && page.leftToday !== null ? (
            <section className="c-card px-4 py-3.5 md:px-5 flex flex-wrap items-center gap-x-4 gap-y-3" data-testid="sent-today">
              <p className="c-s15 c-t1 m-0 flex-1 min-w-[220px]">{sentTodayWords(page.leftToday)}</p>
              {page.leftToday > 0 ? (
                <Link to={back} className="c-btn c-btn-soft c-btn-lg" data-testid="sent-send-one">
                  <MessageSquare aria-hidden="true" className="w-4 h-4" />
                  Send a message
                </Link>
              ) : null}
            </section>
          ) : null}

          {days.map((day) => (
            <section key={day.key} className="flex flex-col gap-3" data-testid="sent-day">
              <h2 className="c-s14 c-w6 c-t2 m-0 uppercase tracking-wide" data-testid="sent-day-heading">
                {day.heading}
              </h2>
              {day.messages.map((one) => (
                <article key={one.id} className="c-card p-4 md:p-5 grid grid-cols-[minmax(0,1fr)_auto] gap-3" data-testid="sent-message">
                  {/* On a phone the button sits under the words; beside the sender on a computer. */}
                  <div className="flex items-center gap-3 min-w-0 col-span-2 md:col-span-1">
                    <span className="c-avatar" aria-hidden="true" style={{ width: 40, height: 40, fontSize: 14 }}>
                      {one.sentByName === null ? <User className="w-[18px] h-[18px]" /> : initialsOf(one.sentByName)}
                    </span>
                    <p className="m-0 flex flex-col flex-1 min-w-0" data-testid="sent-message-by">
                      <span className="c-s15 c-w6 c-t1 c-ell">{one.sentByName ?? MEMBER_NOTE_NO_AUTHOR_WORDS}</span>
                      <span className="c-s13 c-t2 c-num">{sentTime(one.sentAt, org?.timezone, org?.clockFormat)}</span>
                    </p>
                  </div>
                  <button
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => setNamesFor(one)}
                      data-testid="sent-message-people"
                      className="c-btn c-btn-s c-btn-sm col-span-2 row-start-3 justify-self-start md:col-span-1 md:col-start-2 md:row-start-1 md:self-center"
                    >
                      <Users aria-hidden="true" className="w-4 h-4" />
                      {sentToWords(one.people)}
                      <ChevronRight aria-hidden="true" className="w-4 h-4" />
                    </button>
                  <p className="c-s16 c-t1 m-0 whitespace-pre-wrap break-words col-span-2 row-start-2" data-testid="sent-message-words">
                    {one.body}
                  </p>
                </article>
              ))}
            </section>
          ))}
          {page.next !== null ? (
            <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="c-btn c-btn-s c-btn-lg w-full md:w-auto md:self-start">
              {loadingMore ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
        </>
      ) : null}

      <ScrollJump />

      {namesFor !== null && gymId !== null ? <SentTo gymId={gymId} message={namesFor} onOpenPerson={openPerson} onClose={() => setNamesFor(null)} /> : null}

      {personId !== null && gymId !== null ? (
        <MemberListPerson
          key={personId}
          gymId={gymId}
          gym={org}
          entryId={personId}
          list={list}
          words={words}
          readOnly={readOnly}
          canRemove={canRemoveMembers(privileges)}
          onClose={() => setPersonId(null)}
          onChanged={() => undefined}
        />
      ) : null}
    </div>
  );
}
