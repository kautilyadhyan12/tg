import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { postPhotoUrl, postsService } from '../../api/postsApi';
import { errorText } from '../../api/orgsApi';
import { preparePostPhoto } from '../../pages/console/gymPagePhotos';
import PhotoViewer from '../common/PhotoViewer';
import PersonProfile from './PersonProfile';
import PostCard from './PostCard';
import {
  POST_LIMITS,
  addPostPhotos,
  blockBox,
  blockedButton,
  blockedMore,
  canPost,
  charsLine,
  emptyLine,
  helpLine,
  memberCanPost,
  memberPostHint,
  personOf,
  photoProblem,
  reportBox,
  stoppedNote,
  unblockedNote,
  withNewPost,
  withPage,
  withPost,
  withReaction,
  withoutPost,
} from './postsView';

// THE GYM'S UPDATES, FOR A MEMBER (spec Part 3 §15.2, §15.3; ROADMAP 19b-i, 19b-ii-a).
// Posts by the gym's staff and, where the gym lets them, by its members, pinned ones
// first; one reaction a post and no comments. A member removes their own post and can
// report anybody else's. The server sends posts only to a live member of this gym.

const ORANGE = '#FF8A1F';
const MUTED = 'rgba(255,255,255,0.45)';
const RED = '#ef4444';
const QUIET = { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.75)' };
const SOFT = { background: 'rgba(255,138,31,0.15)', color: ORANGE };

const newKey = () => globalThis.crypto.randomUUID();

function Composer({ gymId, gymName, onPosted }) {
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
      const done = await postsService.add(
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
    <section className="rounded-xl p-3.5 mb-2.5 flex flex-col gap-2.5" style={{ background: 'rgba(255,255,255,0.03)' }} aria-label="Write a post" data-testid="composer">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-white">Write a post</span>
        <textarea
          rows={3}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setError(null);
          }}
          placeholder={`Share something with ${gymName}`}
          aria-describedby="member-post-chars"
          className="rounded-xl px-3 py-2.5 text-sm text-white w-full"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
        />
        <span id="member-post-chars" className="text-xs" style={{ color: chars.over ? RED : MUTED }}>
          {chars.text}
        </span>
      </label>

      {photos.length > 0 && (
        <ul className="grid grid-cols-4 gap-1.5" aria-label="Photos on this post">
          {photos.map((photo, i) => (
            <li key={photo.key} className="relative rounded-xl overflow-hidden" style={{ aspectRatio: '1 / 1', background: 'rgba(255,255,255,0.04)' }}>
              <img src={photo.preview} alt={`Photo ${i + 1} of ${photos.length}`} className="w-full h-full object-cover" />
              <button
                type="button"
                aria-label={`Take photo ${i + 1} off this post`}
                onClick={() => takeOff(photo)}
                disabled={sending}
                className="absolute top-1 right-1 w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}
              >
                <X aria-hidden="true" className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {problem !== null && (
        <p className="text-sm" role="alert" style={{ color: 'rgba(255,255,255,0.88)' }}>
          {problem}
        </p>
      )}
      {error !== null && (
        <p className="text-sm" role="alert" style={{ color: RED }}>
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
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
          className="rounded-xl px-3.5 text-sm font-semibold min-h-11 flex items-center gap-1.5 disabled:opacity-40"
          style={QUIET}
        >
          <ImagePlus aria-hidden="true" className="w-4 h-4" />
          {preparing ? 'Adding…' : 'Add photos'}
        </button>
        <button
          type="button"
          onClick={post}
          disabled={sending || preparing || !canPost(body, photos)}
          className="rounded-xl px-4 text-sm font-bold min-h-11 ml-auto disabled:opacity-40"
          style={{ background: ORANGE, color: '#111' }}
        >
          {sending ? 'Posting…' : 'Post'}
        </button>
      </div>
      <p className="text-xs" style={{ color: MUTED }}>
        {memberPostHint(gymName)}
      </p>
    </section>
  );
}

export default function Updates({ gym }) {
  const gymId = gym.id;
  const [state, setState] = useState({ loading: true, error: null, feed: null });
  const [more, setMore] = useState({ loading: false, error: null });
  /** The post whose reaction is on its way, and what went wrong with the last one. */
  const [reacting, setReacting] = useState(null);
  const [reactError, setReactError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [viewing, setViewing] = useState(null);
  /** The member's blocked list once opened: null while closed. */
  const [blocked, setBlocked] = useState(null);
  const [unblocking, setUnblocking] = useState(null);
  /** The person whose profile is open. */
  const [person, setPerson] = useState(null);

  const load = useCallback(
    () =>
      postsService.list(gymId).then(
        (feed) => setState({ loading: false, error: null, feed }),
        (err) => setState({ loading: false, error: errorText(err, "Couldn't load the updates."), feed: null }),
      ),
    [gymId],
  );

  useEffect(() => {
    load();
  }, [load]);

  const tryAgain = () => {
    setState({ loading: true, error: null, feed: null });
    load();
  };

  const change = (fn) => setState((s) => (s.feed === null ? s : { ...s, feed: fn(s.feed) }));

  const showMore = async () => {
    setMore({ loading: true, error: null });
    try {
      const page = await postsService.list(gymId, state.feed.next);
      change((feed) => withPage(feed, page));
      setMore({ loading: false, error: null });
    } catch (err) {
      setMore({ loading: false, error: errorText(err, "Couldn't load more.") });
    }
  };

  const onReact = async (post, tapped) => {
    const next = withReaction(post, tapped);
    setReactError(null);
    setReacting(post.id);
    change((feed) => withPost(feed, next));
    try {
      const done = await postsService.react(gymId, post.id, next.mine);
      change((feed) => withPost(feed, { ...next, reactions: done.reactions, mine: done.mine }));
    } catch (err) {
      // Put back as it was: the tap did not reach the gym's page.
      change((feed) => withPost(feed, post));
      setReactError(errorText(err, "Couldn't save your reaction. Please try again."));
    } finally {
      setReacting(null);
    }
  };

  const onRemove = async (post) => {
    await postsService.removeOwn(gymId, post.id);
    change((feed) => withoutPost(feed, post.id));
    setNotice('Your post has been removed.');
  };

  // Their other posts go too, and the counts change, so the page is read again.
  const onBlock = async (post) => {
    await postsService.block(gymId, post.id);
    setBlocked(null);
    await load();
    setNotice(blockBox(post, state.feed?.gymName ?? gym.name).done);
  };

  const showBlocked = async () => {
    setBlocked({ loading: true, error: null, people: [] });
    try {
      const list = await postsService.blocked(gymId);
      setBlocked({ loading: false, error: null, people: list.people });
    } catch (err) {
      setBlocked({ loading: false, error: errorText(err, "Couldn't load who you've blocked."), people: [] });
    }
  };

  const onUnblock = async (person) => {
    setUnblocking(person.id);
    try {
      await postsService.unblock(gymId, person.id);
      setBlocked((b) => (b === null ? b : { ...b, error: null, people: b.people.filter((p) => p.id !== person.id) }));
      await load();
      setNotice(unblockedNote(person.name));
    } catch (err) {
      setBlocked((b) => (b === null ? b : { ...b, error: errorText(err, "That didn't work. Please try again.") }));
    } finally {
      setUnblocking(null);
    }
  };

  const onReport = async (post, reason, note) => {
    await postsService.report(gymId, post.id, reason, note);
    change((feed) => withPost(feed, { ...post, reported: true }));
    setNotice(reportBox(state.feed?.gymName ?? gym.name).done);
  };

  const feed = state.feed;
  const empty = feed === null ? null : emptyLine(feed);
  const stopped = feed === null ? null : stoppedNote(feed);
  const blockedLabel = feed === null ? null : blockedButton(feed);
  const help = feed === null ? null : helpLine(feed);
  return (
    <div className="mt-4" data-testid="updates">
      {state.loading ? (
        <p className="text-sm flex items-center gap-2" style={{ color: MUTED }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </p>
      ) : state.error !== null ? (
        <div>
          <p className="text-sm" style={{ color: RED }}>
            {state.error}
          </p>
          <button type="button" onClick={tryAgain} className="mt-2 rounded-xl px-3.5 py-2 text-sm font-semibold" style={SOFT}>
            Try again
          </button>
        </div>
      ) : (
        <>
          {memberCanPost(feed) && (
            <Composer
              gymId={gymId}
              gymName={feed.gymName}
              onPosted={(post) => {
                change((shown) => withNewPost(shown, post));
                setNotice(`Posted. Everyone at ${feed.gymName} can see it now.`);
              }}
            />
          )}
          {stopped !== null && (
            <p className="text-sm rounded-xl p-3.5 mb-2.5" style={{ background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.75)' }}>
              {stopped}
            </p>
          )}
          {notice !== null && (
            <p className="text-sm mb-2 font-semibold" role="status" style={{ color: '#4ade80' }}>
              {notice}
            </p>
          )}
          {reactError !== null && (
            <p className="text-sm mb-2" role="alert" style={{ color: RED }}>
              {reactError}
            </p>
          )}
          {empty !== null ? (
            <p className="text-sm" style={{ color: MUTED }}>
              {empty}
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {[...feed.pinned, ...feed.posts].map((post) => (
                <PostCard
                  key={post.id}
                  gymId={gymId}
                  gymName={feed.gymName}
                  post={post}
                  busy={reacting === post.id}
                  onReact={onReact}
                  onOpen={(p, index) => setViewing({ post: p, index })}
                  onRemove={onRemove}
                  onReport={onReport}
                  onBlock={onBlock}
                  onPerson={(p) => setPerson(personOf(p))}
                />
              ))}
            </ul>
          )}
          {feed.next !== null && (
            <div className="mt-3">
              <button type="button" onClick={showMore} disabled={more.loading} className="rounded-xl px-3.5 py-2.5 text-sm font-semibold min-h-11" style={QUIET}>
                {more.loading ? 'Loading…' : 'Show older posts'}
              </button>
              {more.error !== null && (
                <p className="text-sm mt-2" role="alert" style={{ color: RED }}>
                  {more.error}
                </p>
              )}
            </div>
          )}
          {blockedLabel !== null && blocked === null && (
            <button type="button" onClick={showBlocked} className="mt-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold min-h-11" style={QUIET}>
              {blockedLabel}
            </button>
          )}
          {blocked !== null && (
            <section className="rounded-xl p-3.5 mt-3 flex flex-col gap-2" style={{ background: 'rgba(255,255,255,0.03)' }} aria-label="People you've blocked" data-testid="blocked">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-white flex-1">People you&apos;ve blocked</p>
                <button type="button" onClick={() => setBlocked(null)} className="rounded-xl px-3 text-sm font-semibold min-h-11" style={QUIET}>
                  Close
                </button>
              </div>
              <p className="text-xs" style={{ color: MUTED }}>
                You don&apos;t see their posts or reactions here. They aren&apos;t told.
              </p>
              {blocked.loading && (
                <p className="text-sm" style={{ color: MUTED }}>
                  Loading…
                </p>
              )}
              {blocked.error !== null && (
                <p className="text-sm" role="alert" style={{ color: RED }}>
                  {blocked.error}
                </p>
              )}
              {!blocked.loading && blocked.error === null && blocked.people.length === 0 && (
                <p className="text-sm" style={{ color: MUTED }}>
                  You haven&apos;t blocked anyone here.
                </p>
              )}
              {blockedMore(feed, blocked.people.length) !== null && (
                <p className="text-xs" style={{ color: MUTED }}>
                  {blockedMore(feed, blocked.people.length)}
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {blocked.people.map((person) => (
                  <li key={person.id} className="flex items-center gap-2 min-h-11">
                    <span className="text-sm text-white flex-1 truncate">{person.name ?? 'A member'}</span>
                    <button type="button" disabled={unblocking !== null} onClick={() => onUnblock(person)} className="rounded-xl px-3.5 text-sm font-semibold min-h-11" style={SOFT}>
                      {unblocking === person.id ? 'Unblocking…' : 'Unblock'}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {help !== null && (
            <p className="text-xs mt-4" style={{ color: MUTED }} data-testid="help-line">
              {help.text}{' '}
              <a href={`mailto:${help.email}`} style={{ color: ORANGE }}>
                {help.email}
              </a>
            </p>
          )}
        </>
      )}
      {person !== null && <PersonProfile gym={{ id: gymId, name: feed?.gymName ?? gym.name }} person={person} onClose={() => setPerson(null)} onChanged={load} />}
      {viewing !== null && (
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
      )}
    </div>
  );
}
