import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, FlatList, Image, Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { Modal } from "../../look/Modal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  GYM_POST_WORDS,
  blockedGymPosterResponseSchema,
  blockedGymPostersResponseSchema,
  gymPostReactionResponseSchema,
  gymPostsResponseSchema,
  removedGymPostResponseSchema,
  reportedGymPostResponseSchema,
  type BlockedGymPostersResponse,
  type GymClockFormat,
  type GymMemberPosting,
  type GymPost,
  type GymPostReaction,
  type GymPostReportReason,
  type GymPostsResponse,
} from "@app/shared";
import { Button } from "../../look/Button";
import { Card, Pill } from "../../look/Card";
import { Options } from "../../look/Choice";
import { colours, orangeGradient, shadows, sizes } from "../../look/colours";
import { Field } from "../../look/Field";
import { Icon } from "../../look/Icon";
import { Sheet } from "../../look/Sheet";
import { ASK_MOST } from "../../look/sizing";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { CopyContext } from "../ThisCopy";
import { CommentsBox, useKeptComments } from "./Comments";
import { commentButton, hasKeptWords, offersComments } from "./commentsView";
import { PhotoPages } from "./PhotoPages";
import { Reactions } from "./Reactions";
import { hasWork } from "./postDraft";
import { PostBox, useKeptPost } from "./PostBox";
import {
  REMOVED_OWN,
  REPORT_REASONS,
  authorInitials,
  authorName,
  authorTag,
  blockBox,
  blockPath,
  blockedButton,
  blockedMore,
  blockedPath,
  canBlock,
  couldNotRead,
  emptyLine,
  helpLine,
  hiddenOwnNote,
  memberCanPost,
  memberPostAction,
  ownRemoveBox,
  photoPath,
  postedText,
  pressFailed,
  missingThing,
  reactionPath,
  removeOwnPath,
  reportBox,
  reportNoteLine,
  reportPath,
  stoppedNote,
  unblockPath,
  unblockedNote,
  updatesPath,
  withNewPost,
  withPage,
  withPost,
  withReaction,
  withoutAuthor,
  withoutPost,
} from "./updatesView";
import { photoFiles, type PhotoFiles } from "./photoFiles";

// A place's Updates for its member (spec Part 3 §15.2, §15.3; ROADMAP Stage 5 item 17a): the gym's posts, pinned ones
// first, 20 a page, each with its photos and the four reactions; Remove on the member's own post, Report and Block on
// another member's, and the people they have blocked. The browser's screen (apps/web/src/components/gym/Updates.jsx),
// as a page over the Gym tab; each box opens in the middle and says there what happened. The server decides which
// posts a member is sent; the page shows only an answer about the place it was opened for. Read when it opens and
// when the app comes back.

export interface UpdatesPlace {
  id: string;
  name: string;
  clockFormat: GymClockFormat;
}

const phoneZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
};

/** The page over the Gym tab; closed while `place` is null. */
export function UpdatesPage({ place, onClose }: { place: UpdatesPlace | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={place !== null} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View testID="updates-page" accessibilityViewIsModal style={[styles.page, { paddingTop: insets.top }]}>
        {place === null ? null : <UpdatesBody key={place.id} place={place} onClose={onClose} bottom={insets.bottom} />}
      </View>
    </Modal>
  );
}

type Held = { kind: "loading" } | { kind: "failed"; status: number | null } | { kind: "ok"; feed: GymPostsResponse };
type Asking = { kind: "remove" | "block" | "report"; post: GymPost };
type Blocked = { kind: "loading" } | { kind: "failed"; text: string } | { kind: "ok"; people: BlockedGymPostersResponse["people"] };

// How many posts are drawn at a time, and how many screens' worth stay drawn: a photo is fetched when its post is.
const NEAR_THE_SCREEN = 5;

// How far from either end of the list its button to that end shows.
const NEAR_AN_END = 240;

function UpdatesBody({ place, onClose, bottom }: { place: UpdatesPlace; onClose: () => void; bottom: number }) {
  const { session, state } = useSession();
  const apiUrl = useContext(CopyContext).extra?.apiUrl ?? "";
  const kept = useKeptPost(state.kind === "in" ? state.user.id : null, place.id);
  const keptComments = useKeptComments(state.kind === "in" ? state.user.id : null, place.id);
  // The post whose comments are open, by id, so it is the one the list holds now.
  const [commentsOn, setCommentsOn] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  // What the last post came to, said where its button is.
  const [postedNote, setPostedNote] = useState<string | null>(null);
  const list = useRef<FlatList<GymPost>>(null);
  // Where the list stands, for the two buttons that jump along it: the end is the end of the posts read so far.
  const [ends, setEnds] = useState({ top: true, end: true });
  const measured = useRef({ y: 0, shown: 0, all: 0 });
  const measure = (next: Partial<typeof measured.current>) => {
    measured.current = { ...measured.current, ...next };
    const { y, shown, all } = measured.current;
    const top = y < NEAR_AN_END;
    const end = y + shown > all - NEAR_AN_END;
    setEnds((was) => (was.top === top && was.end === end ? was : { top, end }));
  };
  const [held, setHeld] = useState<Held>({ kind: "loading" });
  const [more, setMore] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  // The post whose reaction is on its way, and what went wrong with a post's last one.
  const [reacting, setReacting] = useState<string | null>(null);
  const [reactError, setReactError] = useState<{ postId: string; text: string } | null>(null);
  // Posts that turned out to be removed when pressed: said in their own place until the next read.
  const [gone, setGone] = useState<Record<string, true | undefined>>({});
  const [asking, setAsking] = useState<Asking | null>(null);
  const [viewing, setViewing] = useState<{ post: GymPost; index: number } | null>(null);
  const [blockedOpen, setBlockedOpen] = useState(false);
  // The photos, read signed in; each read of the page asks again for any that did not come.
  const [files] = useState(() => photoFiles(session));
  const [photoRound, setPhotoRound] = useState(0);
  useEffect(
    () => () => {
      files.clear();
    },
    [files],
  );
  // Reads are numbered as they start: an answer stands only if no later read has started.
  const started = useRef(0);
  const live = useRef(true);

  const load = useCallback(
    async (quiet: boolean) => {
      started.current += 1;
      const number = started.current;
      const answer = await session.signedIn({ method: "GET", path: updatesPath(place.id) }, gymPostsResponseSchema);
      if (!live.current || number !== started.current) return;
      // Another place's posts are never shown under this one.
      if (answer.kind === "ok" && answer.data.gymId === place.id) {
        setHeld({ kind: "ok", feed: answer.data });
        setGone({});
        setMore({ busy: false, error: null });
        setPhotoRound((round) => round + 1);
      } else if (!quiet || (answer.kind === "refused" && answer.status === 404) || answer.kind === "ok") {
        // A read made by itself never takes the posts away over a lost connection; a place that no longer shows them does.
        setHeld({ kind: "failed", status: answer.kind === "refused" ? answer.status : null });
      }
    },
    [session, place.id],
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
  }, [load, session]);

  const change = (fn: (feed: GymPostsResponse) => GymPostsResponse) => {
    setHeld((h) => (h.kind === "ok" ? { kind: "ok", feed: fn(h.feed) } : h));
  };

  const showMore = async (next: string) => {
    setMore({ busy: true, error: null });
    const number = started.current;
    const answer = await session.signedIn({ method: "GET", path: updatesPath(place.id, next) }, gymPostsResponseSchema);
    if (!live.current) return;
    // A new first page read since makes this page's place in the list unknown; the button is there to press again.
    if (number !== started.current) {
      setMore({ busy: false, error: null });
      return;
    }
    if (answer.kind === "ok" && answer.data.gymId === place.id) {
      change((feed) => withPage(feed, answer.data));
      setMore({ busy: false, error: null });
    } else {
      setMore({ busy: false, error: "Couldn't load more." });
    }
  };

  const onReact = async (post: GymPost, tapped: GymPostReaction) => {
    const next = withReaction(post, tapped);
    setReactError(null);
    setReacting(post.id);
    change((feed) => withPost(feed, next));
    const answer = await session.signedIn({ method: "PUT", path: reactionPath(place.id, post.id), body: { reaction: next.mine } }, gymPostReactionResponseSchema);
    if (!live.current) return;
    setReacting(null);
    if (answer.kind === "ok") {
      change((feed) => withPost(feed, { ...next, reactions: answer.data.reactions, mine: answer.data.mine }));
      return;
    }
    const missing = answer.kind === "refused" ? missingThing(answer) : null;
    if (missing === "post") {
      setGone((g) => ({ ...g, [post.id]: true }));
      return;
    }
    // Put back as it was: the tap did not reach the gym's page.
    change((feed) => withPost(feed, post));
    if (missing !== null) {
      setReactError({ postId: post.id, text: couldNotRead(404, place.name) });
      void load(true);
    } else {
      setReactError({ postId: post.id, text: answer.kind === "refused" ? answer.message : "Couldn't save your reaction. Please try again." });
    }
  };

  const feed = held.kind === "ok" ? held.feed : null;
  const commentsPost = commentsOn === null || feed === null ? null : ([...feed.pinned, ...feed.posts].find((p) => p.id === commentsOn) ?? null);
  const onCommentCount = useCallback((postId: string, by: number) => {
    setHeld((h) => {
      if (h.kind !== "ok") return h;
      const post = [...h.feed.pinned, ...h.feed.posts].find((p) => p.id === postId);
      return post === undefined ? h : { kind: "ok", feed: withPost(h.feed, { ...post, commentCount: Math.max(0, post.commentCount + by) }) };
    });
  }, []);
  const onCommenting = useCallback((commenting: GymMemberPosting) => {
    setHeld((h) => (h.kind === "ok" && h.feed.commenting !== commenting ? { kind: "ok", feed: { ...h.feed, commenting } } : h));
  }, []);
  const onCommentPostGone = useCallback((postId: string) => {
    setGone((g) => ({ ...g, [postId]: true }));
  }, []);
  const onCommentBlocked = useCallback(
    (authorId: string) => {
      void load(true);
      // The open post stays open unless its own writer is who was blocked.
      setHeld((h) => {
        if (h.kind !== "ok") return h;
        const next = withoutAuthor(h.feed, authorId);
        return { kind: "ok", feed: next };
      });
    },
    [load],
  );
  const gymName = feed?.gymName ?? place.name;
  const mayPost = feed !== null && memberCanPost(feed);
  const stopped = feed === null ? null : stoppedNote(feed);
  const unsent = kept.draft !== null && kept.draft !== undefined && hasWork(kept.draft);
  const empty = feed === null ? null : emptyLine(feed, mayPost);
  const blockedLabel = feed === null ? null : blockedButton(feed);
  const help = feed === null ? null : helpLine(feed);
  const now = new Date();
  const zone = phoneZone();

  return (
    <>
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} style={styles.back}>
          <Icon name="back" size={18} />
        </Pressable>
        <View style={styles.grow}>
          <Txt kind="h2">Updates</Txt>
          <Txt kind="small" numberOfLines={1}>
            {place.name}
          </Txt>
        </View>
      </View>
      <FlatList
        ref={list}
        testID="updates-list"
        style={styles.grow}
        scrollEventThrottle={100}
        onScroll={(e) => {
          measure({ y: e.nativeEvent.contentOffset.y, shown: e.nativeEvent.layoutMeasurement.height, all: e.nativeEvent.contentSize.height });
        }}
        // A scroll's last moment can fall between its reports.
        onMomentumScrollEnd={(e) => {
          measure({ y: e.nativeEvent.contentOffset.y });
        }}
        onScrollEndDrag={(e) => {
          measure({ y: e.nativeEvent.contentOffset.y });
        }}
        onLayout={(e) => {
          measure({ shown: e.nativeEvent.layout.height });
        }}
        onContentSizeChange={(_, all) => {
          measure({ all });
        }}
        contentContainerStyle={[styles.list, { paddingBottom: bottom + 152 }]}
        data={feed === null || empty !== null ? [] : [...feed.pinned, ...feed.posts]}
        keyExtractor={(post) => post.id}
        initialNumToRender={NEAR_THE_SCREEN}
        maxToRenderPerBatch={NEAR_THE_SCREEN}
        windowSize={NEAR_THE_SCREEN}
        ListHeaderComponent={
          <View style={styles.top}>
            {stopped === null ? null : (
              <Card testID="post-stopped" style={styles.box}>
                <Txt>{stopped}</Txt>
              </Card>
            )}
            {!mayPost && feed !== null && unsent ? (
              <Button
                label="See your unsent post"
                kind="plain"
                small
                onPress={() => {
                  setPostedNote(null);
                  setWriting(true);
                }}
              />
            ) : null}
            {postedNote === null ? null : (
              <View testID="post-done">
                <Txt colour="goodText">{postedNote}</Txt>
              </View>
            )}
            {held.kind === "loading" ? (
            <Txt kind="small">Loading…</Txt>
          ) : held.kind === "failed" ? (
            <Card style={styles.box}>
              <Txt colour="badText">{couldNotRead(held.status, place.name)}</Txt>
              <Button
                label="Try again"
                kind="soft"
                small
                onPress={() => {
                  setHeld({ kind: "loading" });
                  void load(false);
                }}
              />
            </Card>
          ) : empty !== null ? (
            <Card style={styles.box}>
              <Txt>{empty}</Txt>
            </Card>
          ) : null}
          </View>
        }
        renderItem={({ item: post }) =>
          gone[post.id] === true ? (
            <Card testID={`post-gone-${post.id}`} style={styles.box}>
              <Txt>{GYM_POST_WORDS.not_found}</Txt>
            </Card>
          ) : (
            <PostCard
              post={post}
              gymName={gymName}
              posted={postedText(post.createdAt, now, zone, place.clockFormat)}
              photoUrl={(photoId) => `${apiUrl}${photoPath(place.id, post.id, photoId)}`}
              files={files}
              photoRound={photoRound}
              busy={reacting === post.id}
              reactError={reactError?.postId === post.id ? reactError.text : null}
              onReact={(r) => void onReact(post, r)}
              commenting={feed?.commenting ?? "off"}
              keptComment={hasKeptWords(keptComments.drafts?.[post.id])}
              onComments={() => {
                setCommentsOn(post.id);
              }}
              onAsk={(kind) => {
                setAsking({ kind, post });
              }}
              onPhoto={(index) => {
                setViewing({ post, index });
              }}
            />
          )
        }
        ListFooterComponent={
          feed === null ? null : (
            <View style={styles.foot}>
              {feed.next === null ? null : (
                <View style={styles.middle}>
                  <Button label="Show older posts" kind="plain" small busy={more.busy} onPress={() => void showMore(feed.next ?? "")} />
                  {more.error === null ? null : <Txt colour="badText">{more.error}</Txt>}
                </View>
              )}
              {blockedLabel === null ? null : (
                <Button
                  label={blockedLabel}
                  kind="quiet"
                  style={styles.middle}
                  onPress={() => {
                    setBlockedOpen(true);
                  }}
                />
              )}
              {help === null ? null : (
                <Txt kind="small" style={styles.help}>
                  {help.text}{" "}
                  <Txt
                    kind="small"
                    colour="orange"
                    onPress={() => {
                      void Linking.openURL(`mailto:${help.email}`);
                    }}
                  >
                    {help.email}
                  </Txt>
                </Txt>
              )}
            </View>
          )
        }
      />
      {ends.top && ends.end ? null : (
        <View style={[styles.jumps, { bottom: bottom + (mayPost ? 92 : 20) }]}>
          {ends.top ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go to the top"
              hitSlop={4}
              onPress={() => {
                list.current?.scrollToOffset({ offset: 0, animated: true });
              }}
              style={styles.jump}
            >
              <Icon name="up" size={20} />
            </Pressable>
          )}
          {ends.end ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go to the bottom"
              hitSlop={4}
              onPress={() => {
                list.current?.scrollToEnd({ animated: true });
              }}
              style={styles.jump}
            >
              <Icon name="down" size={20} />
            </Pressable>
          )}
        </View>
      )}
      {mayPost ? (
        <Pressable
          testID="write-post"
          accessibilityRole="button"
          accessibilityLabel={unsent ? "Finish your post" : "Write a post"}
          accessibilityState={{ disabled: kept.draft === undefined }}
          disabled={kept.draft === undefined}
          onPress={() => {
            setPostedNote(null);
            setWriting(true);
          }}
          style={({ pressed }) => [styles.pen, unsent ? styles.penWords : null, { bottom: bottom + 20 }, pressed ? styles.penPressed : null]}
        >
          <Icon name="pen" size={22} colour="onOrange" />
          {unsent ? (
            <Txt colour="onOrange" style={styles.penLabel}>
              Finish your post
            </Txt>
          ) : null}
        </Pressable>
      ) : null}
      <PostBox
        open={writing}
        gymId={place.id}
        gymName={gymName}
        kept={kept}
        mayPost={mayPost}
        onClose={() => {
          setWriting(false);
        }}
        onPosted={(post, note) => {
          change((f) => withNewPost(f, post));
          setWriting(false);
          setPostedNote(note);
          list.current?.scrollToOffset({ offset: 0, animated: true });
        }}
        onRefused={() => void load(true)}
      />
      <CommentsBox
        post={commentsPost}
        place={place}
        gymName={gymName}
        kept={keptComments}
        zone={zone}
        onClose={() => {
          setCommentsOn(null);
        }}
        onCount={onCommentCount}
        onCommenting={onCommenting}
        onBlocked={onCommentBlocked}
        onPostGone={onCommentPostGone}
      />
      <AskSheet
        asking={asking}
        gymId={place.id}
        gymName={gymName}
        onClose={() => {
          setAsking(null);
        }}
        onRemoved={(post) => {
          change((f) => withoutPost(f, post.id));
        }}
        onReported={(post) => {
          change((f) => withPost(f, { ...post, reported: true }));
        }}
        onBlocked={(post) => {
          if (post.authorId !== null) {
            const authorId = post.authorId;
            change((f) => withoutAuthor(f, authorId));
          }
          // The count of people blocked, and anything else the block changed, come with the next read.
          void load(true);
        }}
        onGone={(post) => {
          setGone((g) => ({ ...g, [post.id]: true }));
        }}
        onPlaceGone={() => void load(true)}
      />
      <BlockedSheet
        open={blockedOpen}
        gymId={place.id}
        gymName={gymName}
        feed={feed}
        onClose={() => {
          setBlockedOpen(false);
        }}
        onUnblocked={() => void load(true)}
      />
      <PhotoViewer
        viewing={viewing}
        url={(post, photoId) => `${apiUrl}${photoPath(place.id, post.id, photoId)}`}
        files={files}
        photoRound={photoRound}
        onIndex={(index) => {
          setViewing((v) => (v === null ? v : { ...v, index }));
        }}
        onClose={() => {
          setViewing(null);
          // A photo that came here shows on its post too.
          setPhotoRound((round) => round + 1);
        }}
      />
    </>
  );
}

interface PostCardProps {
  post: GymPost;
  gymName: string;
  posted: string;
  photoUrl: (photoId: string) => string;
  files: PhotoFiles;
  photoRound: number;
  busy: boolean;
  reactError: string | null;
  onReact: (reaction: GymPostReaction) => void;
  commenting: GymMemberPosting;
  keptComment: boolean;
  onComments: () => void;
  onAsk: (kind: Asking["kind"]) => void;
  onPhoto: (index: number) => void;
}

function PostCard({ post, gymName, posted, photoUrl, files, photoRound, busy, reactError, onReact, commenting, keptComment, onComments, onAsk, onPhoto }: PostCardProps) {
  const tag = authorTag(post);
  const hidden = hiddenOwnNote(post, gymName);
  const action = memberPostAction(post);
  const [picking, setPicking] = useState(false);
  const comments = commentButton(post.commentCount, keptComment);
  return (
    <Card testID={`post-${post.id}`} style={styles.box}>
      <View style={styles.row}>
        <View style={styles.initials}>
          <Txt kind="small" colour="orange" style={styles.bold} numberOfLines={1}>
            {authorInitials(post, gymName)}
          </Txt>
        </View>
        <View style={styles.grow}>
          <Txt kind="h3" numberOfLines={1}>
            {authorName(post, gymName)}
            {tag === null ? null : <Txt kind="small">{` · ${tag}`}</Txt>}
          </Txt>
          <Txt kind="small">{posted}</Txt>
        </View>
        {post.pinned ? <Pill label="Pinned" tone="orange" icon="pin" /> : null}
      </View>
      {hidden === null ? null : (
        <View style={styles.note}>
          <Icon name="eyeoff" size={14} colour="orange" />
          <Txt kind="small" colour="orange" style={styles.grow}>
            {hidden}
          </Txt>
        </View>
      )}
      {post.body === "" ? null : <Txt colour="text">{post.body}</Txt>}
      {post.photos.length === 0 ? null : <PostPhotos post={post} photoUrl={photoUrl} files={files} photoRound={photoRound} onPhoto={onPhoto} />}
      <View style={styles.reactions}>
        <Reactions item={post} what="post" busy={busy} onReact={onReact} onPicking={setPicking} />
        {picking || !offersComments(commenting, post.commentCount, keptComment) ? null : (
          <Pressable testID="comments-open" accessibilityRole="button" accessibilityLabel={comments.say} onPress={onComments} style={[styles.reaction, keptComment ? styles.reactionMine : null]}>
            <Icon name="message" size={16} colour={keptComment ? "orange" : "textSoft"} />
            <Txt kind="small" colour={keptComment ? "orange" : "textSoft"} style={styles.bold}>
              {comments.label}
            </Txt>
          </Pressable>
        )}
        {action === null && !canBlock(post) ? null : (
          <View style={styles.actions}>
            {action === "remove" ? (
              <Button label="Remove" kind="quiet" icon="trash" say="Remove your post" onPress={() => { onAsk("remove"); }} />
            ) : action === "report" ? (
              <Button label="Report" kind="quiet" icon="flag" say={`Report this post by ${authorName(post, gymName)}`} onPress={() => { onAsk("report"); }} />
            ) : action === "reported" ? (
              <View style={styles.reported}>
                <Icon name="flag" size={14} colour="textFaint" />
                <Txt kind="small" colour="textFaint">
                  Reported
                </Txt>
              </View>
            ) : null}
            {canBlock(post) ? (
              <Button label="Block" kind="quiet" icon="ban" say={`Block ${authorName(post, gymName)}`} onPress={() => { onAsk("block"); }} />
            ) : null}
          </View>
        )}
      </View>
      {reactError === null ? null : <Txt colour="badText">{reactError}</Txt>}
    </Card>
  );
}

// A post's photos are cut to the first one's shape, within these; pressing one shows it whole.
const PHOTO_SHAPE_NARROWEST = 0.75;
const PHOTO_SHAPE_WIDEST = 1.91;
const PHOTOS_TALLEST = 420;

// By how many photos the post has, one to four: the row of them, and one of them in it.
const ALL_PHOTOS_WIDE = ["100%", "200%", "300%", "400%"] as const;
const ONE_PHOTO_WIDE = ["100%", "50%", "33.3333%", "25%"] as const;

/** A post's photos, one at a time, slid left and right with dots under them (Kd's click-through, 2026-10-30); pressing
 *  one opens it whole. As tall as the first photo's shape, within limits, so the page does not jump as they slide. */
function PostPhotos({ post, photoUrl, files, photoRound, onPhoto }: Pick<PostCardProps, "post" | "photoUrl" | "files" | "photoRound" | "onPhoto">) {
  const [at, setAt] = useState(0);
  const { photos } = post;
  const first = photos[0];
  const shape = first === undefined ? 1 : Math.min(Math.max(first.width / first.height, PHOTO_SHAPE_NARROWEST), PHOTO_SHAPE_WIDEST);
  // The card's own width, once it is known: a height limit on a shaped box would narrow the box too.
  const [wide, setWide] = useState(0);
  const allWide = ALL_PHOTOS_WIDE[photos.length - 1] ?? "100%";
  const oneWide = ONE_PHOTO_WIDE[photos.length - 1] ?? "100%";
  return (
    <View style={styles.photosBox}>
      <View
        testID={`photos-box-${post.id}`}
        onLayout={(e) => {
          setWide(e.nativeEvent.layout.width);
        }}
        style={[styles.slides, wide === 0 ? { aspectRatio: shape } : { height: Math.min(wide / shape, PHOTOS_TALLEST) }]}
      >
        <ScrollView
          testID={`photos-${post.id}`}
          horizontal
          pagingEnabled
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ width: allWide }}
          onMomentumScrollEnd={(e) => {
            const { contentOffset, layoutMeasurement } = e.nativeEvent;
            if (layoutMeasurement.width > 0) setAt(Math.round(contentOffset.x / layoutMeasurement.width));
          }}
        >
          {photos.map((photo, i) => (
            <Pressable
              key={photo.id}
              accessibilityRole="button"
              accessibilityLabel={`Open photo ${String(i + 1)} of ${String(photos.length)}`}
              onPress={() => {
                onPhoto(i);
              }}
              style={{ width: oneWide, height: "100%" }}
            >
              <SignedPhoto uri={photoUrl(photo.id)} photoId={photo.id} files={files} round={photoRound} fit="cover" testID={`photo-${photo.id}`} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {photos.length < 2 ? null : (
        <View testID={`photo-dots-${post.id}`} style={styles.dots}>
          {photos.map((p, i) => (
            <View key={p.id} testID={i === at ? "photo-dot-on" : undefined} style={[styles.dot, i === at ? styles.dotOn : null]} />
          ))}
        </View>
      )}
    </View>
  );
}

interface SignedPhotoProps {
  uri: string;
  photoId: string;
  files: PhotoFiles;
  /** A new round asks again for a photo that did not come. */
  round: number;
  fit: "cover" | "contain";
  testID?: string;
}

/** A post's photo, read from the api as the person signed in, and shown from the phone's copy. */
function SignedPhoto({ uri, photoId, files, round, fit, testID }: SignedPhotoProps) {
  const [shown, setShown] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    files.get(uri, photoId).then(
      (file) => {
        if (!live) return;
        setShown(file);
        setFailed(false);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [uri, photoId, files, round]);
  if (shown === null) {
    if (!failed) return <View style={styles.fill} />;
    return (
      <View style={[styles.fill, styles.noPhoto]}>
        <Txt kind="small" style={styles.help}>
          Couldn't load this photo.
        </Txt>
      </View>
    );
  }
  return (
    <Image
      testID={testID}
      source={{ uri: shown }}
      resizeMode={fit}
      style={styles.fill}
      accessible={false}
    />
  );
}

type Step = { kind: "ask" } | { kind: "busy" } | { kind: "failed"; text: string } | { kind: "done"; text: string };

interface AskSheetProps {
  asking: Asking | null;
  gymId: string;
  gymName: string;
  onClose: () => void;
  onRemoved: (post: GymPost) => void;
  onReported: (post: GymPost) => void;
  onBlocked: (post: GymPost) => void;
  onGone: (post: GymPost) => void;
  onPlaceGone: () => void;
}

/** Remove, Report and Block, each asked in the middle box, which then says what happened. */
function AskSheet({ asking, gymId, gymName, onClose, onRemoved, onReported, onBlocked, onGone, onPlaceGone }: AskSheetProps) {
  const { session } = useSession();
  const { height } = useWindowDimensions();
  const [step, setStep] = useState<Step>({ kind: "ask" });
  const [reason, setReason] = useState<GymPostReportReason | null>(null);
  const [note, setNote] = useState("");
  const open = useRef<Asking | null>(null);
  open.current = asking;

  useEffect(() => {
    setStep({ kind: "ask" });
    setReason(null);
    setNote("");
  }, [asking]);

  if (asking === null) return <Sheet open={false} title="" place="middle" onClose={onClose}>{null}</Sheet>;
  const { post } = asking;
  const box = asking.kind === "remove" ? ownRemoveBox(post, gymName) : asking.kind === "block" ? blockBox(post, gymName) : null;
  const report = reportBox(gymName);
  const room = reportNoteLine(note);
  const title = box?.title ?? report.title;
  const working = step.kind === "busy";

  const send = async () => {
    const mine = asking;
    setStep({ kind: "busy" });
    const answer =
      mine.kind === "remove"
        ? await session.signedIn({ method: "DELETE", path: removeOwnPath(gymId, post.id) }, removedGymPostResponseSchema)
        : mine.kind === "block"
          ? await session.signedIn({ method: "PUT", path: blockPath(gymId, post.id) }, blockedGymPosterResponseSchema)
          : await session.signedIn(
              { method: "POST", path: reportPath(gymId, post.id), body: note.trim() === "" ? { reason } : { reason, note: note.trim() } },
              reportedGymPostResponseSchema,
            );
    // The box was closed or moved to another post while this was away: the list still hears it.
    const here = open.current === mine;
    const missing = answer.kind === "refused" ? missingThing(answer) : null;
    if (answer.kind === "ok" || (missing === "post" && mine.kind === "remove")) {
      // A removal sent again after a lost reply finds its post already gone: it was removed.
      if (mine.kind === "remove") onRemoved(post);
      else if (mine.kind === "block") onBlocked(post);
      else onReported(post);
      if (here) setStep({ kind: "done", text: mine.kind === "remove" ? REMOVED_OWN : mine.kind === "block" ? blockBox(post, gymName).done : report.done });
      return;
    }
    if (missing === "post") onGone(post);
    else if (missing !== null) onPlaceGone();
    const said = missing !== null && missing !== "post" ? couldNotRead(404, gymName) : pressFailed(answer.kind === "refused" ? answer.message : null);
    if (here) setStep({ kind: "failed", text: said });
  };

  return (
    <Sheet open title={title} place="middle" onClose={onClose}>
      {step.kind === "done" ? (
        <View testID="ask-done" style={styles.ask}>
          <Txt colour="goodText">{step.text}</Txt>
          <Button label="Done" kind="quiet" style={styles.middle} onPress={onClose} />
        </View>
      ) : (
        <View testID="ask-box" style={styles.ask}>
          {box !== null ? (
            <Txt>{box.line}</Txt>
          ) : (
            <ScrollView style={{ maxHeight: height * ASK_MOST }} contentContainerStyle={styles.ask} keyboardShouldPersistTaps="handled">
              <Txt>{report.line}</Txt>
              <Options options={REPORT_REASONS.map((r) => ({ value: r.id, label: r.word }))} selected={reason} onPick={setReason} solid disabled={working} />
              <Field label={report.noteLabel} value={note} onChange={setNote} placeholder={report.notePlaceholder} lines={3} />
              <Txt kind="small" colour={room.over ? "badText" : "textSoft"}>
                {room.text}
              </Txt>
            </ScrollView>
          )}
          {step.kind === "failed" ? <Txt colour="badText">{step.text}</Txt> : null}
          <View style={styles.buttons}>
            <Button
              label={box?.confirm ?? report.confirm}
              kind={asking.kind === "remove" ? "danger" : "main"}
              small
              busy={working}
              disabled={asking.kind === "report" && (reason === null || room.over)}
              onPress={() => void send()}
            />
            <Button label={box?.cancel ?? report.cancel} kind="quiet" disabled={working} onPress={onClose} />
          </View>
        </View>
      )}
    </Sheet>
  );
}

/** The people the member has blocked here, each with Unblock, in the middle box. */
function BlockedSheet({ open, gymId, gymName, feed, onClose, onUnblocked }: { open: boolean; gymId: string; gymName: string; feed: GymPostsResponse | null; onClose: () => void; onUnblocked: () => void }) {
  const { session } = useSession();
  const { height } = useWindowDimensions();
  const [list, setList] = useState<Blocked>({ kind: "loading" });
  const [unblocking, setUnblocking] = useState<string | null>(null);
  // The people unblocked while the box is open: their row says so.
  const [done, setDone] = useState<Record<string, true | undefined>>({});
  const [failed, setFailed] = useState<string | null>(null);

  const read = useCallback(async () => {
    setList({ kind: "loading" });
    const answer = await session.signedIn({ method: "GET", path: blockedPath(gymId) }, blockedGymPostersResponseSchema);
    setList(answer.kind === "ok" ? { kind: "ok", people: answer.data.people } : { kind: "failed", text: "Couldn't load who you've blocked." });
  }, [session, gymId]);

  useEffect(() => {
    if (!open) return;
    setDone({});
    setFailed(null);
    void read();
  }, [open, read]);

  const unblock = async (id: string) => {
    setUnblocking(id);
    setFailed(null);
    const answer = await session.signedIn({ method: "DELETE", path: unblockPath(gymId, id) }, blockedGymPosterResponseSchema);
    setUnblocking(null);
    const missing = answer.kind === "refused" ? missingThing(answer) : null;
    // Sent again after a lost reply, the block is already gone: that is the answer too.
    if (answer.kind === "ok" || missing === "block") {
      setDone((d) => ({ ...d, [id]: true }));
      onUnblocked();
    } else if (missing !== null) {
      setFailed(couldNotRead(404, gymName));
      onUnblocked();
    } else {
      setFailed(pressFailed(answer.kind === "refused" ? answer.message : null));
    }
  };

  const people = list.kind === "ok" ? list.people : [];
  // Those unblocked keep their row until the box closes, but no longer count as shown.
  const shownMore = feed === null ? null : blockedMore(feed, people.length - people.filter((person) => done[person.id] === true).length);
  return (
    <Sheet open={open} title="People you've blocked" place="middle" onClose={onClose}>
      <View style={styles.ask}>
        <Txt kind="small">You don't see their posts or reactions here. They aren't told.</Txt>
        {list.kind === "loading" ? <Txt kind="small">Loading…</Txt> : null}
        {list.kind === "failed" ? (
          <>
            <Txt colour="badText">{list.text}</Txt>
            <Button label="Try again" kind="soft" small onPress={() => void read()} />
          </>
        ) : null}
        {list.kind === "ok" && people.length === 0 ? <Txt kind="small">You haven't blocked anyone here.</Txt> : null}
        {shownMore === null ? null : <Txt kind="small">{shownMore}</Txt>}
        <ScrollView style={{ maxHeight: height * ASK_MOST }} contentContainerStyle={styles.people}>
          {people.map((person) =>
            done[person.id] === true ? (
              <Txt key={person.id} colour="goodText">
                {unblockedNote(person.name)}
              </Txt>
            ) : (
              <View key={person.id} style={styles.row}>
                <Txt colour="text" numberOfLines={1} style={styles.grow}>
                  {person.name ?? "A member"}
                </Txt>
                <Button
                  label="Unblock"
                  kind="soft"
                  small
                  say={`Unblock ${person.name ?? "this member"}`}
                  busy={unblocking === person.id}
                  disabled={unblocking !== null}
                  onPress={() => void unblock(person.id)}
                />
              </View>
            ),
          )}
        </ScrollView>
        {failed === null ? null : <Txt colour="badText">{failed}</Txt>}
      </View>
    </Sheet>
  );
}

interface PhotoViewerProps {
  viewing: { post: GymPost; index: number } | null;
  url: (post: GymPost, photoId: string) => string;
  files: PhotoFiles;
  photoRound: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}

/** A post's photos, the whole screen. */
function PhotoViewer({ viewing, url, files, photoRound, onIndex, onClose }: PhotoViewerProps) {
  const post = viewing?.post ?? null;
  return (
    <PhotoPages
      viewing={post === null || viewing === null ? null : { listKey: post.id, ids: post.photos.map((p) => p.id), index: viewing.index }}
      photo={(id) => (post === null ? null : <SignedPhoto uri={url(post, id)} photoId={id} files={files} round={photoRound} fit="contain" />)}
      onIndex={onIndex}
      onClose={onClose}
    />
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: sizes.edge, paddingTop: sizes.edge, paddingBottom: 8 },
  back: {
    width: sizes.press,
    height: sizes.press,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.fill,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { paddingHorizontal: sizes.edge, gap: sizes.gap },
  top: { gap: sizes.gap, marginTop: 8, marginBottom: sizes.gap },
  // The way to write, always at hand: at the bottom right, over the list.
  pen: {
    position: "absolute",
    right: sizes.edge,
    minWidth: 60,
    minHeight: 60,
    borderRadius: sizes.round,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colours.orange,
    experimental_backgroundImage: orangeGradient,
    boxShadow: shadows.button,
  },
  penWords: { paddingHorizontal: 20 },
  // Over the photos as well as the page, so they are solid.
  jumps: { position: "absolute", right: sizes.edge + 8, gap: 10 },
  jump: {
    width: sizes.press,
    height: sizes.press,
    borderRadius: sizes.round,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.box,
    alignItems: "center",
    justifyContent: "center",
  },
  penPressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  penLabel: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  box: { padding: 16, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
  bold: { fontFamily: fonts.bold },
  initials: {
    minWidth: 36,
    minHeight: 36,
    paddingHorizontal: 4,
    borderRadius: sizes.round,
    backgroundColor: colours.orangeFill,
    alignItems: "center",
    justifyContent: "center",
  },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  photosBox: { gap: 8 },
  slides: { width: "100%", borderRadius: 12, overflow: "hidden", backgroundColor: colours.fill },
  fill: { width: "100%", height: "100%" },
  noPhoto: { alignItems: "center", justifyContent: "center", padding: 8 },
  foot: { gap: sizes.gap },
  reactions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  reaction: {
    minHeight: sizes.press,
    minWidth: sizes.press,
    paddingHorizontal: 12,
    borderRadius: sizes.round,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colours.fill,
    borderWidth: 1,
    borderColor: colours.line,
  },
  reactionMine: { backgroundColor: colours.orangeFill, borderColor: colours.orangeLine },
  // Beside the reactions, at the card's right; on a narrow phone, on the next line, still at the right.
  actions: { flexDirection: "row", marginLeft: "auto", columnGap: 12 },
  reported: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: sizes.press },
  middle: { alignSelf: "center", alignItems: "center", gap: 8 },
  help: { textAlign: "center" },
  ask: { gap: 12 },
  people: { gap: 10 },
  buttons: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", columnGap: 20, rowGap: 8 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: sizes.round, backgroundColor: colours.textFaint },
  dotOn: { backgroundColor: colours.orange },
});
