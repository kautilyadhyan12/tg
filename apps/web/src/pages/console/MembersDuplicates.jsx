import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Loader2 } from 'lucide-react';
import { orgWords } from '@app/shared';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import ScrollJump from '../../components/console/ScrollJump';
import { orgService, errorText } from '../../api/orgsApi';
import { useConsoleOrg } from './useConsoleOrg';
import MemberListPerson from './MemberListPerson';
import { canRemoveMembers, viewerPrivileges } from './consoleView';
import { consoleIsReadOnly } from './billingView';
import { contactWords, duplicatesSignWords, pairWhyWords } from './memberListPeople';

// POSSIBLE DUPLICATES (ROADMAP 5b-iv-a; RULINGS 2026-09-25, 2026-09-30): pairs of records that
// share a name, a phone or a member number, fifty at a time. A pair opens the two side by
// side, where staff Merge them or mark them Different people; either takes the pair off this
// page. The app never merges anyone on its own.

/** The most pages a re-read after a change walks to keep staff's place. */
const RELOAD_PAGES_MAX = 5;

/** One record of a pair: name, contact, and "Past member" when it is one. */
function Side({ person }) {
  return (
    <span className="flex flex-col gap-0.5 min-w-0">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="c-s15 c-w6 c-t1 c-ell">{person.fullName || 'No name'}</span>
        {person.past ? <span className="c-tag c-tag-plain">Past member</span> : null}
      </span>
      <span className="c-s13 c-t2 c-ell">{contactWords(person)}</span>
    </span>
  );
}

export default function MembersDuplicates() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const words = orgWords(org?.orgType);
  const gymId = org?.id ?? null;
  const readOnly = consoleIsReadOnly(org);
  const canRemove = canRemoveMembers(viewerPrivileges(org));

  const [page, setPage] = useState({ loading: true, error: null, pairs: [], total: 0, cursor: null });
  const [list, setList] = useState(null);
  const [tick, setTick] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  /** The pair open side by side: its first record, the other, and what they share. */
  const [open, setOpen] = useState(null);
  /** How many were loaded when a change asked for the page again, so staff keep their place. */
  const keepLoaded = useRef(0);

  useEffect(() => {
    if (gymId === null) return undefined;
    let live = true;
    const want = keepLoaded.current;
    keepLoaded.current = 0;
    const read = async () => {
      let p = (await orgService.getMemberListDuplicates(gymId, null)).data.page;
      let pairs = p.pairs;
      let pages = 1;
      while (pairs.length < want && pages < RELOAD_PAGES_MAX && p.cursor !== null && live) {
        pages += 1;
        p = (await orgService.getMemberListDuplicates(gymId, p.cursor)).data.page;
        pairs = [...pairs, ...p.pairs];
      }
      return { pairs, total: p.total, cursor: p.cursor };
    };
    read().then(
      (got) => {
        if (live) setPage({ loading: false, error: null, ...got });
      },
      (err) => {
        if (live) setPage((was) => ({ ...was, loading: false, error: errorText(err, `We couldn't load possible duplicates.`) }));
      },
    );
    return () => {
      live = false;
    };
  }, [gymId, tick]);

  // The gym's own columns and words, for the side-by-side table and the person's page.
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
      const next = (await orgService.getMemberListDuplicates(gymId, page.cursor)).data.page;
      setPage((was) => ({ ...was, pairs: [...was.pairs, ...next.pairs], total: next.total, cursor: next.cursor }));
    } catch (err) {
      setPage((was) => ({ ...was, error: errorText(err, `We couldn't load more.`) }));
    } finally {
      setLoadingMore(false);
    }
  }, [gymId, page.cursor]);

  const changed = () => {
    keepLoaded.current = page.pairs.length;
    setTick((n) => n + 1);
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
    <div className="c-page" data-testid="members-duplicates">
      <header className="flex flex-col gap-2">
        <Link to={back} className="c-s14 c-w6 c-lk self-start flex items-center gap-1.5">
          <ArrowLeft aria-hidden="true" className="w-4 h-4" />
          {words.peopleCap}
        </Link>
        <h1 className="c-h1">Possible duplicates</h1>
        <p className="c-sub">
          {`Each pair shares a name, a phone or a member number. Open a pair to see both side by side, then Merge them or choose Different people. Nobody is merged unless you merge them.`}
        </p>
      </header>

      {page.loading ? <ConsoleLoading label="Loading…" newLook /> : null}
      {page.error !== null ? <ConsoleFailed message={page.error} onRetry={() => setTick((n) => n + 1)} newLook /> : null}

      {!page.loading && page.error === null && page.total === 0 ? (
        <section className="c-card px-6 py-12 flex flex-col items-center gap-3 text-center" data-testid="duplicates-none">
          <h2 className="c-h2">No possible duplicates</h2>
          <p className="c-s15 c-t2 max-w-[460px]">{`No two ${words.people} on your list share a name, a phone or a member number.`}</p>
          <Link to={back} className="c-btn c-btn-s c-btn-lg mt-2">
            {`Back to ${words.people}`}
          </Link>
        </section>
      ) : null}

      {!page.loading && page.pairs.length > 0 ? (
        <>
          <p className="c-s14 c-t2 c-num" data-testid="duplicates-total">
            {duplicatesSignWords(page.total, words)}
          </p>
          <section className="c-card overflow-hidden">
            <ul>
              {page.pairs.map((pair, i) => (
                <li key={`${pair.first.entryId}/${pair.second.entryId}`} className={i > 0 ? 'border-t' : ''} style={{ borderColor: 'var(--line)' }}>
                  <button
                    type="button"
                    data-testid="duplicate-pair"
                    onClick={() => setOpen({ id: pair.first.entryId, pair: { otherId: pair.second.entryId, why: pairWhyWords(pair) } })}
                    className="w-full flex items-center gap-3 text-left min-h-11 px-4 py-3.5 md:px-5"
                  >
                    <span className="flex flex-col gap-2 flex-1 min-w-0">
                      <span className="c-s14 c-w6" style={{ color: 'var(--warn)' }} data-testid="duplicate-why">
                        {pairWhyWords(pair)}
                      </span>
                      <span className="grid gap-2 md:grid-cols-2">
                        <Side person={pair.first} />
                        <Side person={pair.second} />
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

      {open !== null && gymId !== null ? (
        <MemberListPerson
          key={`${open.id}/${open.pair.otherId}`}
          gymId={gymId}
          gym={org}
          entryId={open.id}
          pair={open.pair}
          list={list}
          words={words}
          readOnly={readOnly}
          canRemove={canRemove}
          onClose={() => setOpen(null)}
          onChanged={changed}
        />
      ) : null}
    </div>
  );
}
