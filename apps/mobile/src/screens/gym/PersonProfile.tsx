import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, FlatList, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  GYM_POST_WORDS,
  gymPostReactionResponseSchema,
  leaderboardProfileResponseSchema,
  personGymPostsResponseSchema,
  type GymClockFormat,
  type GymMemberPosting,
  type GymPost,
  type GymPostReaction,
  type GymPostsResponse,
  type LeaderboardPeriod,
  type LeaderboardProfileResponse,
} from "@app/shared";
import { Button } from "../../look/Button";
import { Card } from "../../look/Card";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Modal } from "../../look/Modal";
import { PictureTop } from "../../look/PictureTop";
import { pictureTopHeight } from "../../look/sizing";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { CopyContext } from "../ThisCopy";
import { useBusyIds } from "./Reactions";
import { countAfter } from "./commentsView";
import { CommentsBox, useKeptComments, type KeptCommentsHook } from "./Comments";
import { hasKeptWords } from "./commentsView";
import { photoFiles, type PhotoFiles } from "./photoFiles";
import { asFeed, noPostsLine, personPlacesPath, personPostsPath, placeStats, postsStat, type ProfilePerson, type ProfileStat } from "./personView";
import { AskSheet, BlockedSheet, PhotoViewer, PostCard, phoneZone, type Asking } from "./PostCard";
import { couldNotRead, missingThing, photoPath, postedText, reactionPath, withPage, withPost, withReaction, withoutAuthor, withoutPost } from "./updatesView";

export type { ProfilePerson } from "./personView";

// A person's profile, for another member of their gym (spec Part 3 §15.5, §15.2): a picture across the top, their round
// mark over its edge with the numbers beside it, the name under them, then their posts as one feed. The server sends a hidden person's places to
// nobody and a blocked or departed person's posts to nobody; the page draws only what was answered about this person.
// Read when it opens and when the app comes back.

export interface ProfilePlace {
  id: string;
  name: string;
  clockFormat: GymClockFormat;
}

/** What the page behind already holds: two copies of either would empty or overwrite the other's. */
interface Shared {
  files: PhotoFiles;
  keptComments: KeptCommentsHook;
}

interface PersonProfileProps {
  place: ProfilePlace;
  person: ProfilePerson | null;
  /** The period the page behind was showing, so the numbers agree with it. */
  period: LeaderboardPeriod;
  shared?: Shared;
  onClose: () => void;
  /** Something changed that the page behind shows too. */
  onChanged?: () => void;
}

/** The page over Updates or the Leaderboard; closed while `person` is null. */
export function PersonProfile({ place, person, period, shared, onClose, onChanged }: PersonProfileProps) {
  const insets = useSafeAreaInsets();
  const inside = { place, period, onClose, top: insets.top, bottom: insets.bottom, ...(onChanged === undefined ? {} : { onChanged }) };
  return (
    <Modal visible={person !== null} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View testID="person-profile" accessibilityViewIsModal style={styles.page}>
        {person === null ? null : shared === undefined ? (
          <OwnStores key={`${place.id}:${person.userId}`} person={person} {...inside} />
        ) : (
          <Body key={`${place.id}:${person.userId}`} person={person} shared={shared} {...inside} />
        )}
      </View>
    </Modal>
  );
}

type Inside = Omit<PersonProfileProps, "person" | "shared"> & { person: ProfilePerson; top: number; bottom: number };

/** Opened where no page behind holds the photos and the unsent comments. */
function OwnStores(props: Inside) {
  const { session, state } = useSession();
  const [files] = useState(() => photoFiles(session));
  const keptComments = useKeptComments(state.kind === "in" ? state.user.id : null, props.place.id);
  useEffect(
    () => () => {
      files.clear();
    },
    [files],
  );
  return <Body {...props} shared={{ files, keptComments }} />;
}

type Places = { kind: "loading" } | { kind: "none" } | { kind: "failed" } | { kind: "ok"; boards: LeaderboardProfileResponse["boards"] };
type Posts = { kind: "loading" } | { kind: "failed"; status: number | null } | { kind: "ok"; feed: GymPostsResponse; total: number; blocked: boolean };

/** The page after a block. Blocking this page's own person leaves nothing of theirs, and says why, before any read. */
function afterBlock(posts: Extract<Posts, { kind: "ok" }>, authorId: string, personId: string): Posts {
  const feed = withoutAuthor(posts.feed, authorId);
  if (authorId !== personId) return { ...posts, feed };
  return { ...posts, feed: { ...feed, next: null, blockedCount: feed.blockedCount + 1 }, total: 0, blocked: true };
}

const PICTURE_TALL = 0.42;
const MARK = 92;
const BACK_TOP = 12;
const BACK_BAR = BACK_TOP + sizes.press + 8;

function Body({ place, person, period, shared, onClose, onChanged, top, bottom }: Inside & { shared: Shared }) {
  const { session } = useSession();
  const { width, height } = useWindowDimensions();
  const apiUrl = useContext(CopyContext).extra?.apiUrl ?? "";
  const { files, keptComments } = shared;
  const [places, setPlaces] = useState<Places>({ kind: "loading" });
  const [posts, setPosts] = useState<Posts>({ kind: "loading" });
  const [more, setMore] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const reacting = useBusyIds();
  const [reactError, setReactError] = useState<{ postId: string; text: string } | null>(null);
  const [gone, setGone] = useState<Record<string, true | undefined>>({});
  const [asking, setAsking] = useState<Asking | null>(null);
  const [viewing, setViewing] = useState<{ post: GymPost; index: number } | null>(null);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [commentsOn, setCommentsOn] = useState<string | null>(null);
  const [photoRound, setPhotoRound] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  // Reads are numbered as they start: an answer stands only if no later read has started.
  const placesStarted = useRef(0);
  const postsStarted = useRef(0);
  const live = useRef(true);
  // A press has changed something the page behind shows. It reads again when this page has gone, by whichever way out,
  // or when the press is answered if that comes later: a read sent before the answer may not hold it.
  const told = useRef(false);
  const tellBehind = useRef(onChanged);
  tellBehind.current = onChanged;
  const changed = useCallback(() => {
    if (live.current) told.current = true;
    else tellBehind.current?.();
  }, []);
  useEffect(
    () => () => {
      if (told.current) tellBehind.current?.();
    },
    [],
  );

  const loadPlaces = useCallback(
    async (quiet: boolean) => {
      placesStarted.current += 1;
      const number = placesStarted.current;
      const answer = await session.signedIn({ method: "GET", path: personPlacesPath(place.id, person.userId, period) }, leaderboardProfileResponseSchema);
      if (!live.current || number !== placesStarted.current) return;
      // Another person's numbers are never shown under this one.
      if (answer.kind === "ok") setPlaces(answer.data.userId === person.userId ? { kind: "ok", boards: answer.data.boards } : { kind: "none" });
      // "Not found" is the answer for somebody on no board, Hide me included: their places leave the screen.
      else if (answer.kind === "refused" && answer.status === 404) setPlaces({ kind: "none" });
      else setPlaces((was) => (!quiet || was.kind === "loading" ? { kind: "failed" } : was));
    },
    [session, place.id, person.userId, period],
  );

  const loadPosts = useCallback(
    async (quiet: boolean) => {
      postsStarted.current += 1;
      const number = postsStarted.current;
      const answer = await session.signedIn({ method: "GET", path: personPostsPath(place.id, person.userId) }, personGymPostsResponseSchema);
      if (!live.current || number !== postsStarted.current) return;
      if (answer.kind === "ok") {
        setPosts({ kind: "ok", feed: asFeed(answer.data, place.id, place.name), total: answer.data.total, blocked: answer.data.blocked });
        setGone({});
        setMore({ busy: false, error: null });
        setPhotoRound((round) => round + 1);
      } else {
        // A read made by itself never takes posts away over a lost connection, and never leaves "Loading…" for good.
        const failed: Posts = { kind: "failed", status: answer.kind === "refused" ? answer.status : null };
        setPosts((was) => (!quiet || failed.status === 404 || was.kind === "loading" ? failed : was));
      }
    },
    [session, place.id, place.name, person.userId],
  );

  useEffect(() => {
    live.current = true;
    void loadPlaces(false);
    void loadPosts(false);
    const back = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void loadPlaces(true);
      void loadPosts(true);
    });
    return () => {
      live.current = false;
      back.remove();
    };
  }, [loadPlaces, loadPosts]);

  const change = (fn: (feed: GymPostsResponse) => GymPostsResponse, by = 0) => {
    setPosts((p) => (p.kind === "ok" ? { ...p, feed: fn(p.feed), total: Math.max(0, p.total + by) } : p));
  };

  const showMore = async (next: string) => {
    setMore({ busy: true, error: null });
    const number = postsStarted.current;
    const answer = await session.signedIn({ method: "GET", path: personPostsPath(place.id, person.userId, next) }, personGymPostsResponseSchema);
    if (!live.current) return;
    if (number !== postsStarted.current) {
      setMore({ busy: false, error: null });
      return;
    }
    if (answer.kind === "ok") {
      const page = asFeed(answer.data, place.id, place.name);
      setPosts((p) => (p.kind === "ok" ? { ...p, feed: withPage(p.feed, page), total: answer.data.total, blocked: answer.data.blocked } : p));
      setMore({ busy: false, error: null });
    } else {
      setMore({ busy: false, error: "Couldn't load more." });
    }
  };

  const onReact = async (post: GymPost, tapped: GymPostReaction) => {
    const next = withReaction(post, tapped);
    setReactError(null);
    reacting.add(post.id);
    // A read that started before this press may not hold it.
    postsStarted.current += 1;
    change((feed) => withPost(feed, next));
    const answer = await session.signedIn({ method: "PUT", path: reactionPath(place.id, post.id), body: { reaction: next.mine } }, gymPostReactionResponseSchema);
    changed();
    if (!live.current) return;
    reacting.remove(post.id);
    postsStarted.current += 1;
    if (answer.kind === "ok") {
      change((feed) => withPost(feed, { ...next, reactions: answer.data.reactions, mine: answer.data.mine }));
      return;
    }
    const missing = answer.kind === "refused" ? missingThing(answer) : null;
    if (missing === "post") {
      setGone((g) => ({ ...g, [post.id]: true }));
      return;
    }
    change((feed) => withPost(feed, post));
    if (missing !== null) {
      setReactError({ postId: post.id, text: couldNotRead(404, place.name) });
      void loadPosts(true);
    } else {
      setReactError({ postId: post.id, text: answer.kind === "refused" ? answer.message : "Couldn't save your reaction. Please try again." });
      // The press may have reached the server with only its answer lost: the server says what it holds.
      if (answer.kind === "no_answer") void loadPosts(true);
    }
  };

  const onCommentCount = useCallback((postId: string, by: number) => {
    changed();
    postsStarted.current += 1;
    setPosts((p) => {
      if (p.kind !== "ok") return p;
      const post = p.feed.posts.find((x) => x.id === postId);
      return post === undefined ? p : { ...p, feed: withPost(p.feed, { ...post, commentCount: countAfter(post.commentCount, by) }) };
    });
  }, [changed]);
  const onCommenting = useCallback((commenting: GymMemberPosting) => {
    setPosts((p) => (p.kind === "ok" && p.feed.commenting !== commenting ? { ...p, feed: { ...p.feed, commenting } } : p));
  }, []);
  const onCommentPostGone = useCallback((postId: string) => {
    postsStarted.current += 1;
    setGone((g) => ({ ...g, [postId]: true }));
  }, []);
  const blockedAuthor = useCallback(
    (authorId: string) => {
      changed();
      setPosts((p) => (p.kind === "ok" ? afterBlock(p, authorId, person.userId) : p));
      void loadPosts(true);
    },
    [changed, loadPosts, person.userId],
  );

  const feed = posts.kind === "ok" ? posts.feed : null;
  const commentsPost = commentsOn === null || feed === null ? null : (feed.posts.find((p) => p.id === commentsOn) ?? null);
  const stats: ProfileStat[] = [postsStat(posts.kind === "ok" ? posts.total : null), ...(places.kind === "ok" ? placeStats(places.boards, period) : [])];
  const blocked = posts.kind === "ok" && posts.blocked;
  const empty = posts.kind === "ok" && posts.feed.posts.length === 0 ? noPostsLine(person.name, posts.blocked) : null;
  const now = new Date();
  const zone = phoneZone();
  const photoUrl = (post: GymPost, photoId: string) => `${apiUrl}${photoPath(place.id, post.id, photoId)}`;

  return (
    <>
      <FlatList
        testID="person-list"
        style={styles.grow}
        scrollEventThrottle={100}
        onScroll={(event) => {
          setScrolled(event.nativeEvent.contentOffset.y > pictureTopHeight(width, height, PICTURE_TALL) - top - BACK_BAR);
        }}
        contentContainerStyle={[styles.list, { paddingBottom: bottom + 24 }]}
        data={feed === null ? [] : feed.posts}
        keyExtractor={(post) => post.id}
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={5}
        ListHeaderComponent={
          <View>
            <PictureTop picture="cave" tall={PICTURE_TALL} />
            <View style={styles.markRow}>
              <View style={styles.mark}>
                <Txt kind="h2" colour="orange" numberOfLines={1}>
                  {person.initials}
                </Txt>
              </View>
              <View testID="person-stats" accessibilityLabel={`${person.name} in numbers`} style={styles.stats}>
                {stats.map((stat) => (
                  <View key={stat.key} testID={`stat-${stat.key}`} style={styles.stat}>
                    <Txt kind="h3" style={styles.centre}>
                      {stat.number}
                    </Txt>
                    <Txt kind="small" colour="text" style={styles.centre}>
                      {stat.label}
                    </Txt>
                    {stat.under === null ? null : (
                      <Txt kind="tiny" style={styles.centre}>
                        {stat.under}
                      </Txt>
                    )}
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.who}>
              <Txt kind="h2">{person.name}</Txt>
              <Txt kind="small">{`Member at ${place.name}`}</Txt>
            </View>
            {places.kind !== "failed" ? null : (
              <View style={styles.saying}>
                <Txt kind="small" colour="badText">
                  Couldn't load their places on the leaderboard.
                </Txt>
                <Button
                  label="Try again"
                  kind="link"
                  say="Try their places again"
                  onPress={() => {
                    setPlaces({ kind: "loading" });
                    void loadPlaces(false);
                  }}
                />
              </View>
            )}
            <View style={styles.line} />
            <View style={styles.top}>
              {posts.kind === "loading" ? <Txt kind="small">Loading…</Txt> : null}
              {posts.kind === "failed" ? (
                <Card style={styles.box}>
                  <Txt colour="badText">{posts.status === 404 ? couldNotRead(404, place.name) : "Couldn't load their posts."}</Txt>
                  <Button
                    label="Try again"
                    kind="soft"
                    small
                    onPress={() => {
                      setPosts({ kind: "loading" });
                      void loadPosts(false);
                    }}
                  />
                </Card>
              ) : null}
              {empty === null ? null : (
                <Card testID="person-empty" style={styles.box}>
                  <Txt>{empty}</Txt>
                  {blocked ? (
                    <Button
                      label="People you've blocked"
                      kind="soft"
                      small
                      onPress={() => {
                        setBlockedOpen(true);
                      }}
                    />
                  ) : null}
                </Card>
              )}
            </View>
          </View>
        }
        renderItem={({ item: post }) => (
          <View>
            {gone[post.id] === true ? (
              <View style={styles.card}>
                <Card testID={`post-gone-${post.id}`} style={styles.box}>
                  <Txt>{GYM_POST_WORDS.not_found}</Txt>
                </Card>
              </View>
            ) : (
              <PostCard
                inFeed
                post={post}
                gymName={place.name}
                posted={postedText(post.createdAt, now, zone, place.clockFormat)}
                photoUrl={(photoId) => photoUrl(post, photoId)}
                files={files}
                photoRound={photoRound}
                busy={reacting.has(post.id)}
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
            )}
          </View>
        )}
        ListFooterComponent={
          feed === null || feed.next === null ? null : (
            <View style={styles.more}>
              <Button label="Show older posts" kind="plain" small busy={more.busy} onPress={() => void showMore(feed.next ?? "")} />
              {more.error === null ? null : <Txt colour="badText">{more.error}</Txt>}
            </View>
          )
        }
      />
      {scrolled ? (
        <View testID="person-bar" style={[styles.bar, { minHeight: top + BACK_BAR }]}>
          <Txt kind="h3" numberOfLines={1}>
            {person.name}
          </Txt>
        </View>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} style={[styles.back, { top: top + BACK_TOP }]}>
        <Icon name="back" size={18} />
      </Pressable>
      <CommentsBox
        post={commentsPost}
        place={place}
        gymName={place.name}
        kept={keptComments}
        zone={zone}
        onClose={() => {
          setCommentsOn(null);
        }}
        onCount={onCommentCount}
        onCommenting={onCommenting}
        onBlocked={blockedAuthor}
        onPostGone={onCommentPostGone}
      />
      <AskSheet
        asking={asking}
        gymId={place.id}
        gymName={place.name}
        onClose={() => {
          setAsking(null);
        }}
        onRemoved={(post) => {
          changed();
          postsStarted.current += 1;
          change((f) => withoutPost(f, post.id), -1);
        }}
        onReported={(post) => {
          changed();
          postsStarted.current += 1;
          change((f) => withPost(f, { ...post, reported: true }));
        }}
        onBlocked={(post) => {
          if (post.authorId !== null) blockedAuthor(post.authorId);
        }}
        onGone={(post) => {
          postsStarted.current += 1;
          setGone((g) => ({ ...g, [post.id]: true }));
        }}
        onPlaceGone={() => void loadPosts(true)}
      />
      <BlockedSheet
        open={blockedOpen}
        gymId={place.id}
        gymName={place.name}
        feed={feed}
        onClose={() => {
          setBlockedOpen(false);
        }}
        onUnblocked={() => {
          changed();
          void loadPosts(true);
        }}
      />
      <PhotoViewer
        viewing={viewing}
        url={photoUrl}
        files={files}
        photoRound={photoRound}
        onIndex={(index) => {
          setViewing((v) => (v === null ? v : { ...v, index }));
        }}
        onClose={() => {
          setViewing(null);
          setPhotoRound((round) => round + 1);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  grow: { flex: 1 },
  list: {},
  markRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: sizes.edge, marginTop: -MARK / 2 },
  who: { paddingHorizontal: sizes.edge, paddingTop: 10, gap: 2 },
  mark: {
    minWidth: MARK,
    minHeight: MARK,
    paddingHorizontal: 6,
    borderRadius: sizes.round,
    borderWidth: 3,
    borderColor: colours.page,
    backgroundColor: colours.orangeFill,
    alignItems: "center",
    justifyContent: "center",
  },
  // Below the picture, beside the mark's lower half.
  stats: { flex: 1, flexDirection: "row", flexWrap: "wrap", paddingTop: MARK / 2 + 6, rowGap: 10 },
  stat: { flexGrow: 1, flexBasis: 58, gap: 1, alignItems: "center" },
  centre: { textAlign: "center" },
  saying: { paddingHorizontal: sizes.edge, paddingTop: 8, alignItems: "flex-start" },
  line: { height: 1, backgroundColor: colours.line, marginTop: 14, marginBottom: 2 },
  top: { paddingHorizontal: sizes.edge, gap: sizes.gap },
  box: { padding: 16, gap: 10 },
  card: { paddingHorizontal: sizes.edge },
  more: { paddingHorizontal: sizes.edge, paddingTop: sizes.gap, alignSelf: "center", alignItems: "center", gap: 8 },
  bar: { position: "absolute", top: 0, left: 0, right: 0, justifyContent: "flex-end", paddingLeft: sizes.edge + sizes.press + 12, paddingRight: sizes.edge, paddingBottom: 8 + (sizes.press - 24) / 2, backgroundColor: colours.page, borderBottomWidth: 1, borderBottomColor: colours.line },
  back: {
    position: "absolute",
    left: sizes.edge,
    width: sizes.press,
    height: sizes.press,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.box,
    alignItems: "center",
    justifyContent: "center",
  },
});
