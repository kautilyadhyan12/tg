import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Check, EyeOff, Flag, MessageCircle, Reply, Trash2, UserCheck, UserX } from 'lucide-react';
import { staffCommentsService, staffPostsService } from '../../api/postsApi';
import { errorStatus, errorText } from '../../api/orgsApi';
import { ConfirmInline } from '../../components/console/ConsoleStates';
import { authorInitials, authorName, postedText, reportNotesTitle, reportedLine, stopBox } from '../../components/gym/postsView';
import {
  canSendComment,
  commentCharsLine,
  composerReach,
  commentTag,
  hiddenCommentNote,
  keepCommentNote,
  removeCommentBox,
  repliesButton,
  reportedCommentPlace,
  reportedCommentsHelp,
  reportedCommentsMore,
  reportedCommentsTitle,
  mergedComments,
  sentNote,
  withPagesRead,
} from '../../components/gym/commentsConsoleView';
import PostReactions from './PostReactions';

// A POST'S COMMENTS, AS STAFF READ THEM (ROADMAP Stage 5 17e-ii; spec Part 3 §15.2), and the reported
// comments at the top of the page. `posts.manage`'s; the server refuses anyone else.

const newKey = () => globalThis.crypto.randomUUID();

function Problem({ text }) {
  return text === null ? null : (
    <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
      {text}
    </p>
  );
}

function Composer({ gymId, post, replyTo, words, onSent, onCancel = null }) {
  const [body, setBody] = useState('');
  // One key a comment: pressed again after a lost reply, the server answers with the one it kept.
  const [commentKey, setCommentKey] = useState(newKey);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  // After a failed send, changed words are a new comment: the old key would answer with the old words.
  const failed = useRef(false);
  const chars = commentCharsLine(body);
  const label = replyTo === null ? 'Write a comment' : `Reply to ${replyTo.name}`;

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const done = await staffCommentsService.add(gymId, post.id, commentKey, body, replyTo?.id);
      failed.current = false;
      setBody('');
      setCommentKey(newKey());
      onSent(done.comment, done.firstKept);
    } catch (err) {
      failed.current = true;
      setError(errorText(err, "We couldn't send that. Please try again."));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="c-field">
        <span className="c-label">{label}</span>
        <textarea
          className="c-area"
          rows={2}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setError(null);
            if (failed.current) {
              failed.current = false;
              setCommentKey(newKey());
            }
          }}
        />
        <span className="c-hint" style={chars.over ? { color: 'var(--bad)' } : undefined}>
          {`${chars.text}. ${composerReach(post, words)}`}
        </span>
      </label>
      <Problem text={error} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={send} disabled={sending || !canSendComment(body)} className="c-btn c-btn-p c-btn-sm">
          {sending ? 'Sending…' : replyTo === null ? 'Send comment' : 'Send reply'}
        </button>
        {onCancel !== null ? (
          <button type="button" onClick={onCancel} disabled={sending} className="c-btn c-btn-s c-btn-sm">
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** One comment or reply, and under it whatever was pressed. */
function CommentRow({ gymId, gymName, post, comment, words, readOnly, busy, where, onLeave, parentHidden = false, open, onToggleReplies, onRemove, onStop, onReplySent, children }) {
  const { orgSlug } = useParams();
  /** Which box is open: null, 'remove', 'stop' or 'reply'. */
  const [asking, setAsking] = useState(null);
  const box = removeCommentBox(comment, words);
  const stop = stopBox(comment.author.name);
  const hidden = hiddenCommentNote(comment, words, where, readOnly);
  const canStop = comment.fromMember && comment.authorId !== null;
  const name = authorName(comment, gymName);
  return (
    <li className="rounded-[14px] p-3 md:p-4 flex flex-col gap-2" style={{ background: 'var(--raise)' }} data-testid={comment.parentId === null ? 'comment' : 'comment-reply'}>
      {hidden !== null ? (
        <p className="c-s14 c-w6 flex items-start gap-2" style={{ color: 'var(--warn)' }} data-testid="comment-hidden-note">
          <EyeOff aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{hidden}</span>
        </p>
      ) : null}
      {hidden !== null && where === 'elsewhere' && !readOnly ? (
        <Link to={`/console/${orgSlug}/updates#reported-comments`} onClick={onLeave} className="c-btn c-btn-s c-btn-sm self-start">
          Open Reported comments
        </Link>
      ) : null}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="c-avatar" style={{ width: 32, height: 32, fontSize: 12 }} aria-hidden="true">
          {authorInitials(comment, gymName)}
        </span>
        <span className="min-w-0 flex-grow">
          <span className="c-s14 c-w6 c-t1 c-ell block">{name}</span>
          <span className="c-s13 c-t2 block">{postedText(comment.createdAt)}</span>
        </span>
        <span className="c-tag c-tag-plain">{commentTag(comment, words)}</span>
        {comment.authorStopped ? <span className="c-tag c-tag-warn">Stopped from posting and commenting</span> : null}
      </div>
      <p className="c-s15 c-t1 whitespace-pre-wrap break-words">
        {comment.replyingTo !== null ? <span className="c-w6" style={{ color: 'var(--accent)' }}>{`${comment.replyingTo} `}</span> : null}
        {comment.body}
      </p>
      <PostReactions key={comment.id} thing={{ ...comment, mine: null }} readWho={(reaction) => staffCommentsService.reactors(gymId, comment.id, reaction)} quiet />
      {asking === 'remove' ? (
        <div role="group" aria-label={box.title} className="flex flex-col gap-2 pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
          <p className="c-s15 c-w6 c-t1">{box.title}</p>
          <ConfirmInline newLook question={box.line} confirmLabel={box.confirm} cancelLabel={box.cancel} busy={busy} onConfirm={() => onRemove(comment, box).then(() => setAsking(null))} onCancel={() => setAsking(null)} />
        </div>
      ) : asking === 'stop' ? (
        <div role="group" aria-label={stop.title} className="flex flex-col gap-2 pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
          <p className="c-s15 c-w6 c-t1">{stop.title}</p>
          <ConfirmInline newLook question={stop.line} confirmLabel={stop.confirm} cancelLabel={stop.cancel} busy={busy} onConfirm={() => onStop(comment, true).then(() => setAsking(null))} onCancel={() => setAsking(null)} />
        </div>
      ) : asking === 'reply' ? (
        <Composer
          gymId={gymId}
          post={post}
          replyTo={{ id: comment.id, name }}
          words={words}
          onCancel={() => setAsking(null)}
          onSent={(made, firstKept) => {
            setAsking(null);
            onReplySent(made, firstKept);
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {comment.parentId === null && comment.replyCount > 0 ? (
            <button type="button" aria-expanded={open} onClick={onToggleReplies} className="c-btn c-btn-s c-btn-sm">
              {repliesButton(comment, open)}
            </button>
          ) : null}
          {readOnly ? null : (
            <>
              {!comment.hidden && !parentHidden ? (
                <button type="button" disabled={busy} onClick={() => setAsking('reply')} className="c-btn c-btn-s c-btn-sm">
                  <Reply aria-hidden="true" className="w-4 h-4" />
                  Reply
                </button>
              ) : null}
              <button type="button" disabled={busy} onClick={() => setAsking('remove')} className="c-btn c-btn-s c-btn-sm">
                <Trash2 aria-hidden="true" className="w-4 h-4" />
                {comment.parentId === null ? 'Remove comment' : 'Remove reply'}
              </button>
              {canStop && !comment.authorStopped ? (
                <button type="button" disabled={busy} onClick={() => setAsking('stop')} className="c-btn c-btn-s c-btn-sm">
                  <UserX aria-hidden="true" className="w-4 h-4" />
                  Stop posting and commenting
                </button>
              ) : null}
              {canStop && comment.authorStopped ? (
                <button type="button" disabled={busy} onClick={() => onStop(comment, false)} className="c-btn c-btn-s c-btn-sm">
                  <UserCheck aria-hidden="true" className="w-4 h-4" />
                  Let them post and comment again
                </button>
              ) : null}
            </>
          )}
        </div>
      )}
      {children}
    </li>
  );
}

const noReplies = { open: false, loading: false, error: null, items: [], next: null, pages: 1 };

/** Reads as many pages as are already opened, so a row gone from any of them goes from the screen. */
async function readOpened(read, pages) {
  const comments = [];
  let next;
  for (let i = 0; i < pages; i += 1) {
    const page = await read(next);
    comments.push(...page.comments);
    next = page.next;
    if (next === null) break;
  }
  return { comments, next };
}

/**
 * A post's comments, opened under it. `onCount(change)`: how many comments the post has changed by;
 * `onChanged`: somebody's comment or a stop changed, so the page reads its lists again; `refresh`:
 * changes when the page wants this read again; `where`: as `hiddenCommentNote`; `onLeave`: pressed on
 * its way to Updates.
 */
export function CommentsPanel({ gymId, gymName, post, words, readOnly, where = 'elsewhere', onLeave, refresh = 0, onCount, onChanged, onStopped }) {
  const [state, setState] = useState({ loading: true, error: null, comments: [], next: null, pages: 1 });
  const [replies, setReplies] = useState({});
  const [more, setMore] = useState({ loading: false, error: null });
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const repliesNow = useRef(replies);
  repliesNow.current = replies;
  const stateNow = useRef(state);
  stateNow.current = state;

  const readReplies = useCallback(
    /** `after`: the next page; without it, the pages opened read again. `sent`: a reply just sent. */
    async (parentId, after, sent) => {
      setReplies((all) => ({ ...all, [parentId]: { ...(all[parentId] ?? noReplies), open: true, loading: true, error: null } }));
      try {
        const page = after === undefined ? await readOpened((cursor) => staffCommentsService.replies(gymId, parentId, cursor), repliesNow.current[parentId]?.pages ?? 1) : await staffCommentsService.replies(gymId, parentId, after);
        setReplies((all) => {
          const was = all[parentId] ?? noReplies;
          const merged = after === undefined ? withPagesRead(was, page) : { items: mergedComments(was.items, page.comments), next: page.next };
          const items = sent === undefined ? merged.items : mergedComments(merged.items, [sent]);
          return { ...all, [parentId]: { ...was, loading: false, items, next: merged.next, pages: after === undefined ? was.pages : was.pages + 1 } };
        });
      } catch (err) {
        setReplies((all) => ({ ...all, [parentId]: { ...(all[parentId] ?? noReplies), loading: false, error: errorText(err, "We couldn't load the replies.") } }));
      }
    },
    [gymId],
  );

  const load = useCallback(async () => {
    try {
      const page = await readOpened((cursor) => staffCommentsService.list(gymId, post.id, cursor), stateNow.current.pages);
      setState((s) => {
        const merged = withPagesRead({ items: s.comments }, page);
        return { ...s, loading: false, error: null, comments: merged.items, next: merged.next };
      });
      for (const [parentId, list] of Object.entries(repliesNow.current)) {
        if (list.open && page.comments.some((c) => c.id === parentId)) readReplies(parentId);
      }
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: errorText(err, "We couldn't load the comments.") }));
    }
  }, [gymId, post.id, readReplies]);

  useEffect(() => {
    load();
  }, [load, refresh]);

  const showMore = async () => {
    setMore({ loading: true, error: null });
    try {
      const page = await staffCommentsService.list(gymId, post.id, state.next);
      setState((s) => ({ ...s, comments: mergedComments(s.comments, page.comments), next: page.next, pages: s.pages + 1 }));
      setMore({ loading: false, error: null });
    } catch (err) {
      setMore({ loading: false, error: errorText(err, "We couldn't load more.") });
    }
  };

  const toggleReplies = (parentId) => {
    const list = replies[parentId];
    if (list?.open) setReplies((all) => ({ ...all, [parentId]: { ...list, open: false } }));
    else readReplies(parentId);
  };

  const changeReplyCount = (parentId, change) =>
    setState((s) => ({ ...s, comments: s.comments.map((c) => (c.id === parentId ? { ...c, replyCount: Math.max(0, c.replyCount + change) } : c)) }));

  const added = (made, firstKept) => {
    setActionError(null);
    setNotice(sentNote(made, post, words));
    if (made.parentId === null) {
      setState((s) => ({ ...s, comments: mergedComments(s.comments, [made]) }));
    } else {
      if (firstKept) changeReplyCount(made.parentId, 1);
      if (replies[made.parentId]?.open) {
        setReplies((all) => {
          const was = all[made.parentId] ?? noReplies;
          return { ...all, [made.parentId]: { ...was, items: mergedComments(was.items, [made]) } };
        });
      } else {
        // Opened by this reply: the ones already there are read, and this one sits among them.
        readReplies(made.parentId, undefined, made);
      }
    }
    if (firstKept) onCount(1);
  };

  /** A comment or reply gone, by staff's press or already. */
  const dropRow = (comment) => {
    if (comment.parentId === null) {
      setState((s) => ({ ...s, comments: s.comments.filter((c) => c.id !== comment.id) }));
      onCount(-(1 + comment.replyCount));
    } else {
      setReplies((all) => {
        const was = all[comment.parentId] ?? noReplies;
        return { ...all, [comment.parentId]: { ...was, items: was.items.filter((c) => c.id !== comment.id) } };
      });
      changeReplyCount(comment.parentId, -1);
      onCount(-1);
    }
  };

  const remove = async (comment, box) => {
    setBusy(comment.id);
    setNotice(null);
    setActionError(null);
    try {
      await staffCommentsService.remove(gymId, comment.id);
      dropRow(comment);
      setNotice(box.done);
      onChanged();
    } catch (err) {
      setActionError(errorText(err, "We couldn't remove that. Please try again."));
      if (errorStatus(err) === 404) {
        dropRow(comment);
        await load();
        onChanged();
      }
    } finally {
      setBusy(null);
    }
  };

  const stopThem = async (comment, stopped) => {
    const lines = stopBox(comment.author.name);
    setBusy(comment.id);
    setNotice(null);
    setActionError(null);
    try {
      await staffPostsService.setStopped(gymId, comment.authorId, stopped);
      const mark = (c) => (c.authorId === comment.authorId ? { ...c, authorStopped: stopped } : c);
      setState((s) => ({ ...s, comments: s.comments.map(mark) }));
      setReplies((all) => Object.fromEntries(Object.entries(all).map(([id, list]) => [id, { ...list, items: list.items.map(mark) }])));
      setNotice(stopped ? lines.done : lines.undone);
      onStopped(comment.authorId, stopped);
    } catch (err) {
      setActionError(errorText(err, "We couldn't change that. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  const row = { gymId, gymName, post, words, readOnly, where, onLeave, onRemove: remove, onStop: stopThem, onReplySent: added };
  return (
    <section className="flex flex-col gap-3 pt-3 border-t" style={{ borderColor: 'var(--line)' }} aria-label="Comments on this post" data-testid="comments">
      {state.loading ? <p className="c-s14 c-t2">Loading…</p> : null}
      <Problem text={state.error} />
      {!state.loading && state.error === null && state.comments.length === 0 ? <p className="c-s14 c-t2">No comments yet.</p> : null}
      {state.comments.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {state.comments.map((comment) => {
            const list = replies[comment.id] ?? noReplies;
            return (
              <CommentRow key={comment.id} {...row} comment={comment} busy={busy === comment.id} open={list.open} onToggleReplies={() => toggleReplies(comment.id)}>
                {list.open ? (
                  <div className="flex flex-col gap-2 pl-3 md:pl-5" data-testid="replies">
                    {list.loading && list.items.length === 0 ? <p className="c-s14 c-t2">Loading…</p> : null}
                    <Problem text={list.error} />
                    {list.items.length > 0 ? (
                      <ul className="flex flex-col gap-2">
                        {list.items.map((reply) => (
                          <CommentRow key={reply.id} {...row} comment={reply} parentHidden={comment.hidden} busy={busy === reply.id} open={false} onToggleReplies={() => {}} />
                        ))}
                      </ul>
                    ) : null}
                    {list.next !== null ? (
                      <button type="button" disabled={list.loading} onClick={() => readReplies(comment.id, list.next)} className="c-btn c-btn-s c-btn-sm self-start">
                        {list.loading ? 'Loading…' : 'Show more replies'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </CommentRow>
            );
          })}
        </ul>
      ) : null}
      {state.next !== null ? (
        <div className="flex items-center gap-3">
          <button type="button" onClick={showMore} disabled={more.loading} className="c-btn c-btn-s c-btn-sm">
            {more.loading ? 'Loading…' : 'Show more comments'}
          </button>
          <Problem text={more.error} />
        </div>
      ) : null}
      {notice !== null ? (
        <p className="c-s14 c-w6" role="status" style={{ color: 'var(--good)' }}>
          {notice}
        </p>
      ) : null}
      <Problem text={actionError} />
      {!readOnly ? <Composer gymId={gymId} post={post} replyTo={null} words={words} onSent={added} /> : null}
    </section>
  );
}

/** One reported comment: why, where, and Keep, Remove and Stop. */
function ReportedComment({ gymId, gymName, item, words, readOnly, busy, onKeep, onRemove, onStop, refresh, onChanged, onCount, onStopped }) {
  const [asking, setAsking] = useState(null);
  const [opened, setOpened] = useState(false);
  const { comment } = item;
  const box = removeCommentBox(comment, words);
  const stop = stopBox(comment.author.name);
  const hidden = hiddenCommentNote(comment, words, 'list', readOnly);
  const place = reportedCommentPlace(item, gymName);
  const canStop = comment.fromMember && comment.authorId !== null;
  const noteTitle = reportNotesTitle(item);
  return (
    <li className="c-card p-4 md:p-5 flex flex-col gap-3" data-testid="reported-comment">
      <p className="c-s14 c-w6 flex items-start gap-2" style={{ color: 'var(--warn)' }}>
        <Flag aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>{reportedLine(item)}</span>
      </p>
      {noteTitle !== null ? (
        <div className="rounded-[14px] p-4 flex flex-col gap-2" style={{ background: 'var(--raise)' }} data-testid="comment-report-notes">
          <p className="c-s13 c-t2">{noteTitle}</p>
          <ul className="flex flex-col gap-2">
            {item.notes.map((note, i) => (
              // Read once and never reordered: its position is its key.
              <li key={i} className="c-s14 c-t1 whitespace-pre-wrap break-words">
                {`“${note}”`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {hidden !== null ? (
        <p className="c-s14 c-w6 flex items-start gap-2" style={{ color: 'var(--warn)' }} data-testid="comment-hidden-note">
          <EyeOff aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{hidden}</span>
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <span className="c-avatar" style={{ width: 40, height: 40, fontSize: 14 }} aria-hidden="true">
          {authorInitials(comment, gymName)}
        </span>
        <span className="min-w-0 flex-grow">
          <span className="c-s15 c-w6 c-t1 c-ell block">{authorName(comment, gymName)}</span>
          <span className="c-s13 c-t2 block">{postedText(comment.createdAt)}</span>
        </span>
        <span className="c-tag c-tag-plain">{commentTag(comment, words)}</span>
        {comment.authorStopped ? <span className="c-tag c-tag-warn">Stopped from posting and commenting</span> : null}
      </div>
      <p className="c-s15 c-t1 whitespace-pre-wrap break-words">{comment.body}</p>
      <div className="flex flex-col gap-0.5">
        <p className="c-s13 c-t2">{place.line}</p>
        {place.words !== null ? <p className="c-s13 c-t2 c-ell">{place.words}</p> : null}
      </div>
      {readOnly ? null : asking === 'remove' ? (
        <div role="group" aria-label={box.title} className="flex flex-col gap-2 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
          <p className="c-s15 c-w6 c-t1">{box.title}</p>
          <ConfirmInline newLook question={box.line} confirmLabel={box.confirm} cancelLabel={box.cancel} busy={busy} onConfirm={() => onRemove(item, box)} onCancel={() => setAsking(null)} />
        </div>
      ) : asking === 'stop' ? (
        <div role="group" aria-label={stop.title} className="flex flex-col gap-2 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
          <p className="c-s15 c-w6 c-t1">{stop.title}</p>
          <ConfirmInline newLook question={stop.line} confirmLabel={stop.confirm} cancelLabel={stop.cancel} busy={busy} onConfirm={() => onStop(comment, true).then(() => setAsking(null))} onCancel={() => setAsking(null)} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
          <button type="button" disabled={busy} onClick={() => onKeep(item)} className="c-btn c-btn-s c-btn-sm">
            <Check aria-hidden="true" className="w-4 h-4" />
            Keep comment
          </button>
          <button type="button" disabled={busy} onClick={() => setAsking('remove')} className="c-btn c-btn-s c-btn-sm">
            <Trash2 aria-hidden="true" className="w-4 h-4" />
            {box.confirm}
          </button>
          {canStop && !comment.authorStopped ? (
            <button type="button" disabled={busy} onClick={() => setAsking('stop')} className="c-btn c-btn-s c-btn-sm">
              <UserX aria-hidden="true" className="w-4 h-4" />
              Stop posting and commenting
            </button>
          ) : null}
          {canStop && comment.authorStopped ? (
            <button type="button" disabled={busy} onClick={() => onStop(comment, false)} className="c-btn c-btn-s c-btn-sm">
              <UserCheck aria-hidden="true" className="w-4 h-4" />
              Let them post and comment again
            </button>
          ) : null}
        </div>
      )}
      <button type="button" aria-expanded={opened} onClick={() => setOpened((o) => !o)} className="c-btn c-btn-s c-btn-sm self-start">
        <MessageCircle aria-hidden="true" className="w-4 h-4" />
        {opened ? "Hide this post's comments" : "See this post's comments"}
      </button>
      {opened ? <CommentsPanel gymId={gymId} gymName={gymName} post={item.post} words={words} readOnly={readOnly} where="above" refresh={refresh} onCount={onCount} onChanged={onChanged} onStopped={onStopped} /> : null}
    </li>
  );
}

/**
 * The reported comments, under the reported posts. `onAnswered`: a comment was kept or removed, so the
 * page reads its lists and any open comments again.
 */
export function ReportedComments({ gymId, gymName, reported, words, readOnly, refresh, onAnswered, onCount, onStopped }) {
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const { hash } = useLocation();
  const place = useRef(null);
  const shown = reported.items.length > 0;
  // Opened from a hidden comment on another page.
  useEffect(() => {
    if (hash === '#reported-comments' && shown) place.current?.scrollIntoView?.();
  }, [hash, shown]);

  const act = async (id, request, done) => {
    setBusy(id);
    setNotice(null);
    setActionError(null);
    try {
      const answer = await request();
      setNotice(done(answer));
      await onAnswered();
    } catch (err) {
      setActionError(errorText(err, "We couldn't change that. Please try again."));
      if (errorStatus(err) === 404 || errorStatus(err) === 409) await onAnswered();
    } finally {
      setBusy(null);
    }
  };

  const keep = (item) => act(item.comment.id, () => staffCommentsService.keep(gymId, item.comment.id, item), (answer) => keepCommentNote(answer, item.comment, words));
  const remove = (item, box) =>
    act(
      item.comment.id,
      async () => {
        await staffCommentsService.remove(gymId, item.comment.id);
        onCount(item.post.id, -(1 + item.comment.replyCount));
      },
      () => box.done,
    );
  const stopThem = (comment, stopped) => {
    const lines = stopBox(comment.author.name);
    return act(
      comment.id,
      async () => {
        await staffPostsService.setStopped(gymId, comment.authorId, stopped);
        onStopped(comment.authorId, stopped);
      },
      () => (stopped ? lines.done : lines.undone),
    );
  };

  const waiting = reportedCommentsMore(reported);
  if (!shown && notice === null && actionError === null) return null;
  return (
    <section ref={place} className="flex flex-col gap-3" aria-label="Reported comments" data-testid="reported-comments">
      {shown ? (
        <div className="flex flex-col gap-1">
          <h2 className="c-s15 c-w6 c-t1">{reportedCommentsTitle(reported.total)}</h2>
          <p className="c-s13 c-t2">{reportedCommentsHelp(words)}</p>
          {waiting !== null ? <p className="c-s13 c-t2">{waiting}</p> : null}
        </div>
      ) : null}
      {notice !== null ? (
        <p className="c-s14 c-w6" role="status" style={{ color: 'var(--good)' }}>
          {notice}
        </p>
      ) : null}
      <Problem text={actionError} />
      {shown ? (
        <ul className="flex flex-col gap-3">
          {reported.items.map((item) => (
            <ReportedComment
              key={item.comment.id}
              gymId={gymId}
              gymName={gymName}
              item={item}
              words={words}
              readOnly={readOnly}
              busy={busy === item.comment.id}
              refresh={refresh}
              onKeep={keep}
              onRemove={remove}
              onStop={stopThem}
              onChanged={onAnswered}
              onCount={(change) => onCount(item.post.id, change)}
              onStopped={onStopped}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
