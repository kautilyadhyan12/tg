import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, EyeOff, Flag, MessageCircle, Pin, PinOff, Trash2, Trophy, UserCheck, UserX } from 'lucide-react';
import { postPhotoUrl, staffPostsService } from '../../api/postsApi';
import { ConfirmInline } from '../../components/console/ConsoleStates';
import {
  authorInitials,
  authorName,
  canOpenPerson,
  hiddenStaffNote,
  personLink,
  pinNote,
  postedText,
  removeBox,
  reportNotesTitle,
  reportedLine,
  stopBox,
} from '../../components/gym/postsView';
import { resultPost } from '../../components/gym/challengesView';
import { commentsButton } from '../../components/gym/commentsConsoleView';
import PostReactions from './PostReactions';
import { CommentsPanel } from './UpdatesComments';

// ONE POST, AS STAFF READ IT (spec Part 3 §15.2, §15.3): on the console's Updates page, its
// reported list, and a person's own list.

/** A challenge's result under its post, as the gym's members read it. `link`: the
 *  challenge's own page, for staff who run challenges; null for staff who do not. */
function ChallengeResult({ result, link, words }) {
  return (
    <div className="rounded-[14px] p-4 flex flex-col gap-3" style={{ background: 'var(--raise)' }} aria-label="How it finished" data-testid="challenge-result">
      <p className="c-s15 c-w6 c-t1 flex items-start gap-2 break-words">
        <Trophy aria-hidden="true" className="w-[18px] h-[18px] mt-0.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />
        <span>{result.headline}</span>
      </p>
      {result.rows.length > 0 ? (
        <ol className="flex flex-col gap-1.5" aria-label={result.rowsLabel}>
          {result.rows.map((row) => (
            <li key={row.key} aria-label={row.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="c-s14 c-w6 c-t2 c-num" style={{ minWidth: 34 }}>
                {row.placeText ?? '—'}
              </span>
              <span className="c-s14 c-t1 flex-grow min-w-0 break-words">
                {row.name}
                {row.sub !== null ? <span className="c-s13 c-t2">{` · ${row.sub}`}</span> : null}
              </span>
              {row.number !== null ? <span className="c-s14 c-w6 c-t1 c-num">{row.number}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      <p className="c-s13 c-t2 break-words">{result.facts}</p>
      {result.prize !== null ? <p className="c-s14 c-t1 break-words">{result.prize}</p> : null}
      <p className="c-s13 c-t2">{`This is what your ${words.people} see. It changes by itself if a number changes, or if someone is hidden from boards or leaves.`}</p>
      {link !== null ? (
        <Link to={link} className="c-btn c-btn-s c-btn-sm self-start">
          Open the challenge
        </Link>
      ) : (
        <p className="c-s13 c-t2">The owner and staff who run the leaderboard can open the challenge.</p>
      )}
    </div>
  );
}

/** One post. `report`: its entry on the reported list, where it is drawn with why it was
 *  reported and Keep in place of Pin. With `onPin` null (a person's own list) there is no
 *  Pin; with `onPerson` a member's name opens that person's posts. */
export default function PostCard({ gymId, gymName, post, pinnedCount = 0, words, readOnly, busy, report = null, reportedRead = false, onPin = null, onRemove, onKeep, onStop, onOpen, onPerson = null, challengeLink = null, commentsWhere = 'elsewhere', onCommentsLeave, commentsRefresh = 0, onCommentCount = () => {}, onCommentsChanged = () => {}, onStopped = () => {} }) {
  /** Which box is open: null, 'remove' or 'stop'. */
  const [asking, setAsking] = useState(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const box = removeBox(post, words);
  const stop = stopBox(post.author.name);
  const full = report === null && onPin !== null ? pinNote(post, pinnedCount) : null;
  const hidden = hiddenStaffNote(post, words, report !== null ? 'list' : reportedRead ? 'later' : null);
  const canStop = post.fromMember && post.authorId !== null;
  const result = resultPost(post.challengeResult, gymName);
  const opens = onPerson !== null && canOpenPerson(post);
  const Who = opens ? 'button' : 'div';
  return (
    <li className="c-card p-4 md:p-5 flex flex-col gap-3" data-testid={report === null ? 'post' : 'reported-post'}>
      {report !== null ? (
        <p className="c-s14 c-w6 flex items-start gap-2" style={{ color: 'var(--warn)' }}>
          <Flag aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{reportedLine(report)}</span>
        </p>
      ) : null}
      {report !== null && report.notes.length > 0 ? (
        <div className="rounded-[14px] p-4 flex flex-col gap-2" style={{ background: 'var(--raise)' }} data-testid="report-notes">
          <p className="c-s13 c-t2">{reportNotesTitle(report)}</p>
          <ul className="flex flex-col gap-2">
            {report.notes.map((note, i) => (
              // Read once and never reordered: its position is its key.
              <li key={i} className="c-s14 c-t1 whitespace-pre-wrap break-words">
                {`“${note}”`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {hidden !== null ? (
        <p className="c-s14 c-w6 flex items-start gap-2" style={{ color: 'var(--warn)' }} data-testid="hidden-note">
          <EyeOff aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{hidden}</span>
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        {/* A member's picture and name are one thing to press: both open their posts. */}
        <Who className="flex items-center gap-3 min-w-0 flex-grow text-left" {...(opens ? { type: 'button', onClick: () => onPerson(post), 'aria-label': personLink(post) } : {})}>
          <span className="c-avatar" style={{ width: 40, height: 40, fontSize: 14 }} aria-hidden="true">
            {authorInitials(post, gymName)}
          </span>
          <span className="min-w-0 flex-grow block">
            <span className={`c-s15 c-w6 c-ell block ${opens ? 'c-lk' : 'c-t1'}`}>{authorName(post, gymName)}</span>
            <span className="c-s13 c-t2 block">{postedText(post.createdAt)}</span>
          </span>
        </Who>
        {post.fromMember ? <span className="c-tag c-tag-plain">{words.personCap}</span> : null}
        {post.authorStopped ? <span className="c-tag c-tag-warn">Stopped from posting and commenting</span> : null}
        {post.pinned ? (
          <span className="c-tag c-tag-soft">
            <Pin aria-hidden="true" className="w-3.5 h-3.5" /> Pinned
          </span>
        ) : null}
      </div>
      {post.body !== '' ? <p className="c-s15 c-t1 whitespace-pre-wrap break-words">{post.body}</p> : null}
      {result !== null ? <ChallengeResult result={result} link={challengeLink === null ? null : challengeLink(result.challengeId)} words={words} /> : null}
      {post.photos.length > 0 ? (
        <ul className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {post.photos.map((photo, i) => (
            <li key={photo.id}>
              <button
                type="button"
                onClick={() => onOpen(post, i)}
                aria-label={`Open photo ${i + 1} of ${post.photos.length}`}
                className="block w-full rounded-[10px] overflow-hidden"
                style={{ aspectRatio: '1 / 1', background: 'var(--raise)' }}
              >
                <img
                  src={postPhotoUrl({ gymId, postId: post.id, photoId: photo.id })}
                  alt={`Photo ${i + 1} of ${post.photos.length}`}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <PostReactions key={post.id} thing={post} readWho={(reaction) => staffPostsService.reactors(gymId, post.id, reaction)} />
      <button type="button" aria-expanded={commentsOpen} onClick={() => setCommentsOpen((o) => !o)} className="c-btn c-btn-s c-btn-sm self-start">
        <MessageCircle aria-hidden="true" className="w-4 h-4" />
        {commentsButton(post.commentCount)}
      </button>
      {commentsOpen ? (
        <CommentsPanel
          gymId={gymId}
          gymName={gymName}
          post={post}
          words={words}
          readOnly={readOnly}
          where={commentsWhere}
          onLeave={onCommentsLeave}
          refresh={commentsRefresh}
          onCount={(change) => onCommentCount(post.id, change)}
          onChanged={onCommentsChanged}
          onStopped={onStopped}
        />
      ) : null}
      {readOnly ? null : asking === 'remove' ? (
        <div role="group" aria-label={box.title} className="flex flex-col gap-2 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
          <p className="c-s15 c-w6 c-t1">{box.title}</p>
          <ConfirmInline
            newLook
            question={box.line}
            confirmLabel={box.confirm}
            cancelLabel={box.cancel}
            busy={busy}
            onConfirm={() => onRemove(post)}
            onCancel={() => setAsking(null)}
          />
        </div>
      ) : asking === 'stop' ? (
        <div role="group" aria-label={stop.title} className="flex flex-col gap-2 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
          <p className="c-s15 c-w6 c-t1">{stop.title}</p>
          <ConfirmInline
            newLook
            question={stop.line}
            confirmLabel={stop.confirm}
            cancelLabel={stop.cancel}
            busy={busy}
            onConfirm={() => onStop(post, true).then(() => setAsking(null))}
            onCancel={() => setAsking(null)}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
          {report === null ? (
            onPin === null ? null : (
              <button type="button" disabled={busy || full !== null} onClick={() => onPin(post, !post.pinned)} className="c-btn c-btn-s c-btn-sm">
                {post.pinned ? <PinOff aria-hidden="true" className="w-4 h-4" /> : <Pin aria-hidden="true" className="w-4 h-4" />}
                {post.pinned ? 'Unpin' : 'Pin to the top'}
              </button>
            )
          ) : (
            <button type="button" disabled={busy} onClick={() => onKeep(post, report)} className="c-btn c-btn-s c-btn-sm">
              <Check aria-hidden="true" className="w-4 h-4" />
              Keep post
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => setAsking('remove')} className="c-btn c-btn-s c-btn-sm">
            <Trash2 aria-hidden="true" className="w-4 h-4" />
            Remove post
          </button>
          {canStop && !post.authorStopped ? (
            <button type="button" disabled={busy} onClick={() => setAsking('stop')} className="c-btn c-btn-s c-btn-sm">
              <UserX aria-hidden="true" className="w-4 h-4" />
              Stop posting and commenting
            </button>
          ) : null}
          {canStop && post.authorStopped ? (
            <button type="button" disabled={busy} onClick={() => onStop(post, false)} className="c-btn c-btn-s c-btn-sm">
              <UserCheck aria-hidden="true" className="w-4 h-4" />
              Let them post and comment again
            </button>
          ) : null}
          {full !== null ? <span className="c-s13 c-t2">{full}</span> : null}
        </div>
      )}
    </li>
  );
}
