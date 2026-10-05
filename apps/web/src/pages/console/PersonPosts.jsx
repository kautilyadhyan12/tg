import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { postPhotoUrl, staffPostsService } from '../../api/postsApi';
import { errorStatus, errorText } from '../../api/orgsApi';
import PhotoViewer from '../../components/common/PhotoViewer';
import { staffPersonPosts, stopBox, withPage, withStopped, withoutPost } from '../../components/gym/postsView';
import PostCard from './UpdatesPostCard';

// ONE PERSON'S POSTS, FOR STAFF (spec Part 3 §15.2, §15.5; ROADMAP 19b-ii-c): what they
// posted as a member, newest first, each with Remove post and Stop them posting. On a
// person's panel on the Leaderboard page and in a box opened from a name on Updates.
// `posts.manage`'s; the server refuses anyone else whatever this screen shows.

export default function PersonPosts({ gymId, gymName, person, words, readOnly, heading = true, onChanged = null }) {
  const [state, setState] = useState({ loading: true, error: null, feed: null });
  const [more, setMore] = useState({ loading: false, error: null });
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [viewing, setViewing] = useState(null);
  const lines = staffPersonPosts(person.name, words);

  const load = useCallback(
    () =>
      staffPostsService.person(gymId, person.userId).then(
        (page) => setState({ loading: false, error: null, feed: { pinned: [], ...page } }),
        (err) => setState({ loading: false, error: errorText(err, "We couldn't load their posts."), feed: null }),
      ),
    [gymId, person.userId],
  );
  useEffect(() => {
    load();
  }, [load]);

  const showMore = async () => {
    setMore({ loading: true, error: null });
    try {
      const page = await staffPostsService.person(gymId, person.userId, state.feed.next);
      setState((s) => (s.feed === null ? s : { ...s, feed: withPage(s.feed, page) }));
      setMore({ loading: false, error: null });
    } catch (err) {
      setMore({ loading: false, error: errorText(err, "We couldn't load more.") });
    }
  };

  const act = async (post, request, done, change) => {
    setBusy(post.id);
    setNotice(null);
    setActionError(null);
    try {
      await request();
      setState((s) => (s.feed === null ? s : { ...s, feed: change(s.feed) }));
      setNotice(done);
      if (onChanged !== null) onChanged();
    } catch (err) {
      setActionError(errorText(err, "We couldn't change that. Please try again."));
      // Removed somewhere else in the meantime: show what is true now.
      if (errorStatus(err) === 404) await load();
    } finally {
      setBusy(null);
    }
  };

  const feed = state.feed;
  return (
    <section className="flex flex-col gap-3" aria-label={lines.title} data-testid="person-posts">
      {heading ? <h3 className="c-s16 c-w6 c-t1">{lines.title}</h3> : null}
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
      {state.loading ? <p className="c-s14 c-t2">Loading…</p> : null}
      {state.error !== null ? (
        <p className="c-s14 c-t1" role="alert">
          {state.error}
        </p>
      ) : null}
      {feed !== null && feed.posts.length === 0 ? <p className="c-s14 c-t2">{lines.empty}</p> : null}
      {feed !== null && feed.posts.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {feed.posts.map((post) => (
            <PostCard
              key={post.id}
              gymId={gymId}
              gymName={gymName}
              post={post}
              words={words}
              readOnly={readOnly}
              busy={busy === post.id}
              onRemove={(p) => act(p, () => staffPostsService.remove(gymId, p.id), `Post removed. Your ${words.people} no longer see it.`, (shown) => withoutPost(shown, p.id))}
              onStop={(p, stopped) =>
                act(
                  p,
                  () => staffPostsService.setStopped(gymId, p.authorId, stopped),
                  stopped ? stopBox(p.author.name).done : stopBox(p.author.name).undone,
                  (shown) => withStopped(shown, p.authorId, stopped),
                )
              }
              onOpen={(p, index) => setViewing({ post: p, index })}
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
    </section>
  );
}

/** The same list in a box over the page, opened from a name on Updates. */
export function PersonPostsBox({ gymId, gymName, person, words, readOnly, onClose, onChanged }) {
  // The page behind holds still while the box is open.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, []);
  // The box is headed as the list is: "Wendy Writer's posts".
  const title = staffPersonPosts(person.name, words).title;
  return (
    <div className="fixed inset-0 z-50" style={{ background: 'var(--scrim)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="person-posts-box"
        className="c-sheet absolute inset-x-0 bottom-0 top-16 md:top-16 md:bottom-auto md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[600px] md:max-h-[calc(100%-96px)] flex flex-col rounded-t-[20px] md:rounded-[20px] border"
        style={{ borderColor: 'var(--card-line)' }}
      >
        <div className="flex items-center gap-3 pl-4 pr-2 pt-3 md:px-7 md:pt-6 md:pb-2">
          <h2 className="c-h2 flex-grow" style={{ fontSize: 22, lineHeight: '28px', fontWeight: 700 }}>
            {title}
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="c-icon-btn">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 pt-2 pb-4 md:px-7 md:pt-3 md:pb-6 overflow-y-auto overscroll-contain flex-grow min-h-0">
          <PersonPosts gymId={gymId} gymName={gymName} person={person} words={words} readOnly={readOnly} heading={false} onChanged={onChanged} />
        </div>
        <div className="flex px-4 pt-3 pb-5 md:px-7 md:py-4 border-t md:justify-end" style={{ borderColor: 'var(--line)', background: 'var(--card)' }}>
          <button type="button" onClick={onClose} className="c-btn c-btn-s c-btn-lg">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
