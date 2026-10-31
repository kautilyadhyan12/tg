import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, FlatList, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import {
  GYM_POST_COMMENT_DRAFT_MOST,
  GYM_POST_COMMENT_WORDS,
  addedGymPostCommentResponseSchema,
  blockedGymPostCommenterResponseSchema,
  gymPostCommentsResponseSchema,
  reactToGymPostCommentResponseSchema,
  removedGymPostCommentResponseSchema,
  reportedGymPostCommentResponseSchema,
  type GymClockFormat,
  type GymMemberPosting,
  type GymPost,
  type GymPostComment,
  type GymPostCommentReportReason,
  type GymPostReaction,
} from "@app/shared";
import { Button } from "../../look/Button";
import { Options } from "../../look/Choice";
import { colours, sizes } from "../../look/colours";
import { Field } from "../../look/Field";
import { Icon } from "../../look/Icon";
import { Sheet } from "../../look/Sheet";
import { ASK_MOST } from "../../look/sizing";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { newRequestKey } from "./classesView";
import {
  COMMENT_REPORT_REASONS,
  REPLY_TARGET_GONE,
  canSendComment,
  cannotComment,
  commentBlockPath,
  commentDraftsText,
  commentReactionPath,
  commentRemoveBox,
  commentRemovePath,
  commentReportBox,
  commentReportPath,
  commentRoom,
  commentedWords,
  commentsPath,
  goneWith,
  hasKeptWords,
  merged,
  readCommentDrafts,
  repliesButton,
  repliesPath,
  withComment,
  withFirstPage,
  withKept,
  type KeptComment,
  type KeptComments,
} from "./commentsView";
import { draftFolder } from "./postDraftFiles";
import { Reactions } from "./Reactions";
import { authorInitials, authorName, authorTag, blockBox, canBlock, couldNotRead, hiddenOwnNote, memberPostAction, postedText, pressFailed, reportNoteLine, withReaction } from "./updatesView";

// Comments and replies on a post (ROADMAP Stage 5 17e; spec Part 3 §15.2): a box from the bottom of Updates. The browser
// has no such screen, so this is the terminal's design, as Instagram's: the words oldest first and the place to write at
// the bottom. What a member writes is kept on the phone until the server has it, under one key, and never sent by itself.

/** One person's unsent comments at one place, one a post. Each change is written in order. */
export function useKeptComments(me: string | null, gymId: string) {
  const [drafts, setDrafts] = useState<KeptComments | undefined>(undefined);
  const now = useRef<KeptComments>({});
  const folder = useRef(me === null ? null : draftFolder(me, gymId, "comment-draft"));
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const here = me === null ? null : draftFolder(me, gymId, "comment-draft");
    folder.current = here;
    now.current = {};
    setDrafts(undefined);
    if (here === null) return undefined;
    let stale = false;
    void here.read().then(
      (text) => {
        if (stale) return;
        now.current = readCommentDrafts(text);
        setDrafts(now.current);
      },
      () => {
        if (!stale) setDrafts({});
      },
    );
    return () => {
      stale = true;
    };
  }, [me, gymId]);

  const put = useCallback((postId: string, next: KeptComment | null) => {
    now.current = withKept(now.current, postId, next);
    setDrafts(now.current);
    const here = folder.current;
    if (here === null) return;
    const text = commentDraftsText(now.current);
    queue.current = queue.current.then(() => here.write(text)).catch(() => undefined);
  }, []);

  return { drafts, put, of: (postId: string): KeptComment | undefined => now.current[postId] };
}
export type KeptCommentsHook = ReturnType<typeof useKeptComments>;

export interface CommentsPlace {
  id: string;
  name: string;
  clockFormat: GymClockFormat;
}

interface CommentsBoxProps {
  post: GymPost | null;
  place: CommentsPlace;
  gymName: string;
  kept: KeptCommentsHook;
  zone: string;
  onClose: () => void;
  /** The post now has this many more, or fewer, comments shown. */
  onCount: (postId: string, change: number) => void;
  onCommenting: (commenting: GymMemberPosting) => void;
  /** A person was blocked here: the page takes their posts off and reads again. */
  onBlocked: (authorId: string) => void;
  /** The post itself has gone. */
  onPostGone: (postId: string) => void;
}

export function CommentsBox({ post, place, gymName, kept, zone, onClose, onCount, onCommenting, onBlocked, onPostGone }: CommentsBoxProps) {
  // Kept up while a comment is on its way, so it is said here. The wait has an end.
  const [sending, setSending] = useState(false);
  const close = () => {
    if (!sending) onClose();
  };
  return (
    <Sheet open={post !== null} title="Comments" onClose={close}>
      {post === null ? null : (
        <Body key={post.id} post={post} place={place} gymName={gymName} kept={kept} zone={zone} sending={sending} setSending={setSending} onCount={onCount} onCommenting={onCommenting} onBlocked={onBlocked} onPostGone={onPostGone} />
      )}
    </Sheet>
  );
}

type Held = { kind: "loading" } | { kind: "failed"; text: string } | { kind: "ok"; comments: GymPostComment[]; next: string | null; commenting: GymMemberPosting };
interface Under {
  open: boolean;
  busy: boolean;
  failed: boolean;
  comments: GymPostComment[];
  next: string | null;
}
const noneUnder: Under = { open: false, busy: false, failed: false, comments: [], next: null };

type Asking = { kind: "menu" | "report" | "block" | "remove"; comment: GymPostComment };

function Body({
  post,
  place,
  gymName,
  kept,
  zone,
  sending,
  setSending,
  onCount,
  onCommenting,
  onBlocked,
  onPostGone,
}: Omit<CommentsBoxProps, "post" | "onClose"> & { post: GymPost; sending: boolean; setSending: (sending: boolean) => void }) {
  const { session } = useSession();
  const [held, setHeld] = useState<Held>({ kind: "loading" });
  const [under, setUnder] = useState<Readonly<Record<string, Under | undefined>>>({});
  const [more, setMore] = useState<{ busy: boolean; failed: boolean }>({ busy: false, failed: false });
  const [reacting, setReacting] = useState<string | null>(null);
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [typing, setTyping] = useState(false);
  const list = useRef<FlatList<GymPostComment>>(null);
  const live = useRef(true);
  const started = useRef(0);
  const pressed = useRef(false);
  const postId = post.id;
  const gymId = place.id;
  const draft = kept.drafts?.[postId];
  const body = draft?.body ?? "";

  const load = useCallback(
    async (quiet: boolean) => {
      started.current += 1;
      const number = started.current;
      const answer = await session.signedIn({ method: "GET", path: commentsPath(gymId, postId) }, gymPostCommentsResponseSchema);
      if (!live.current || number !== started.current) return;
      if (answer.kind === "ok") {
        const { comments, next, commenting } = answer.data;
        setHeld((h) => ({ kind: "ok", ...withFirstPage(h.kind === "ok" ? h : { comments: [], next: null }, { comments, next }), commenting }));
        onCommenting(commenting);
      } else if (answer.kind === "refused" && answer.error === "post_not_found") {
        onPostGone(postId);
        setHeld({ kind: "failed", text: answer.message });
      } else if (answer.kind === "refused" && answer.status === 404) {
        setHeld({ kind: "failed", text: couldNotRead(404, gymName) });
      } else if (!quiet) {
        setHeld({ kind: "failed", text: "Couldn't load the comments." });
      }
    },
    [session, gymId, postId, gymName, onCommenting, onPostGone],
  );

  useEffect(() => {
    live.current = true;
    void load(false);
    const back = AppState.addEventListener("change", (state) => {
      if (state === "active") void load(true);
    });
    return () => {
      live.current = false;
      back.remove();
    };
  }, [load]);

  const changeTop = (fn: (comments: GymPostComment[]) => GymPostComment[]) => {
    setHeld((h) => (h.kind === "ok" ? { ...h, comments: fn(h.comments) } : h));
  };
  const changeUnder = (parentId: string, fn: (u: Under) => Under) => {
    setUnder((all) => ({ ...all, [parentId]: fn(all[parentId] ?? noneUnder) }));
  };
  /** The comment or reply changed wherever it is. */
  const changeOne = (comment: GymPostComment) => {
    if (comment.parentId === null) changeTop((c) => withComment(c, comment));
    else changeUnder(comment.parentId, (u) => ({ ...u, comments: withComment(u.comments, comment) }));
  };
  /** It has gone, for whatever reason: it and what is under it leave the screen. */
  const dropOne = (comment: GymPostComment) => {
    if (comment.parentId === null) {
      changeTop((c) => c.filter((x) => x.id !== comment.id));
    } else {
      const parentId = comment.parentId;
      changeUnder(parentId, (u) => ({ ...u, comments: u.comments.filter((x) => x.id !== comment.id) }));
      changeTop((c) => c.map((x) => (x.id === parentId ? { ...x, replyCount: Math.max(0, x.replyCount - 1) } : x)));
    }
  };

  const showMore = async (next: string) => {
    setMore({ busy: true, failed: false });
    const answer = await session.signedIn({ method: "GET", path: commentsPath(gymId, postId, next) }, gymPostCommentsResponseSchema);
    if (!live.current) return;
    if (answer.kind === "ok") {
      setHeld((h) => (h.kind === "ok" ? { ...h, comments: merged(h.comments, answer.data.comments), next: answer.data.next } : h));
      setMore({ busy: false, failed: false });
    } else {
      setMore({ busy: false, failed: true });
    }
  };

  const readReplies = async (parentId: string, after: string | null) => {
    changeUnder(parentId, (u) => ({ ...u, open: true, busy: true, failed: false }));
    const answer = await session.signedIn({ method: "GET", path: repliesPath(gymId, parentId, after) }, gymPostCommentsResponseSchema);
    if (!live.current) return;
    if (answer.kind === "ok") changeUnder(parentId, (u) => ({ ...u, busy: false, comments: merged(u.comments, answer.data.comments), next: answer.data.next }));
    else if (answer.kind === "refused" && answer.status === 404) {
      void load(true);
      changeUnder(parentId, (u) => ({ ...u, busy: false, open: false }));
      changeTop((c) => c.filter((x) => x.id !== parentId));
      setSaid({ text: GYM_POST_COMMENT_WORDS.not_found, bad: false });
    } else changeUnder(parentId, (u) => ({ ...u, busy: false, failed: true }));
  };

  const readRepliesAgain = async (parentId: string) => {
    const answer = await session.signedIn({ method: "GET", path: repliesPath(gymId, parentId) }, gymPostCommentsResponseSchema);
    if (!live.current) return;
    if (answer.kind === "ok") changeUnder(parentId, (u) => ({ ...u, comments: answer.data.comments, next: answer.data.next }));
    else if (answer.kind === "refused" && answer.status === 404) changeUnder(parentId, (u) => ({ ...u, comments: [], next: null, open: false }));
  };

  /** A press found the comment gone: it leaves the screen, and the page's count is put right by its next read. */
  const foundGone = (comment: GymPostComment) => {
    dropOne(comment);
    onCount(postId, -goneWith(comment));
    setSaid({ text: GYM_POST_COMMENT_WORDS.not_found, bad: false });
  };

  const onReact = async (comment: GymPostComment, tapped: GymPostReaction) => {
    const next = withReaction(comment, tapped);
    setReacting(comment.id);
    setSaid(null);
    changeOne(next);
    const answer = await session.signedIn({ method: "PUT", path: commentReactionPath(gymId, comment.id), body: { reaction: next.mine } }, reactToGymPostCommentResponseSchema);
    if (!live.current) return;
    setReacting(null);
    if (answer.kind === "ok") {
      changeOne({ ...next, reactions: answer.data.reactions, mine: answer.data.mine });
    } else if (answer.kind === "refused" && answer.status === 404) {
      foundGone(comment);
    } else {
      changeOne(comment);
      setSaid({ text: answer.kind === "refused" ? answer.message : "Couldn't save your reaction. Please try again.", bad: true });
    }
  };

  const setDraft = (next: Partial<KeptComment>) => {
    const had = kept.of(postId);
    const base: KeptComment = had ?? { commentKey: newRequestKey(), body: "", replyTo: null };
    // A change after a send whose answer never came: the server would answer with it as it first was.
    kept.put(postId, { ...base, ...next, ...(base.sent === true ? { changed: true } : {}) });
  };

  const commenting = held.kind === "ok" ? held.commenting : null;
  const blocked = commenting === null ? null : cannotComment(commenting, gymName);
  const room = commentRoom(body);

  const send = async () => {
    const mine = kept.of(postId);
    if (pressed.current || mine === undefined || !canSendComment(mine.body)) return;
    pressed.current = true;
    setSending(true);
    setSaid(null);
    const changed = mine.changed === true;
    kept.put(postId, { ...mine, sent: true });
    const answer = await session.signedIn(
      { method: "POST", path: commentsPath(gymId, postId), body: { commentKey: mine.commentKey, body: mine.body.trim(), ...(mine.replyTo === null ? {} : { replyTo: mine.replyTo.id }) } },
      addedGymPostCommentResponseSchema,
    );
    pressed.current = false;
    setSending(false);
    if (answer.kind === "ok") {
      kept.put(postId, null);
      const { comment, firstKept } = answer.data;
      if (firstKept) onCount(postId, 1);
      const note = commentedWords({ firstKept, changed });
      if (note !== null) setSaid({ text: note, bad: false });
      if (comment.parentId === null) {
        changeTop((c) => merged(c, [comment]));
        if (live.current) setTimeout(() => list.current?.scrollToEnd({ animated: true }), 0);
      } else {
        const parentId = comment.parentId;
        if (firstKept) changeTop((c) => c.map((x) => (x.id === parentId ? { ...x, replyCount: x.replyCount + 1 } : x)));
        changeUnder(parentId, (u) => ({ ...u, open: true, comments: merged(u.comments, [comment]) }));
        if ((under[parentId]?.comments.length ?? 0) === 0) void readReplies(parentId, null);
      }
      return;
    }
    if (answer.kind === "no_answer") {
      setSaid({ text: "No connection. Your comment is kept. Try again.", bad: true });
      return;
    }
    const now = kept.of(postId);
    const clean: KeptComment | null = now === undefined ? null : { commentKey: now.commentKey, body: now.body, replyTo: now.replyTo };
    if (answer.error === "comment_not_found") {
      // What it answers has gone, or it went up after a lost reply and was removed since: the words are still theirs.
      if (clean !== null) kept.put(postId, { ...clean, commentKey: newRequestKey(), replyTo: null });
      setSaid({ text: mine.replyTo === null ? `${answer.message} Press Send to post it again.` : REPLY_TARGET_GONE, bad: true });
      void load(true);
      return;
    }
    if (clean !== null) kept.put(postId, clean);
    if (answer.error === "post_not_found") onPostGone(postId);
    setSaid({ text: answer.status === 404 && answer.error !== "post_not_found" ? couldNotRead(404, gymName) : pressFailed(answer.message), bad: true });
    if (answer.status === 403 || answer.status === 404) void load(true);
  };

  const replyTo = (comment: GymPostComment) => {
    setSaid(null);
    setTyping(true);
    setDraft({ replyTo: { id: comment.id, name: authorName(comment, gymName) } });
  };

  const row = (comment: GymPostComment) => (
    <CommentRow
      comment={comment}
      gymName={gymName}
      posted={postedText(comment.createdAt, new Date(), zone, place.clockFormat)}
      busy={reacting === comment.id}
      canReply={commenting === "on"}
      onReact={(r) => void onReact(comment, r)}
      onReply={() => {
        replyTo(comment);
      }}
      onMenu={() => {
        setAsking({ kind: "menu", comment });
      }}
    />
  );

  const { height } = useWindowDimensions();

  return (
    <>
      {held.kind === "loading" ? (
        <Txt kind="small">Loading…</Txt>
      ) : held.kind === "failed" ? (
        <View style={styles.gap}>
          <Txt colour="badText">{held.text}</Txt>
          <Button
            label="Try again"
            kind="soft"
            small
            onPress={() => {
              setHeld({ kind: "loading" });
              void load(false);
            }}
          />
        </View>
      ) : (
        <FlatList
          ref={list}
          testID="comments-list"
          style={styles.list}
          contentContainerStyle={styles.gapBig}
          keyboardShouldPersistTaps="handled"
          data={held.comments}
          keyExtractor={(c) => c.id}
          ListEmptyComponent={blocked === null ? <Txt>No comments yet. Write the first one.</Txt> : <Txt>No comments yet.</Txt>}
          renderItem={({ item: comment }) => {
            const u = under[comment.id] ?? noneUnder;
            const shown = u.open;
            return (
              <View testID={`comment-${comment.id}`} style={styles.gap}>
                {row(comment)}
                {comment.replyCount > 0 || u.comments.length > 0 ? (
                  <View style={styles.under}>
                    <Button
                      label={repliesButton(comment.replyCount, shown)}
                      kind="quiet"
                      busy={u.busy && u.comments.length === 0}
                      onPress={() => {
                        if (shown) changeUnder(comment.id, (x) => ({ ...x, open: false }));
                        else if (u.comments.length === 0) void readReplies(comment.id, null);
                        else changeUnder(comment.id, (x) => ({ ...x, open: true }));
                      }}
                      style={styles.start}
                    />
                    {shown ? u.comments.map((reply) => <View key={reply.id} testID={`comment-${reply.id}`}>{row(reply)}</View>) : null}
                    {shown && u.next !== null ? <Button label="Show more replies" kind="quiet" busy={u.busy} onPress={() => void readReplies(comment.id, u.next)} style={styles.start} /> : null}
                    {shown && u.failed ? <Txt colour="badText">Couldn't load the replies.</Txt> : null}
                  </View>
                ) : null}
              </View>
            );
          }}
          ListFooterComponent={
            held.next === null ? null : (
              <View style={styles.middle}>
                <Button label="Show more comments" kind="plain" small busy={more.busy} onPress={() => void showMore(held.next ?? "")} />
                {more.failed ? <Txt colour="badText">Couldn't load more.</Txt> : null}
              </View>
            )
          }
        />
      )}
      {said === null ? null : (
        <View testID="comments-said">
          <Txt colour={said.bad ? "badText" : "text"}>{said.text}</Txt>
        </View>
      )}
      {held.kind !== "ok" ? null : blocked !== null ? (
        <View style={styles.gap}>
          <View testID="comments-closed">
            <Txt>{blocked}</Txt>
          </View>
          {!hasKeptWords(draft) ? null : (
            <View style={styles.gap}>
              <Txt kind="small">Your unsent comment</Txt>
              <ScrollView style={{ maxHeight: height * 0.2 }}>
                <Txt colour="text">{body}</Txt>
              </ScrollView>
              <Button
                label="Discard"
                kind="quiet"
                onPress={() => {
                  kept.put(postId, null);
                }}
                style={styles.start}
              />
            </View>
          )}
        </View>
      ) : (
        <View style={styles.write} pointerEvents={sending ? "none" : "auto"}>
          {draft?.replyTo == null ? null : (
            <View style={styles.replying}>
              <Txt kind="small" numberOfLines={1} style={styles.grow}>
                {`Replying to ${draft.replyTo.name}`}
              </Txt>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Stop replying to ${draft.replyTo.name}`}
                hitSlop={10}
                onPress={() => {
                  setDraft({ replyTo: null });
                }}
              >
                <Icon name="x" size={16} colour="textSoft" />
              </Pressable>
            </View>
          )}
          <View style={styles.writeRow}>
            <View style={styles.grow}>
              <Field
                key={draft?.replyTo?.id ?? "comment"}
                label="Your comment"
                bare
                value={body}
                onChange={(next) => {
                  setSaid(null);
                  setDraft({ body: next });
                }}
                placeholder={draft?.replyTo == null ? "Write a comment" : `Reply to ${draft.replyTo.name}`}
                lines={2}
                maxLength={GYM_POST_COMMENT_DRAFT_MOST}
                ready={typing}
              />
            </View>
            <Button label="Send" small busy={sending} disabled={!canSendComment(body)} onPress={() => void send()} />
          </View>
          {room.text === null ? null : (
            <Txt kind="small" colour={room.over ? "badText" : "textSoft"}>
              {room.text}
            </Txt>
          )}
        </View>
      )}
      <CommentAsk
        asking={asking}
        setAsking={setAsking}
        gymId={gymId}
        gymName={gymName}
        onRemoved={(comment) => {
          dropOne(comment);
          onCount(postId, -goneWith(comment));
        }}
        onReported={(comment) => {
          changeOne({ ...comment, reported: true });
        }}
        onBlocked={(comment) => {
          const authorId = comment.authorId;
          if (authorId === null) return;
          const keep = (c: GymPostComment) => !(c.fromMember && c.authorId === authorId);
          // A kept reply to that person answers nobody now.
          const answering = kept.of(postId)?.replyTo?.id;
          const shownNow = [...(held.kind === "ok" ? held.comments : []), ...Object.values(under).flatMap((u) => u?.comments ?? [])];
          if (answering !== undefined && shownNow.some((c) => c.id === answering && !keep(c))) setDraft({ replyTo: null });
          changeTop((all) => all.filter(keep));
          setUnder((all) => Object.fromEntries(Object.entries(all).map(([id, u]) => [id, u === undefined ? u : { ...u, comments: u.comments.filter(keep).map((c) => (c.replyingTo === comment.author.name ? { ...c, replyingTo: null } : c)) }])));
          onBlocked(authorId);
          void load(true);
          // What stays may name them or count their reaction: each open list is read as the server says it now.
          for (const [id, u] of Object.entries(under)) if (u !== undefined && u.comments.length > 0 && id !== comment.id) void readRepliesAgain(id);
        }}
        onGone={foundGone}
      />
    </>
  );
}

function CommentRow({
  comment,
  gymName,
  posted,
  busy,
  canReply,
  onReact,
  onReply,
  onMenu,
}: {
  comment: GymPostComment;
  gymName: string;
  posted: string;
  busy: boolean;
  canReply: boolean;
  onReact: (reaction: GymPostReaction) => void;
  onReply: () => void;
  onMenu: () => void;
}) {
  const tag = authorTag(comment);
  const hidden = hiddenOwnNote(comment, gymName);
  const name = authorName(comment, gymName);
  const hasMenu = memberPostAction(comment) !== null || canBlock(comment);
  const [picking, setPicking] = useState(false);
  return (
    <View style={styles.row}>
      <View style={styles.initials}>
        <Txt kind="tiny" colour="orange" style={styles.bold} numberOfLines={1}>
          {authorInitials(comment, gymName)}
        </Txt>
      </View>
      <View style={styles.words}>
        <Txt kind="small" numberOfLines={2}>
          <Txt kind="small" colour="text" style={styles.bold}>
            {name}
          </Txt>
          {`${tag === null ? "" : ` · ${tag}`} · ${posted}`}
        </Txt>
        {hidden === null ? null : (
          <Txt kind="small" colour="orange">
            {hidden}
          </Txt>
        )}
        <Txt colour="text">
          {comment.replyingTo === null ? null : <Txt colour="orange" style={styles.bold}>{`${comment.replyingTo} `}</Txt>}
          {comment.body}
        </Txt>
        <View style={styles.actions}>
          <Reactions item={comment} what="comment" busy={busy} onReact={onReact} onPicking={setPicking} />
          {picking ? null : (
            <>
              {canReply ? <Button label="Reply" kind="quiet" say={`Reply to ${name}`} onPress={onReply} /> : null}
              {hasMenu ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`More about this comment by ${name}`} hitSlop={4} onPress={onMenu} style={styles.more}>
                  <Icon name="more" size={16} colour="textSoft" />
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

type Step = { kind: "ask" } | { kind: "busy" } | { kind: "done"; text: string } | { kind: "failed"; text: string };

/** What can be done about one comment, then Remove, Report or Block asked in the middle box, which says what happened. */
function CommentAsk({
  asking,
  setAsking,
  gymId,
  gymName,
  onRemoved,
  onReported,
  onBlocked,
  onGone,
}: {
  asking: Asking | null;
  setAsking: (next: Asking | null) => void;
  gymId: string;
  gymName: string;
  onRemoved: (comment: GymPostComment) => void;
  onReported: (comment: GymPostComment) => void;
  onBlocked: (comment: GymPostComment) => void;
  onGone: (comment: GymPostComment) => void;
}) {
  const { session } = useSession();
  const { height } = useWindowDimensions();
  const [step, setStep] = useState<Step>({ kind: "ask" });
  const [reason, setReason] = useState<GymPostCommentReportReason | null>(null);
  const [note, setNote] = useState("");
  const open = useRef<Asking | null>(null);
  open.current = asking;

  useEffect(() => {
    setStep({ kind: "ask" });
    setReason(null);
    setNote("");
  }, [asking]);

  const close = () => {
    setAsking(null);
  };
  if (asking === null) return <Sheet open={false} title="" place="middle" onClose={close}>{null}</Sheet>;
  const { comment, kind } = asking;

  if (kind === "menu") {
    const action = memberPostAction(comment);
    return (
      <Sheet open title={authorName(comment, gymName)} place="middle" onClose={close}>
        <View testID="comment-menu" style={styles.gap}>
          {action === "remove" ? <Button label={comment.parentId === null ? "Remove comment" : "Remove reply"} kind="quiet" icon="trash" onPress={() => { setAsking({ kind: "remove", comment }); }} style={styles.start} /> : null}
          {action === "report" ? <Button label="Report" kind="quiet" icon="flag" onPress={() => { setAsking({ kind: "report", comment }); }} style={styles.start} /> : null}
          {action === "reported" ? (
            <Txt kind="small" colour="textFaint">
              Reported
            </Txt>
          ) : null}
          {canBlock(comment) ? <Button label={`Block ${authorName(comment, gymName)}`} kind="quiet" icon="ban" onPress={() => { setAsking({ kind: "block", comment }); }} style={styles.start} /> : null}
        </View>
      </Sheet>
    );
  }

  const remove = kind === "remove" ? commentRemoveBox(comment) : null;
  const blockAsk = kind === "block" ? blockBox(comment, gymName) : null;
  const report = commentReportBox(gymName);
  const room = reportNoteLine(note);
  const title = remove?.title ?? blockAsk?.title ?? report.title;
  const working = step.kind === "busy";

  const send = async () => {
    const mine = asking;
    setStep({ kind: "busy" });
    const answer =
      kind === "remove"
        ? await session.signedIn({ method: "DELETE", path: commentRemovePath(gymId, comment.id) }, removedGymPostCommentResponseSchema)
        : kind === "block"
          ? await session.signedIn({ method: "PUT", path: commentBlockPath(gymId, comment.id) }, blockedGymPostCommenterResponseSchema)
          : await session.signedIn({ method: "POST", path: commentReportPath(gymId, comment.id), body: note.trim() === "" ? { reason } : { reason, note: note.trim() } }, reportedGymPostCommentResponseSchema);
    const here = open.current === mine;
    const missing = answer.kind === "refused" && answer.error === "comment_not_found";
    // A removal sent again after a lost reply finds it already gone: it was removed.
    if (answer.kind === "ok" || (missing && kind === "remove")) {
      if (kind === "remove") onRemoved(comment);
      else if (kind === "block") onBlocked(comment);
      else onReported(comment);
      if (here) setStep({ kind: "done", text: remove?.done ?? blockAsk?.done ?? report.done });
      return;
    }
    if (missing) onGone(comment);
    if (here) setStep({ kind: "failed", text: pressFailed(answer.kind === "refused" ? answer.message : null) });
  };

  return (
    <Sheet open title={title} place="middle" onClose={close}>
      {step.kind === "done" ? (
        <View testID="comment-ask-done" style={styles.gap}>
          <Txt colour="goodText">{step.text}</Txt>
          <Button label="Done" kind="quiet" style={styles.middle} onPress={close} />
        </View>
      ) : (
        <View testID="comment-ask" style={styles.gap}>
          {kind === "report" ? (
            <ScrollView style={{ maxHeight: height * ASK_MOST }} contentContainerStyle={styles.gap} keyboardShouldPersistTaps="handled">
              <Txt>{report.line}</Txt>
              <Options options={COMMENT_REPORT_REASONS.map((r) => ({ value: r.id, label: r.word }))} selected={reason} onPick={setReason} solid disabled={working} />
              <Field label={report.noteLabel} value={note} onChange={setNote} placeholder={report.notePlaceholder} lines={3} />
              <Txt kind="small" colour={room.over ? "badText" : "textSoft"}>
                {room.text}
              </Txt>
            </ScrollView>
          ) : (
            <Txt>{remove?.line ?? blockAsk?.line}</Txt>
          )}
          {step.kind === "failed" ? <Txt colour="badText">{step.text}</Txt> : null}
          <View style={styles.buttons}>
            <Button
              label={remove?.confirm ?? blockAsk?.confirm ?? report.confirm}
              kind={kind === "remove" ? "danger" : "main"}
              small
              busy={working}
              disabled={kind === "report" && (reason === null || room.over)}
              onPress={() => void send()}
            />
            <Button label={remove?.cancel ?? blockAsk?.cancel ?? report.cancel} kind="quiet" disabled={working} onPress={close} />
          </View>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { flexShrink: 1 },
  gap: { gap: 10 },
  gapBig: { gap: 18, paddingBottom: 4 },
  grow: { flex: 1 },
  bold: { fontFamily: fonts.bold },
  start: { alignSelf: "flex-start" },
  middle: { alignSelf: "center", alignItems: "center", gap: 8 },
  under: { gap: 12, marginLeft: 42 },
  row: { flexDirection: "row", gap: 10 },
  words: { flex: 1, gap: 6 },
  initials: {
    flexShrink: 0,
    width: 32,
    height: 32,
    borderRadius: sizes.round,
    backgroundColor: colours.orangeFill,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, columnGap: 12 },
  more: { minWidth: sizes.press, minHeight: sizes.press, alignItems: "center", justifyContent: "center" },
  write: { gap: 8 },
  writeRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  replying: { flexDirection: "row", alignItems: "center", gap: 8 },
  buttons: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", columnGap: 20, rowGap: 8 },
});
