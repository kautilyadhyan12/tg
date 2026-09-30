import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Loader2 } from 'lucide-react';
import { memberListReviewShortWords, orgWords } from '@app/shared';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import ScrollJump from '../../components/console/ScrollJump';
import { orgService, errorText } from '../../api/orgsApi';
import { useConsoleOrg } from './useConsoleOrg';
import { refreshConsoleOrgsAfterChange } from './consoleOrgs';
import MemberListPerson from './MemberListPerson';
import { canRemoveMembers, viewerPrivileges } from './consoleView';
import { consoleIsReadOnly } from './billingView';
import { reviewSignWords } from './memberListPeople';

// THE REVIEW PAGE (ROADMAP 5b-v-d-iv; Kd at its click-through: "make a separate page when
// click on goes there"): everyone an import found a problem with, a hundred at a time, each
// with what is wrong in a few words. A row opens the person's page, where they are fixed or
// marked correct; anyone fixed leaves this list.

/** The most pages a re-read after a change walks to keep staff's place. */
const RELOAD_PAGES_MAX = 5;

/** "Phone: looks unusual · Join date: not a date". */
function problemWords(person) {
  return person.review.map((line) => `${line.label}: ${memberListReviewShortWords(line.problem)}`).join(' · ');
}

export default function MembersReview() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const words = orgWords(org?.orgType);
  const gymId = org?.id ?? null;
  const readOnly = consoleIsReadOnly(org);
  const canRemove = canRemoveMembers(viewerPrivileges(org));

  const [page, setPage] = useState({ loading: true, error: null, people: [], total: 0, cursor: null });
  const [list, setList] = useState(null);
  const [tick, setTick] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openId, setOpenId] = useState(null);
  /** How many were loaded when a change asked for the page again, so staff keep their place. */
  const keepLoaded = useRef(0);

  useEffect(() => {
    if (gymId === null) return undefined;
    let live = true;
    const want = keepLoaded.current;
    keepLoaded.current = 0;
    const read = async () => {
      let p = (await orgService.getMemberListReview(gymId, null)).data.page;
      let people = p.people;
      let pages = 1;
      while (people.length < want && pages < RELOAD_PAGES_MAX && p.cursor !== null && live) {
        pages += 1;
        p = (await orgService.getMemberListReview(gymId, p.cursor)).data.page;
        people = [...people, ...p.people];
      }
      return { people, total: p.total, cursor: p.cursor };
    };
    read().then(
      (got) => {
        if (live) setPage({ loading: false, error: null, ...got });
      },
      (err) => {
        if (live) setPage((was) => ({ ...was, loading: false, error: errorText(err, `We couldn't load who needs review.`) }));
      },
    );
    return () => {
      live = false;
    };
  }, [gymId, tick]);

  // The gym's own columns and words, for the person's page and its Edit form.
  useEffect(() => {
    if (gymId === null) return undefined;
    let live = true;
    orgService.getMemberList(gymId).then(
      (res) => {
        if (live) setList(res.data.list);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gymId, tick]);

  const loadMore = useCallback(async () => {
    if (gymId === null || page.cursor === null) return;
    setLoadingMore(true);
    try {
      const next = (await orgService.getMemberListReview(gymId, page.cursor)).data.page;
      setPage((was) => ({ ...was, people: [...was.people, ...next.people], total: next.total, cursor: next.cursor }));
    } catch (err) {
      setPage((was) => ({ ...was, error: errorText(err, `We couldn't load more.`) }));
    } finally {
      setLoadingMore(false);
    }
  }, [gymId, page.cursor]);

  const changed = () => {
    keepLoaded.current = page.people.length;
    setTick((n) => n + 1);
    refreshConsoleOrgsAfterChange();
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
  return (
    <div className="c-page" data-testid="members-review">
      <header className="flex flex-col gap-2">
        <Link to={back} className="c-s14 c-w6 c-lk self-start flex items-center gap-1.5">
          <ArrowLeft aria-hidden="true" className="w-4 h-4" />
          {words.peopleCap}
        </Link>
        <h1 className="c-h1">{`${words.peopleCap} who need review`}</h1>
        <p className="c-sub">{`An import found something to check on each. Open a ${words.person} to fix it, or press It's correct.`}</p>
      </header>

      {page.loading ? <ConsoleLoading label="Loading…" newLook /> : null}
      {page.error !== null ? <ConsoleFailed message={page.error} onRetry={() => setTick((n) => n + 1)} newLook /> : null}

      {!page.loading && page.error === null && page.total === 0 ? (
        <section className="c-card px-6 py-12 flex flex-col items-center gap-3 text-center" data-testid="review-none">
          <h2 className="c-h2">Nobody needs review</h2>
          <p className="c-s15 c-t2 max-w-[460px]">Everything your imports found has been fixed or checked.</p>
          <Link to={back} className="c-btn c-btn-s c-btn-lg mt-2">
            {`Back to ${words.people}`}
          </Link>
        </section>
      ) : null}

      {!page.loading && page.people.length > 0 ? (
        <>
          <p className="c-s14 c-t2 c-num" data-testid="review-total">
            {reviewSignWords(page.total, words)}
          </p>
          <section className="c-card overflow-hidden">
            <ul>
              {page.people.map((person, i) => (
                <li key={person.entryId} className={i > 0 ? 'border-t' : ''} style={{ borderColor: 'var(--line)' }}>
                  <button
                    type="button"
                    data-testid="review-row"
                    onClick={() => setOpenId(person.entryId)}
                    className="w-full flex items-center gap-3 text-left min-h-11 px-4 py-3.5 md:px-5"
                  >
                    <span className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <span className="c-s15 c-w6 c-t1 c-ell">{person.fullName || 'No name'}</span>
                      <span className="c-s13 c-t2 c-ell">{person.email ?? person.phone ?? ''}</span>
                      <span className="c-s14 c-w6" style={{ color: 'var(--warn)' }} data-testid="review-problems">
                        {problemWords(person)}
                      </span>
                    </span>
                    <ChevronRight aria-hidden="true" className="w-[18px] h-[18px] c-t3 flex-none" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {page.cursor !== null ? (
            <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="c-btn c-btn-s c-btn-lg w-full md:w-auto md:self-start">
              {loadingMore ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
        </>
      ) : null}

      <ScrollJump />

      {openId !== null && gymId !== null ? (
        <MemberListPerson
          key={openId}
          gymId={gymId}
          gym={org}
          entryId={openId}
          list={list}
          words={words}
          readOnly={readOnly}
          canRemove={canRemove}
          onClose={() => setOpenId(null)}
          onChanged={changed}
        />
      ) : null}
    </div>
  );
}
