import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import {
  blockedGymPosterResponseSchema,
  blockedGymPostersResponseSchema,
  removedGymPostResponseSchema,
  reportedGymPostResponseSchema,
  type BlockedGymPostersResponse,
  type GymMemberPosting,
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
import { Icon } from "../../look/Icon";
import { Sheet } from "../../look/Sheet";
import { ASK_MOST } from "../../look/sizing";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { commentButton, offersComments } from "./commentsView";
import { PhotoPages } from "./PhotoPages";
import type { PhotoFiles } from "./photoFiles";
import { Reactions } from "./Reactions";
import {
  REMOVED_OWN,
  REPORT_REASONS,
  authorInitials,
  authorName,
  authorTag,
  blockBox,
  blockPath,
  blockedMore,
  blockedPath,
  canBlock,
  canOpenPerson,
  couldNotRead,
  hiddenOwnNote,
  memberPostAction,
  missingThing,
  ownRemoveBox,
  personLink,
  pressFailed,
  removeOwnPath,
  reportBox,
  reportNoteLine,
  reportPath,
  unblockPath,
  unblockedNote,
} from "./updatesView";

// One post as a member sees it, and the boxes its buttons open: Updates' and a person's profile's. What each press
// did to the list is the page's own.

export type Asking = { kind: "remove" | "block" | "report"; post: GymPost };
type Blocked = { kind: "loading" } | { kind: "failed"; text: string } | { kind: "ok"; people: BlockedGymPostersResponse["people"] };

export const phoneZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
};

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
  /** Pressing a member's picture or name; on their own profile there is nowhere further to go. */
  onPerson?: () => void;
}

export function PostCard({ post, gymName, posted, photoUrl, files, photoRound, busy, reactError, onReact, commenting, keptComment, onComments, onAsk, onPhoto, onPerson }: PostCardProps) {
  const tag = authorTag(post);
  const hidden = hiddenOwnNote(post, gymName);
  const action = memberPostAction(post);
  const [picking, setPicking] = useState(false);
  const comments = commentButton(post.commentCount, keptComment);
  const who = (
    <>
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
    </>
  );
  return (
    <Card testID={`post-${post.id}`} style={styles.box}>
      <View style={styles.row}>
        {onPerson !== undefined && canOpenPerson(post) ? (
          <Pressable testID={`person-open-${post.id}`} accessibilityRole="button" accessibilityLabel={personLink(post)} onPress={onPerson} style={[styles.row, styles.grow]}>
            {who}
          </Pressable>
        ) : (
          who
        )}
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
export function SignedPhoto({ uri, photoId, files, round, fit, testID }: SignedPhotoProps) {
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
export function AskSheet({ asking, gymId, gymName, onClose, onRemoved, onReported, onBlocked, onGone, onPlaceGone }: AskSheetProps) {
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
export function BlockedSheet({ open, gymId, gymName, feed, onClose, onUnblocked }: { open: boolean; gymId: string; gymName: string; feed: Pick<GymPostsResponse, "blockedCount"> | null; onClose: () => void; onUnblocked: () => void }) {
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
        <Txt kind="small">You don't see their posts, comments or reactions here. They aren't told.</Txt>
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
export function PhotoViewer({ viewing, url, files, photoRound, onIndex, onClose }: PhotoViewerProps) {
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
