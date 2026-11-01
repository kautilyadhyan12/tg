import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, FlatList, Linking, Pressable, StyleSheet, View } from "react-native";
import { Modal } from "../../look/Modal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  GYM_POST_WORDS,
  gymPostReactionResponseSchema,
  gymPostsResponseSchema,
  type GymClockFormat,
  type GymMemberPosting,
  type GymPost,
  type GymPostReaction,
  type GymPostsResponse,
} from "@app/shared";
import { Button } from "../../look/Button";
import { Card } from "../../look/Card";
import { colours, orangeGradient, shadows, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { CopyContext } from "../ThisCopy";
import { CommentsBox, useKeptComments } from "./Comments";
import { hasKeptWords } from "./commentsView";
import { PersonProfile, type ProfilePerson } from "./PersonProfile";
import { AskSheet, BlockedSheet, PhotoViewer, PostCard, phoneZone, type Asking } from "./PostCard";
import { hasWork } from "./postDraft";
import { PostBox, useKeptPost } from "./PostBox";
import {
  blockedButton,
  canOpenPerson,
  couldNotRead,
  emptyLine,
  helpLine,
  memberCanPost,
  missingThing,
  photoPath,
  postedText,
  reactionPath,
  stoppedNote,
  updatesPath,
  withNewPost,
  withPage,
  withPost,
  withReaction,
  withoutAuthor,
  withoutPost,
} from "./updatesView";
import { photoFiles } from "./photoFiles";
import { personOf } from "./personView";

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
  const [person, setPerson] = useState<ProfilePerson | null>(null);
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
              {...(canOpenPerson(post)
                ? {
                    onPerson: () => {
                      setPerson(personOf(post));
                    },
                  }
                : {})}
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
      <PersonProfile
        place={place}
        person={person}
        period="this_week"
        shared={{ files, keptComments }}
        onClose={() => {
          setPerson(null);
          setPhotoRound((round) => round + 1);
        }}
        onChanged={() => void load(true)}
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
  grow: { flex: 1 },
  foot: { gap: sizes.gap },
  middle: { alignSelf: "center", alignItems: "center", gap: 8 },
  help: { textAlign: "center" },
});
