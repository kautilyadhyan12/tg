import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { launchImageLibraryAsync } from "expo-image-picker";
import { GYM_POST_DRAFT_MOST, GYM_POST_MAX_PHOTOS, GYM_POST_PHOTO_SEND_SIDE, gymPostResponseSchema, type GymPost } from "@app/shared";
import { Button } from "../../look/Button";
import { colours, sizes } from "../../look/colours";
import { Field } from "../../look/Field";
import { Icon } from "../../look/Icon";
import { Sheet } from "../../look/Sheet";
import { ASK_MOST } from "../../look/sizing";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { JPEG_QUALITY, fitWithin } from "../food/photo";
import { newRequestKey } from "./classesView";
import { POST_PHOTO_QUALITIES, draftFileText, hasWork, photoTrouble, postHint, postPhotoToSend, postedWords, readDraftFile, type DraftPost, type PostPhotoReading } from "./postDraft";
import { draftFolder } from "./postDraftFiles";
import { PostCamera } from "./PostCamera";
import { addOwnPath, canPost, charsLine, couldNotRead, missingThing, pressFailed } from "./updatesView";

// A member writes a post on Updates (spec Part 3 §15.2; ROADMAP Stage 5 17b): words and up to four photos, in a box from
// the bottom of the page. What they wrote is kept on the phone until the server has it, under one key, so a post sent
// again after a lost reply is one post. It is never sent by itself: a post goes up when its writer presses Post.

/** A post of four photos on a slow connection is given this long. */
const SEND_WAIT_MS = 120_000;

/** A photo drawn no longer than 1,600 px on its longest side as a JPEG, at the first quality that fits, and rebuilt
 *  by the cleaner. The first drawing turns it the way up the camera said. */
async function drawnForPost(uri: string): Promise<PostPhotoReading> {
  const upright = await ImageManipulator.manipulate(uri).renderAsync();
  const size = fitWithin(upright.width, upright.height, GYM_POST_PHOTO_SEND_SIDE);
  let last: PostPhotoReading = { ok: false, problem: "unreadable" };
  for (const quality of POST_PHOTO_QUALITIES) {
    const context = ImageManipulator.manipulate(upright);
    if (size.width !== upright.width || size.height !== upright.height) context.resize(size);
    const small = await context.renderAsync();
    const saved = await small.saveAsync({ format: SaveFormat.JPEG, compress: Math.min(quality, JPEG_QUALITY), base64: true });
    last = postPhotoToSend(saved.base64 ?? "");
    if (last.ok || last.problem !== "too_big") return last;
  }
  return last;
}

export interface KeptPost {
  /** The post kept, or null; undefined until the file is read. */
  draft: DraftPost | null | undefined;
  setBody: (body: string) => void;
  /** Puts a cleaned photo on the post: false where there is no room, or its file could not be kept. */
  addPhoto: (base64: string) => Promise<boolean>;
  removePhoto: (name: string) => void;
  photoUri: (name: string) => string;
  /** Each photo as base64, in order; null where one cannot be read. */
  readPhotos: () => Promise<string[] | null>;
  clear: () => void;
}

/** One person's unsent post at one place. Each change is written in order. */
export function useKeptPost(me: string | null, gymId: string): KeptPost {
  const [draft, setDraft] = useState<DraftPost | null | undefined>(undefined);
  const now = useRef<DraftPost | null>(null);
  const folder = useRef(me === null ? null : draftFolder(me, gymId));
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const inTurn = useCallback(<T,>(work: () => T | Promise<T>): Promise<T> => {
    const next = queue.current.then(work);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  useEffect(() => {
    const here = me === null ? null : draftFolder(me, gymId);
    folder.current = here;
    now.current = null;
    setDraft(undefined);
    if (here === null) return undefined;
    let stale = false;
    void here.read().then(
      (text) => {
        if (stale) return;
        const read = readDraftFile(text);
        // A photo whose file has gone is off the post; the rest of it stands.
        const found = read === null ? null : { ...read, photos: read.photos.filter((name) => here.hasPhoto(name)) };
        now.current = found !== null && hasWork(found) ? found : null;
        setDraft(now.current);
      },
      () => {
        if (!stale) setDraft(null);
      },
    );
    return () => {
      stale = true;
    };
  }, [me, gymId]);

  const put = useCallback(
    (next: DraftPost) => {
      const here = folder.current;
      now.current = hasWork(next) ? next : null;
      setDraft(now.current);
      if (here === null) return;
      const empty = now.current === null;
      void inTurn(() => {
        if (empty) here.clear();
        else return here.write(draftFileText(next));
        return undefined;
      }).catch(() => undefined);
    },
    [inTurn],
  );
  const current = (): DraftPost => now.current ?? { postKey: newRequestKey(), body: "", photos: [] };

  return {
    draft,
    setBody: (body) => {
      put({ ...current(), body });
    },
    addPhoto: async (base64) => {
      const here = folder.current;
      if (here === null) return false;
      const name = `${newRequestKey()}.jpg`;
      if (current().photos.length >= GYM_POST_MAX_PHOTOS) return false;
      try {
        await inTurn(() => {
          here.addPhoto(name, base64);
        });
      } catch {
        return false;
      }
      const had = current();
      if (had.photos.length >= GYM_POST_MAX_PHOTOS) return false;
      put({ ...had, photos: [...had.photos, name] });
      return true;
    },
    removePhoto: (name) => {
      const had = current();
      put({ ...had, photos: had.photos.filter((p) => p !== name) });
      const here = folder.current;
      if (here !== null) void inTurn(() => { here.removePhoto(name); }).catch(() => undefined);
    },
    photoUri: (name) => folder.current?.photoUri(name) ?? "",
    readPhotos: async () => {
      const here = folder.current;
      if (here === null) return null;
      const names = now.current?.photos ?? [];
      try {
        return await inTurn(() => Promise.all(names.map((name) => here.readPhoto(name))));
      } catch {
        return null;
      }
    },
    clear: () => {
      const here = folder.current;
      now.current = null;
      setDraft(null);
      if (here !== null) void inTurn(() => { here.clear(); }).catch(() => undefined);
    },
  };
}

interface PostBoxProps {
  open: boolean;
  gymId: string;
  gymName: string;
  kept: KeptPost;
  /** The gym lets this member post now; otherwise the post can only be read and thrown away. */
  mayPost: boolean;
  onClose: () => void;
  onPosted: (post: GymPost, note: string) => void;
  /** The gym or the person's place in it has changed: the page reads again. */
  onRefused: () => void;
}

export function PostBox({ open, gymId, gymName, kept, mayPost, onClose, onPosted, onRefused }: PostBoxProps) {
  const { session } = useSession();
  const { height } = useWindowDimensions();
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const pressed = useRef(false);

  useEffect(() => {
    if (!open) return;
    setTrouble(null);
    setRefused(null);
    setDiscarding(false);
  }, [open]);

  const draft = kept.draft ?? null;
  const body = draft?.body ?? "";
  const photos = draft?.photos ?? [];
  const chars = charsLine(body);
  const room = GYM_POST_MAX_PHOTOS - photos.length;

  const takeIn = async (uris: readonly string[]) => {
    setAdding(true);
    const fresh = uris.slice(0, room);
    let unreadable = 0;
    let tooBig = 0;
    for (const uri of fresh) {
      try {
        const read = await drawnForPost(uri);
        if (!read.ok) {
          if (read.problem === "too_big") tooBig += 1;
          else unreadable += 1;
        } else if (!(await kept.addPhoto(read.base64))) {
          unreadable += 1;
        }
      } catch {
        unreadable += 1;
      }
    }
    setAdding(false);
    setTrouble(photoTrouble({ unreadable, tooBig, left: uris.length - fresh.length }));
  };

  const fromGallery = async () => {
    setTrouble(null);
    setRefused(null);
    try {
      const picked = await launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, exif: false, allowsMultipleSelection: room > 1, selectionLimit: room });
      if (!picked.canceled) await takeIn(picked.assets.map((asset) => asset.uri));
    } catch {
      setAdding(false);
      setTrouble("Couldn't open your photos. Try again.");
    }
  };

  const send = async () => {
    if (pressed.current || draft === null) return;
    pressed.current = true;
    setSending(true);
    setRefused(null);
    setTrouble(null);
    const sentBody = draft.body;
    const pictures = await kept.readPhotos();
    if (pictures === null) {
      pressed.current = false;
      setSending(false);
      setRefused("A photo on this post couldn't be read. Take it off and try again.");
      return;
    }
    const answer = await session.signedIn(
      { method: "POST", path: addOwnPath(gymId), body: { postKey: draft.postKey, body: sentBody, photos: pictures }, waitMs: SEND_WAIT_MS },
      gymPostResponseSchema,
    );
    pressed.current = false;
    setSending(false);
    if (answer.kind === "ok") {
      kept.clear();
      onPosted(answer.data.post, postedWords(answer.data.post, { body: sentBody, photoCount: pictures.length }));
      return;
    }
    if (answer.kind === "no_answer") {
      setRefused("No connection. Your post is kept. Try again.");
      return;
    }
    const missing = missingThing(answer);
    setRefused(missing !== null ? couldNotRead(404, gymName) : pressFailed(answer.message));
    if (missing !== null || answer.status === 403) onRefused();
  };

  // Closing waits for the answer: the post's fate is said here. Its wait has an end, and it is kept meanwhile.
  const close = () => {
    if (!sending) onClose();
  };

  return (
    <Sheet open={open} title={mayPost ? "Write a post" : "Your unsent post"} onClose={close}>
      <ScrollView testID="post-box" style={{ maxHeight: height * ASK_MOST }} contentContainerStyle={styles.box} keyboardShouldPersistTaps="handled">
        <View pointerEvents={sending ? "none" : "auto"} style={styles.box}>
          <Field
            label="Your post"
            bare
            value={body}
            onChange={(next) => {
              setRefused(null);
              kept.setBody(next);
            }}
            placeholder={`Share something with ${gymName}`}
            lines={4}
            maxLength={GYM_POST_DRAFT_MOST}
          />
          <Txt kind="small" colour={chars.over ? "badText" : "textSoft"}>
            {chars.text}
          </Txt>
          {photos.length === 0 ? null : (
            <View style={styles.photos} accessibilityLabel="Photos on this post">
              {photos.map((name, i) => (
                <View key={name} style={styles.photo}>
                  <Image testID={`draft-photo-${String(i + 1)}`} source={{ uri: kept.photoUri(name) }} resizeMode="cover" style={styles.fill} accessibilityLabel={`Photo ${String(i + 1)} of ${String(photos.length)}`} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Take photo ${String(i + 1)} off this post`}
                    hitSlop={6}
                    onPress={() => {
                      setTrouble(null);
                      setRefused(null);
                      kept.removePhoto(name);
                    }}
                    style={styles.off}
                  >
                    <Icon name="x" size={14} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          {mayPost ? (
            <View style={styles.adds}>
              <Button label={adding ? "Adding…" : "Add photos"} kind="quiet" icon="image" disabled={adding || sending || room <= 0} onPress={() => void fromGallery()} />
              <Button label="Take a photo" kind="quiet" icon="camera" disabled={adding || sending || room <= 0} onPress={() => {
                  setTrouble(null);
                  setRefused(null);
                  setCamera(true);
                }} />
            </View>
          ) : null}
          {trouble === null ? null : <Txt colour="text">{trouble}</Txt>}
          {refused === null ? null : <Txt colour="badText">{refused}</Txt>}
          {mayPost ? <Txt kind="small">{postHint(gymName)}</Txt> : null}
        </View>
      </ScrollView>
      {discarding ? (
        <View style={styles.box}>
          <Txt>Discard this post? It can't be brought back.</Txt>
          <View style={styles.buttons}>
            <Button
              label="Discard post"
              kind="danger"
              small
              onPress={() => {
                kept.clear();
                onClose();
              }}
            />
            <Button
              label="Keep it"
              kind="quiet"
              onPress={() => {
                setDiscarding(false);
              }}
            />
          </View>
        </View>
      ) : (
        <View style={styles.buttons}>
          {mayPost ? <Button label="Post" busy={sending} disabled={adding || !canPost(body, photos)} onPress={() => void send()} /> : null}
          {draft !== null && hasWork(draft) ? (
            <Button
              label="Discard"
              kind="quiet"
              disabled={sending || adding}
              onPress={() => {
                setDiscarding(true);
              }}
            />
          ) : null}
        </View>
      )}
      <PostCamera
        open={camera}
        onPhoto={(uri) => {
          setCamera(false);
          void takeIn([uri]);
        }}
        onClose={() => {
          setCamera(false);
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  box: { gap: 12 },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  photo: { width: "23.5%", aspectRatio: 1, borderRadius: 12, overflow: "hidden", backgroundColor: colours.fill },
  fill: { width: "100%", height: "100%" },
  off: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: sizes.round,
    backgroundColor: colours.scrim,
    alignItems: "center",
    justifyContent: "center",
  },
  adds: { flexDirection: "row", flexWrap: "wrap", columnGap: 16 },
  buttons: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", columnGap: 20, rowGap: 8 },
});
