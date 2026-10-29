import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
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
  type GymPost,
  type GymPostReaction,
  type GymPostReportReason,
  type GymPostsResponse,
} from "@app/shared";
import { Button } from "../../look/Button";
import { Card, Pill } from "../../look/Card";
import { Options } from "../../look/Choice";
import { colours, sizes } from "../../look/colours";
import { Field } from "../../look/Field";
import { Icon, type IconName } from "../../look/Icon";
import { Sheet } from "../../look/Sheet";
import { ASK_MOST } from "../../look/sizing";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { CopyContext } from "../ThisCopy";
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
  memberPostAction,
  ownRemoveBox,
  photoPath,
  postedText,
  pressFailed,
  reactionButtons,
  reactionPath,
  removeOwnPath,
  reportBox,
  reportNoteLine,
  reportPath,
  unblockPath,
  unblockedNote,
  updatesPath,
  withPage,
  withPost,
  withReaction,
  withoutAuthor,
  withoutPost,
} from "./updatesView";

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

const REACTION_ICONS: Readonly<Record<GymPostReaction, IconName>> = { like: "like", love: "heart", strong: "strong", fire: "flame" };

function UpdatesBody({ place, onClose, bottom }: { place: UpdatesPlace; onClose: () => void; bottom: number }) {
  const { session } = useSession();
  const apiUrl = useContext(CopyContext).extra?.apiUrl ?? "";
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
  // The photos are read signed in: the token they were asked with, and whether it has been renewed for them.
  const [token, setToken] = useState(() => session.accessToken());
  const renewed = useRef(false);
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
    void session.refreshIfDue().then(() => {
      if (live.current) setToken(session.accessToken());
    });
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

  // A photo refused for an old token: renewed once, and every photo asks again with the new one.
  const photoFailed = useCallback(() => {
    if (renewed.current) return;
    renewed.current = true;
    void session.refresh().then(() => {
      if (live.current) setToken(session.accessToken());
    });
  }, [session]);

  const showMore = async (next: string) => {
    setMore({ busy: true, error: null });
    const number = started.current;
    const answer = await session.signedIn({ method: "GET", path: updatesPath(place.id, next) }, gymPostsResponseSchema);
    // A new first page read since makes this page's place in the list unknown.
    if (!live.current || number !== started.current) return;
    if (answer.kind === "ok" && answer.data.gymId === place.id) {
      change((feed) => withPage(feed, answer.data));
      setMore({ busy: false, error: null });
    } else {
      setMore({ busy: false, error: "Couldn’t load more." });
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
    } else if (answer.kind === "refused" && answer.status === 404) {
      setGone((g) => ({ ...g, [post.id]: true }));
    } else {
      // Put back as it was: the tap did not reach the gym's page.
      change((feed) => withPost(feed, post));
      setReactError({ postId: post.id, text: answer.kind === "refused" ? answer.message : "Couldn’t save your reaction. Please try again." });
    }
  };

  const feed = held.kind === "ok" ? held.feed : null;
  const gymName = feed?.gymName ?? place.name;
  const empty = feed === null ? null : emptyLine(feed, false);
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
      <ScrollView style={styles.grow} contentContainerStyle={[styles.list, { paddingBottom: bottom + 24 }]}>
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
        ) : (
          <>
            {empty !== null ? (
              <Card style={styles.box}>
                <Txt>{empty}</Txt>
              </Card>
            ) : (
              [...held.feed.pinned, ...held.feed.posts].map((post) =>
                gone[post.id] === true ? (
                  <Card key={post.id} testID={`post-gone-${post.id}`} style={styles.box}>
                    <Txt>{GYM_POST_WORDS.not_found}</Txt>
                  </Card>
                ) : (
                  <PostCard
                    key={post.id}
                    post={post}
                    gymName={gymName}
                    posted={postedText(post.createdAt, now, zone, place.clockFormat)}
                    photoUrl={(photoId) => `${apiUrl}${photoPath(place.id, post.id, photoId)}`}
                    token={token}
                    onPhotoFailed={photoFailed}
                    busy={reacting === post.id}
                    reactError={reactError?.postId === post.id ? reactError.text : null}
                    onReact={(r) => void onReact(post, r)}
                    onAsk={(kind) => {
                      setAsking({ kind, post });
                    }}
                    onPhoto={(index) => {
                      setViewing({ post, index });
                    }}
                  />
                ),
              )
            )}
            {held.feed.next === null ? null : (
              <View style={styles.middle}>
                <Button label="Show older posts" kind="plain" small busy={more.busy} onPress={() => void showMore(held.feed.next ?? "")} />
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
          </>
        )}
      </ScrollView>
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
      />
      <BlockedSheet
        open={blockedOpen}
        gymId={place.id}
        feed={feed}
        onClose={() => {
          setBlockedOpen(false);
        }}
        onUnblocked={() => void load(true)}
      />
      <PhotoViewer
        viewing={viewing}
        url={(post, photoId) => `${apiUrl}${photoPath(place.id, post.id, photoId)}`}
        token={token}
        onPhotoFailed={photoFailed}
        onIndex={(index) => {
          setViewing((v) => (v === null ? v : { ...v, index }));
        }}
        onClose={() => {
          setViewing(null);
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
  token: string | null;
  onPhotoFailed: () => void;
  busy: boolean;
  reactError: string | null;
  onReact: (reaction: GymPostReaction) => void;
  onAsk: (kind: Asking["kind"]) => void;
  onPhoto: (index: number) => void;
}

function PostCard({ post, gymName, posted, photoUrl, token, onPhotoFailed, busy, reactError, onReact, onAsk, onPhoto }: PostCardProps) {
  const tag = authorTag(post);
  const hidden = hiddenOwnNote(post, gymName);
  const action = memberPostAction(post);
  return (
    <Card testID={`post-${post.id}`} style={styles.box}>
      <View style={styles.row}>
        <View style={styles.initials}>
          <Txt kind="small" colour="orange" style={styles.bold}>
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
      {post.photos.length === 0 ? null : (
        <View style={styles.photos}>
          {post.photos.map((photo, i) => (
            <Pressable
              key={photo.id}
              accessibilityRole="button"
              accessibilityLabel={`Open photo ${String(i + 1)} of ${String(post.photos.length)}`}
              onPress={() => {
                onPhoto(i);
              }}
              style={[styles.photo, post.photos.length === 1 ? { width: "100%", aspectRatio: Math.max(photo.width / photo.height, 0.75) } : styles.photoHalf]}
            >
              <SignedPhoto uri={photoUrl(photo.id)} token={token} onFailed={onPhotoFailed} fit="cover" testID={`photo-${photo.id}`} />
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.reactions}>
        {reactionButtons(post).map((r) => (
          <Pressable
            key={r.id}
            testID={`react-${r.id}`}
            accessibilityRole="button"
            accessibilityLabel={r.label}
            accessibilityState={{ selected: r.mine, disabled: busy }}
            disabled={busy}
            onPress={() => {
              onReact(r.id);
            }}
            style={[styles.reaction, r.mine ? styles.reactionMine : null]}
          >
            <Icon name={REACTION_ICONS[r.id]} size={16} colour={r.mine ? "orange" : "textSoft"} />
            {r.count > 0 ? (
              <Txt kind="small" colour={r.mine ? "orange" : "textSoft"} style={styles.bold}>
                {r.count.toLocaleString("en")}
              </Txt>
            ) : null}
          </Pressable>
        ))}
      </View>
      {reactError === null ? null : <Txt colour="badText">{reactError}</Txt>}
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
    </Card>
  );
}

/** A post's photo, read from the api as the person signed in. */
function SignedPhoto({ uri, token, onFailed, fit, testID }: { uri: string; token: string | null; onFailed: () => void; fit: "cover" | "contain"; testID?: string }) {
  if (token === null) return <View style={styles.fill} />;
  return (
    <Image
      key={token}
      testID={testID}
      source={{ uri, headers: { authorization: `Bearer ${token}` } }}
      resizeMode={fit}
      style={styles.fill}
      accessible={false}
      onError={onFailed}
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
}

/** Remove, Report and Block, each asked in the middle box, which then says what happened. */
function AskSheet({ asking, gymId, gymName, onClose, onRemoved, onReported, onBlocked, onGone }: AskSheetProps) {
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
    const missing = answer.kind === "refused" && answer.status === 404;
    if (answer.kind === "ok" || (missing && mine.kind === "remove")) {
      // A removal sent again after a lost reply finds its post already gone: it was removed.
      if (mine.kind === "remove") onRemoved(post);
      else if (mine.kind === "block") onBlocked(post);
      else onReported(post);
      if (here) setStep({ kind: "done", text: mine.kind === "remove" ? REMOVED_OWN : mine.kind === "block" ? blockBox(post, gymName).done : report.done });
      return;
    }
    if (missing) onGone(post);
    if (here) setStep({ kind: "failed", text: pressFailed(answer.kind === "refused" ? answer.message : null) });
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
function BlockedSheet({ open, gymId, feed, onClose, onUnblocked }: { open: boolean; gymId: string; feed: GymPostsResponse | null; onClose: () => void; onUnblocked: () => void }) {
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
    setList(answer.kind === "ok" ? { kind: "ok", people: answer.data.people } : { kind: "failed", text: "Couldn’t load who you’ve blocked." });
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
    // Sent again after a lost reply, the block is already gone: that is the answer too.
    if (answer.kind === "ok" || (answer.kind === "refused" && answer.status === 404)) {
      setDone((d) => ({ ...d, [id]: true }));
      onUnblocked();
    } else {
      setFailed(pressFailed(answer.kind === "refused" ? answer.message : null));
    }
  };

  const people = list.kind === "ok" ? list.people : [];
  const shownMore = feed === null ? null : blockedMore(feed, people.length);
  return (
    <Sheet open={open} title="People you’ve blocked" place="middle" onClose={onClose}>
      <View style={styles.ask}>
        <Txt kind="small">You don’t see their posts or reactions here. They aren’t told.</Txt>
        {list.kind === "loading" ? <Txt kind="small">Loading…</Txt> : null}
        {list.kind === "failed" ? (
          <>
            <Txt colour="badText">{list.text}</Txt>
            <Button label="Try again" kind="soft" small onPress={() => void read()} />
          </>
        ) : null}
        {list.kind === "ok" && people.length === 0 ? <Txt kind="small">You haven’t blocked anyone here.</Txt> : null}
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
  token: string | null;
  onPhotoFailed: () => void;
  onIndex: (index: number) => void;
  onClose: () => void;
}

/** A post's photos, one at a time, the whole screen. */
function PhotoViewer({ viewing, url, token, onPhotoFailed, onIndex, onClose }: PhotoViewerProps) {
  const insets = useSafeAreaInsets();
  const photos = viewing?.post.photos ?? [];
  const index = viewing === null ? 0 : Math.min(viewing.index, photos.length - 1);
  const photo = photos[index];
  return (
    <Modal visible={viewing !== null} animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View testID="photo-viewer" style={[styles.viewer, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.viewerHead}>
          <Txt colour="text" style={styles.grow}>
            {photos.length === 0 ? "" : `Photo ${String(index + 1)} of ${String(photos.length)}`}
          </Txt>
          <Pressable accessibilityRole="button" accessibilityLabel="Close photo" onPress={onClose} style={styles.back}>
            <Icon name="x" size={18} />
          </Pressable>
        </View>
        <View style={styles.grow}>
          {viewing === null || photo === undefined ? null : <SignedPhoto uri={url(viewing.post, photo.id)} token={token} onFailed={onPhotoFailed} fit="contain" />}
        </View>
        {photos.length < 2 ? null : (
          <View style={styles.buttons}>
            <Button label="Previous" kind="plain" small disabled={index === 0} onPress={() => { onIndex(index - 1); }} />
            <Button label="Next" kind="plain" small disabled={index === photos.length - 1} onPress={() => { onIndex(index + 1); }} />
          </View>
        )}
      </View>
    </Modal>
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
  box: { padding: 16, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
  bold: { fontFamily: fonts.bold },
  initials: {
    width: 36,
    height: 36,
    borderRadius: sizes.round,
    backgroundColor: colours.orangeFill,
    alignItems: "center",
    justifyContent: "center",
  },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  photo: { borderRadius: 12, overflow: "hidden", backgroundColor: colours.fill, maxHeight: 420 },
  photoHalf: { width: "48.5%", aspectRatio: 1 },
  fill: { width: "100%", height: "100%" },
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
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", columnGap: 20 },
  reported: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: sizes.press },
  middle: { alignSelf: "center", alignItems: "center", gap: 8 },
  help: { textAlign: "center" },
  ask: { gap: 12 },
  people: { gap: 10 },
  buttons: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", columnGap: 20, rowGap: 8 },
  viewer: { flex: 1, backgroundColor: colours.page, paddingHorizontal: sizes.edge, gap: 12 },
  viewerHead: { flexDirection: "row", alignItems: "center", gap: 12 },
});
