import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ImagePlus, UserCheck, X } from 'lucide-react';
import { postPhotoUrl, staffPostsService } from '../../api/postsApi';
import { errorStatus, errorText } from '../../api/orgsApi';
import PhotoViewer from '../../components/common/PhotoViewer';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import {
  POST_LIMITS,
  addPostPhotos,
  canPost,
  charsLine,
  keepNote,
  memberPostsSwitch,
  personOf,
  photoProblem,
  reportedMore,
  reportedTitle,
  stopBox,
  withPage,
  withPinChange,
  withStopped,
  withoutPost,
} from '../../components/gym/postsView';
import { preparePostPhoto } from './gymPagePhotos';
import { PersonPostsBox } from './PersonPosts';
import PostCard from './UpdatesPostCard';
import { useConsoleOrg } from './useConsoleOrg';
import { orgWords } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';

// The gym's Updates, for staff (ROADMAP 19b-i, 19b-ii-a; spec Part 3 §15.2, §15.3): write a
// post with up to four photos, pin it to the top, remove it; let members post, answer the
// posts they report, and stop a person posting. `posts.manage`'s; the server refuses anyone
// else whatever this screen shows.

const newKey = () => globalThis.crypto.randomUUID();

function Composer({ gymId, gymName, words, onPosted }) {
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState([]);
  // One key a post: pressed again after a lost reply, the server answers with the post it kept.
  const [postKey, setPostKey] = useState(newKey);
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const pickerRef = useRef(null);
  const chars = charsLine(body);

  const pick = async (files) => {
    setPreparing(true);
    const prepared = [];
    const unreadable = [];
    const tooBig = [];
    for (const file of files) {
      try {
        prepared.push(await preparePostPhoto(file));
      } catch (err) {
        (err.message === 'too_big' ? tooBig : unreadable).push(file.name);
      }
    }
    setPreparing(false);
    const added = addPostPhotos(photos, prepared);
    for (const unused of prepared.slice(prepared.length - added.left)) URL.revokeObjectURL?.(unused.preview);
    setPhotos(added.photos);
    setProblem(photoProblem({ unreadable, tooBig, left: added.left }));
  };

  const takeOff = (photo) => {
    URL.revokeObjectURL?.(photo.preview);
    setPhotos((list) => list.filter((p) => p.key !== photo.key));
    setProblem(null);
  };

  const post = async () => {
    setSending(true);
    setError(null);
    try {
      const done = await staffPostsService.add(
        gymId,
        postKey,
        body,
        photos.map((p) => p.base64),
      );
      for (const photo of photos) URL.revokeObjectURL?.(photo.preview);
      setBody('');
      setPhotos([]);
      setProblem(null);
      setPostKey(newKey());
      onPosted(done.post);
    } catch (err) {
      setError(errorText(err, "We couldn't post that. Please try again."));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="c-card p-4 md:p-5 flex flex-col gap-3" aria-label="Write a post" data-testid="composer">
      <label className="c-field">
        <span className="c-label">Write a post</span>
        <textarea
          className="c-area"
          rows={4}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setError(null);
          }}
          placeholder={`What's new at ${gymName}?`}
          aria-describedby="post-chars"
        />
        <span id="post-chars" className="c-hint" style={chars.over ? { color: 'var(--bad)' } : undefined}>
          {chars.text}
        </span>
      </label>

      {photos.length > 0 ? (
        <ul className="grid grid-cols-2 md:grid-cols-4 gap-2" aria-label="Photos on this post">
          {photos.map((photo, i) => (
            <li key={photo.key} className="relative rounded-[10px] overflow-hidden" style={{ aspectRatio: '1 / 1', background: 'var(--raise)' }}>
              <img src={photo.preview} alt={`Photo ${i + 1} of ${photos.length}`} className="w-full h-full object-cover" />
              <button
                type="button"
                aria-label={`Take photo ${i + 1} off this post`}
                onClick={() => takeOff(photo)}
                disabled={sending}
                className="c-icon-btn absolute top-1 right-1"
                style={{ background: 'var(--scrim)', color: 'var(--on-accent)' }}
              >
                <X aria-hidden="true" className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {problem !== null ? (
        <p className="c-s14 c-t1" role="alert">
          {problem}
        </p>
      ) : null}
      {error !== null ? (
        <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <input
          ref={pickerRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          hidden
          aria-label="Choose photos"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length > 0) pick(files);
          }}
        />
        <button
          type="button"
          onClick={() => pickerRef.current?.click()}
          disabled={sending || preparing || photos.length >= POST_LIMITS.photos}
          className="c-btn c-btn-s"
        >
          <ImagePlus aria-hidden="true" className="w-[18px] h-[18px]" />
          {preparing ? 'Adding…' : 'Add photos'}
        </button>
        <span className="c-hint md:flex-grow">{`Up to ${POST_LIMITS.photos} photos. Where a photo was taken is never kept.`}</span>
        <button type="button" onClick={post} disabled={sending || preparing || !canPost(body, photos)} className="c-btn c-btn-p">
          {sending ? 'Posting…' : `Post to your ${words.people}`}
        </button>
      </div>
      <p className="c-hint">{`Every one of your ${words.people} in the app sees it straight away. Nobody is emailed.`}</p>
    </section>
  );
}

export default function Updates() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const gymId = org?.id ?? null;
  const words = orgWords(org?.orgType);
  const readOnly = consoleIsReadOnly(org);

  const [state, setState] = useState({ loading: true, error: null, refused: false, feed: null });
  /** The reported posts and the people stopped from posting; null until read. */
  const [side, setSide] = useState({ reported: null, stopped: null });
  const [switching, setSwitching] = useState(false);
  const [more, setMore] = useState({ loading: false, error: null });
  /** The post a pin or a removal is on its way for. */
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [viewing, setViewing] = useState(null);
  /** The person whose posts are open in a box. */
  const [person, setPerson] = useState(null);

  const loadSide = useCallback(() => {
    if (gymId === null) return Promise.resolve();
    // Read beside the posts: one that fails leaves its part of the page as it was.
    return Promise.allSettled([staffPostsService.reported(gymId), staffPostsService.stopped(gymId)]).then(([reported, stopped]) =>
      setSide((was) => ({
        reported: reported.status === 'fulfilled' ? reported.value : was.reported,
        stopped: stopped.status === 'fulfilled' ? stopped.value : was.stopped,
      })),
    );
  }, [gymId]);

  const load = useCallback(() => {
    if (gymId === null) return Promise.resolve();
    loadSide();
    return staffPostsService.list(gymId).then(
      (feed) => setState({ loading: false, error: null, refused: false, feed }),
      (err) =>
        setState((s) => ({
          loading: false,
          error: errorText(err, "We couldn't load your updates."),
          refused: errorStatus(err) === 403,
          feed: s.feed,
        })),
    );
  }, [gymId, loadSide]);

  useEffect(() => {
    load();
  }, [load]);

  const showMore = async () => {
    setMore({ loading: true, error: null });
    try {
      const page = await staffPostsService.list(gymId, state.feed.next);
      setState((s) => (s.feed === null ? s : { ...s, feed: withPage(s.feed, page) }));
      setMore({ loading: false, error: null });
    } catch (err) {
      setMore({ loading: false, error: errorText(err, "We couldn't load more.") });
    }
  };

  /** A pin or a removal, then the list as the server now has it. */
  // The list is changed in place, so older posts already loaded stay where staff were.
  const act = async (post, request, done, change) => {
    setBusy(post.id);
    setNotice(null);
    setActionError(null);
    try {
      const answer = await request();
      setState((s) => (s.feed === null ? s : { ...s, feed: change(s.feed, answer) }));
      setNotice(typeof done === 'function' ? done(answer) : done);
      await loadSide();
    } catch (err) {
      setActionError(errorText(err, "We couldn't change that. Please try again."));
      // Removed or pinned somewhere else in the meantime: show what is true now.
      if (errorStatus(err) === 404 || errorStatus(err) === 409) await load();
    } finally {
      setBusy(null);
    }
  };

  const onSwitch = async (on) => {
    const lines = memberPostsSwitch(on, words);
    setSwitching(true);
    setNotice(null);
    setActionError(null);
    try {
      const saved = await staffPostsService.setMembersCanPost(gymId, on);
      setState((s) => (s.feed === null ? s : { ...s, feed: { ...s.feed, membersCanPost: saved.membersCanPost } }));
      setNotice(on ? lines.on : lines.off);
    } catch (err) {
      setActionError(errorText(err, "We couldn't change that. Please try again."));
    } finally {
      setSwitching(false);
    }
  };

  const cardActions = {
    onPin: (p, pinned) =>
      act(
        p,
        () => staffPostsService.setPinned(gymId, p.id, pinned),
        pinned ? 'Pinned to the top.' : 'Unpinned.',
        (shown, answer) => withPinChange(shown, answer.post),
      ),
    onRemove: (p) =>
      act(
        p,
        () => staffPostsService.remove(gymId, p.id),
        `Post removed. Your ${words.people} no longer see it.`,
        (shown) => withoutPost(shown, p.id),
      ),
    // Keep answers the reports this list showed, and none when another has arrived; the list is read again.
    onKeep: (p, item) => act(p, () => staffPostsService.keep(gymId, p.id, item.allReports), keepNote, (shown) => shown),
    onStop: (p, stopped) =>
      act(
        p,
        () => staffPostsService.setStopped(gymId, p.authorId, stopped),
        stopped ? stopBox(p.author.name).done : stopBox(p.author.name).undone,
        (shown) => withStopped(shown, p.authorId, stopped),
      ),
    onOpen: (p, index) => setViewing({ post: p, index }),
    onPerson: (p) => setPerson(personOf(p)),
  };

  if (orgLoading) {
    return (
      <div className="c-page">
        <ConsoleLoading label="Loading your organisation…" newLook />
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

  const feed = state.feed;
  const all = feed === null ? [] : [...feed.pinned, ...feed.posts];
  const reported = side.reported;
  const stoppedPeople = side.stopped?.people ?? [];
  const switchLines = feed === null ? null : memberPostsSwitch(feed.membersCanPost, words);
  const waiting = reported === null ? null : reportedMore(reported);
  return (
    <div className="c-page">
      <header className="flex flex-col gap-1.5 min-w-0">
        <h1 className="c-h1">Updates</h1>
        <p className="c-sub">{`News from ${org.name} that your ${words.people} read in their app`}</p>
      </header>

      {readOnly && !state.refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{`${readOnlyNote(org?.orgType)} Your ${words.people} can't see these posts until then.`}</p>
        </section>
      ) : null}

      {state.refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{state.error}</p>
        </section>
      ) : (
        <>
          {!readOnly && gymId !== null ? (
            <Composer
              gymId={gymId}
              gymName={org.name}
              words={words}
              onPosted={() => {
                setActionError(null);
                setNotice(`Posted. Your ${words.people} can see it now.`);
                load();
              }}
            />
          ) : null}

          {switchLines !== null ? (
            <section className="c-card" aria-label={switchLines.label}>
              <div className="c-row" data-testid="members-can-post">
                <div className="flex flex-col gap-0.5 min-w-0 flex-grow">
                  <span className="c-s15 c-w6 c-t1">{switchLines.label}</span>
                  <span className="c-s13 c-t2">{switchLines.line}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={feed.membersCanPost}
                  aria-label={switchLines.label}
                  disabled={readOnly || switching}
                  onClick={() => onSwitch(!feed.membersCanPost)}
                  className={feed.membersCanPost ? 'c-switch c-switch-on' : 'c-switch'}
                />
              </div>
            </section>
          ) : null}

          {notice !== null ? (
            <p className="c-s14 c-w6" role="status" style={{ color: 'var(--good)' }}>
              {notice}
            </p>
          ) : null}
          {actionError !== null ? (
            <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
              {actionError}
            </p>
          ) : null}

          {reported !== null && reported.items.length > 0 ? (
            <section className="flex flex-col gap-3" aria-label="Reported posts" data-testid="reported">
              <div className="flex flex-col gap-1">
                <h2 className="c-s15 c-w6 c-t1">{reportedTitle(reported.total)}</h2>
                <p className="c-s13 c-t2">{`Remove a post and it's gone for everyone. Keep it and it stays on Updates. Your ${words.people} are never told who reported a post, and neither are you.`}</p>
                {waiting !== null ? <p className="c-s13 c-t2">{waiting}</p> : null}
              </div>
              <ul className="flex flex-col gap-3">
                {reported.items.map((item) => (
                  <PostCard
                    key={item.post.id}
                    gymId={gymId}
                    gymName={reported.gymName}
                    post={item.post}
                    report={item}
                    pinnedCount={0}
                    words={words}
                    readOnly={readOnly}
                    busy={busy === item.post.id}
                    {...cardActions}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {stoppedPeople.length > 0 ? (
            <section className="c-card" aria-label="Stopped from posting" data-testid="stopped">
              <div className="px-4 md:px-5 pt-4 flex flex-col gap-1">
                <h2 className="c-s15 c-w6 c-t1">Stopped from posting</h2>
                <p className="c-s13 c-t2">They can read and react, but not post, until you let them again.</p>
              </div>
              {stoppedPeople.map((person) => (
                <div key={person.userId} className="c-row">
                  <span className="c-s15 c-t1 min-w-0 flex-grow c-ell">{person.name ?? 'No name yet'}</span>
                  <button
                    type="button"
                    disabled={readOnly || busy === person.userId}
                    onClick={() =>
                      act(
                        { id: person.userId },
                        () => staffPostsService.setStopped(gymId, person.userId, false),
                        stopBox(person.name).undone,
                        (shown) => withStopped(shown, person.userId, false),
                      )
                    }
                    className="c-btn c-btn-s c-btn-sm"
                  >
                    <UserCheck aria-hidden="true" className="w-4 h-4" />
                    Let them post again
                  </button>
                </div>
              ))}
            </section>
          ) : null}

          {state.loading ? <ConsoleLoading label="Loading your updates…" newLook /> : null}
          {!state.loading && feed === null ? <ConsoleFailed message={state.error} onRetry={load} newLook /> : null}

          {feed !== null && all.length === 0 ? (
            <section className="c-card p-5 md:p-6">
              <p className="c-s15 c-t2">{readOnly ? 'No posts yet.' : 'No posts yet. Write your first one above.'}</p>
            </section>
          ) : null}

          {all.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {all.map((post) => (
                <PostCard
                  key={post.id}
                  gymId={gymId}
                  gymName={feed.gymName}
                  post={post}
                  pinnedCount={feed.pinned.length}
                  words={words}
                  readOnly={readOnly}
                  busy={busy === post.id}
                  {...cardActions}
                />
              ))}
            </ul>
          ) : null}

          {feed !== null && feed.next !== null ? (
            <div className="flex items-center gap-3">
              <button type="button" onClick={showMore} disabled={more.loading} className="c-btn c-btn-s c-btn-sm">
                {more.loading ? 'Loading…' : 'Show older posts'}
              </button>
              {more.error !== null ? (
                <span className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
                  {more.error}
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {person !== null ? (
        <PersonPostsBox gymId={gymId} gymName={org.name} person={person} words={words} readOnly={readOnly} onClose={() => setPerson(null)} onChanged={load} />
      ) : null}

      {viewing !== null ? (
        <PhotoViewer
          photos={viewing.post.photos.map((photo, i) => ({
            key: photo.id,
            src: postPhotoUrl({ gymId, postId: viewing.post.id, photoId: photo.id }),
            alt: `Photo ${i + 1} of ${viewing.post.photos.length}`,
          }))}
          index={viewing.index}
          onIndex={(index) => setViewing((v) => (v === null ? v : { ...v, index }))}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}
