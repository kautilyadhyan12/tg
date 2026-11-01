import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Modal } from "../../look/Modal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { launchImageLibraryAsync } from "expo-image-picker";
import {
  FOOD_ALLERGY_CAUTION,
  MEAL_MOST_FOODS,
  PHOTO_PRIVACY_LINE,
  barcodeReplySchema,
  labelDraftSchema,
  labelFoodsSchema,
  photoScansLeftSchema,
  type LabelDraft,
  type PhotoScansLeft,
  PHOTO_SCAN_CAUTION,
  foodSearchResponseSchema,
  mealPhotoAnalysisSchema,
  mealPreviewSchema,
  type FoodSearchItem,
  type MealItem,
  type MealPreview,
  type MealType,
  type OwnFoodItem,
  type PhotoSheetPick,
} from "@app/shared";
import { Button } from "../../look/Button";
import { Chip } from "../../look/Chip";
import { colours, orangeGradient, pictureFade, shadows, sizes } from "../../look/colours";
import { Field } from "../../look/Field";
import { Icon } from "../../look/Icon";
import { pictures } from "../../look/pictures";
import { Sheet } from "../../look/Sheet";
import { pictureTopHeight } from "../../look/sizing";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { NOT_KNOWN } from "../dashboard/words";
import { newGoalId } from "../goals/words";
import { AmountPicker, useDishes } from "./AmountPicker";
import { MEAL_TYPES, kcalWords } from "./day";
import { useMealOutbox } from "./MealOutbox";
import { amountRefusal, loggedAmount, startWords, startingAmount } from "./measures";
import { typedAmount } from "./rows";
import {
  JPEG_QUALITY,
  fitWithin,
  newSheet,
  onSheet,
  photoToSend,
  saveWords,
  scanTrouble,
  sheetItems,
  sheetNumbers,
  sheetRows,
  totalsWords,
  withExtra,
  withRowAmount,
  withRowFood,
  withWholeDish,
  withoutWholeDish,
  withSharesAsGrams,
  rowNeeds,
  type PhotoSheet,
  type SheetRow,
} from "./photo";
import type { KeptSheet } from "./PhotoSheetStore";
import { sharedDish } from "./dishShares";
import { OwnFood } from "./OwnFood";
import { WholeDish } from "./WholeDish";
import { BarcodeOwnFood, BarcodeProduct, TypeBarcode } from "./BarcodeProduct";
import { NO_READS, PACK_CODES, afterRead, codeFromCamera, troubleWords, type FoundProduct } from "./barcode";
import { removeCachedPhoto } from "./fileStore";
import { LabelCheck } from "./LabelCheck";
import { canReadLabel, labelCostWords, scansLeftWords, typedFromDraft } from "./labelRead";
import { Credits, SourceLine } from "./SourceLine";

// Log a meal from a photo (ROADMAP Stage 5 33b-i). The live camera opens at once, as food apps open
// it; a photo taken before is picked from the gallery in the corner. The photo is made small and
// rebuilt on the phone before it is sent (`photo.ts`), the scan's foods are reviewed, changed or taken
// off, a food it missed is added, and Save keeps the meal on the phone until the server has it.

/** A scan takes the server up to about fifty seconds: the photo, then the check of unclear foods. */
const SCAN_WAIT_MS = 75_000;
const NO_CONNECTION = "No connection. Try again.";
/** While the foods' weights cannot be fetched: asked again this often, for at most 15 minutes. */
const PRICE_RETRY_MS = 30_000;
const PRICE_RETRIES_MOST = 30;
const PRICE_LOST = "Can’t reach the server. The foods’ weights will show when you’re back online.";
const PRICE_LOST_STOPPED = "Can’t reach the server.";
const PRICE_REFUSED = "This meal’s calories can’t be worked out. Change a food, or take a new photo.";
const SCAN_GONE = "This photo’s scan has run out, so this meal can’t be saved. Take a new photo.";
/** The photo's band over the review, as tall as a page's own picture is for the phone's shape. */
const PHOTO_TALL = 0.78;
const UNREADABLE = "That photo couldn’t be read. Try another one.";

type CameraMode = "meal" | "barcode" | "label";
type Stage =
  | { kind: "camera" }
  | { kind: "reading"; uri: string; what: "meal" | "label" }
  | { kind: "review" }
  /** A label read and not yet saved: kept if the scanner is closed, as it has used a scan. */
  | { kind: "label"; draft: LabelDraft; code: string | null }
  /** A label saved: never kept, as a read that reopened could be saved over its barcode. */
  | { kind: "labelSaved"; product: FoundProduct };
type Ask = "none" | "newPhoto";

interface MealPhotoProps {
  open: boolean;
  /** Opened at the barcode scan, whatever photo meal is kept. */
  barcode: boolean;
  kept: KeptSheet;
  onClose: () => void;
  onSaved: (type: MealType, name: string) => void;
  /** No scans left: the food search for the meal the time of day says, instead. */
  onSearch: () => void;
}

/** A photo, drawn again no longer than 768 px on its longest side as a JPEG: the camera's own tags
 *  stay on the phone. The first drawing turns it the way up the camera said. */
async function drawnSmall(uri: string): Promise<string | null> {
  const upright = await ImageManipulator.manipulate(uri).renderAsync();
  const size = fitWithin(upright.width, upright.height);
  const context = ImageManipulator.manipulate(upright);
  if (size.width !== upright.width || size.height !== upright.height) context.resize(size);
  const small = await context.renderAsync();
  const saved = await small.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY, base64: true });
  removeCachedPhoto(saved.uri);
  return saved.base64 ?? null;
}

export function MealPhoto({ open, barcode, kept, onClose, onSaved, onSearch }: MealPhotoProps) {
  const { session, state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const [stage, setStage] = useState<Stage>({ kind: "camera" });
  const [notice, setNotice] = useState<{ words: string; search: boolean } | null>(null);
  // A free try the server gave for a photo it could not read, or for a scan its scanner failed.
  const retake = useRef<string | null>(null);
  const sheet = kept.sheet ?? null;
  // What the camera comes back to after a label photo, and the barcode that photo is for.
  const [cameraStart, setCameraStart] = useState<{ mode: CameraMode; code: string | null } | null>(null);

  // Each opening starts clean, decided while drawing, before the camera takes its start: with a photo
  // meal kept, its review; else the camera on Meal, or on Barcode where that was asked for, holding no
  // barcode. Only a read under way, or a read that has used a scan and is not yet saved, is kept.
  const [wasOpen, setWasOpen] = useState(false);
  // On a phone, a box opened in the same moment as the scanner under it is never drawn: the page stays
  // black, on every opening, until the app is closed. So a kept read waits for the scanner to show.
  const [waitingToShow, setWaitingToShow] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setNotice(null);
      setWaitingToShow(stage.kind === "reading" || stage.kind === "label");
      if (stage.kind !== "reading" && stage.kind !== "label") {
        setCameraStart(null);
        setStage(!barcode && kept.sheet !== null && kept.sheet !== undefined ? { kind: "review" } : { kind: "camera" });
      }
    }
  }

  // Somebody else signed in: nothing of another person's label stays.
  useEffect(() => {
    setStage((now) => (now.kind === "label" || now.kind === "labelSaved" ? { kind: "camera" } : now));
    setCameraStart(null);
  }, [me]);

  /** The one way out of a label, however it is left: the camera holds no barcode after it, so the next
   *  photo, which may be any pack's, can never be saved over this one. */
  const endLabel = () => {
    setCameraStart({ mode: "label", code: null });
    setStage({ kind: "camera" });
  };

  const scan = useCallback(
    async (uri: string) => {
      setNotice(null);
      setStage({ kind: "reading", uri, what: "meal" });
      let drawn: string | null = null;
      try {
        drawn = await drawnSmall(uri);
      } catch {
        drawn = null;
      }
      const sending = drawn === null ? null : photoToSend(drawn);
      if (sending === null) {
        setNotice({ words: UNREADABLE, search: false });
        setStage({ kind: "camera" });
        return;
      }
      const token = retake.current;
      const answer = await session.signedIn(
        {
          method: "POST",
          path: "/v1/nutrition/analyze-photo",
          body: { imageBase64: sending, mimeType: "image/jpeg", ...(token === null ? {} : { retakeToken: token }) },
          waitMs: SCAN_WAIT_MS,
        },
        mealPhotoAnalysisSchema,
      );
      // Somebody else signed in while it was read: nothing of it is kept for them.
      const now = session.state();
      if (now.kind !== "in" || now.user.id !== me) return;
      if (answer.kind === "ok") {
        retake.current = null;
        kept.keep(newSheet(answer.data, new Date(), sending));
        setStage({ kind: "review" });
        return;
      }
      const trouble = scanTrouble(answer, new Date());
      if (trouble.retake === "clear") retake.current = null;
      else if (trouble.retake !== "keep") retake.current = trouble.retake.token;
      setNotice({ words: trouble.words, search: trouble.search });
      setStage({ kind: "camera" });
    },
    [session, me, kept],
  );

  const scanLabel = useCallback(
    async (uri: string, code: string | null) => {
      setNotice(null);
      setCameraStart({ mode: "label", code });
      setStage({ kind: "reading", uri, what: "label" });
      let drawn: string | null = null;
      try {
        drawn = await drawnSmall(uri);
      } catch {
        drawn = null;
      }
      const sending = drawn === null ? null : photoToSend(drawn);
      if (sending === null) {
        setNotice({ words: UNREADABLE, search: false });
        setStage({ kind: "camera" });
        return;
      }
      const token = retake.current;
      const answer = await session.signedIn(
        {
          method: "POST",
          path: "/v1/nutrition/labels/read",
          body: { imageBase64: sending, mimeType: "image/jpeg", ...(token === null ? {} : { retakeToken: token }) },
          waitMs: SCAN_WAIT_MS,
        },
        labelDraftSchema,
      );
      // Somebody else signed in while it was read: nothing of it is kept for them.
      const now = session.state();
      if (now.kind !== "in" || now.user.id !== me) return;
      if (answer.kind === "ok") {
        retake.current = null;
        setStage({ kind: "label", draft: answer.data, code });
        return;
      }
      const trouble = scanTrouble(answer, new Date());
      if (trouble.retake === "clear") retake.current = null;
      else if (trouble.retake !== "keep") retake.current = trouble.retake.token;
      setNotice({ words: trouble.words, search: trouble.search });
      setStage({ kind: "camera" });
    },
    [session, me],
  );

  if (!open) return null;
  return (
    <Modal visible animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose} onShow={() => { setWaitingToShow(false); }}>
      <View style={styles.page} testID="meal-photo">
        {stage.kind === "camera" ? (
          <Camera
            startMode={cameraStart?.mode ?? (barcode ? "barcode" : "meal")}
            startCode={cameraStart?.code ?? null}
            onLabelPhoto={(uri, code) => {
              void scanLabel(uri, code).finally(() => { removeCachedPhoto(uri); });
            }}
            onMealMode={() => {
              // A photo meal already kept is what Meal means: it is never thrown away for a new photo.
              setCameraStart(null);
              if (sheet !== null) setStage({ kind: "review" });
            }}
            onSaved={onSaved}
            notice={notice}
            onPhoto={(uri) => {
              void scan(uri).finally(() => { removeCachedPhoto(uri); });
            }}
            onClose={onClose}
            onSearch={onSearch}
          />
        ) : stage.kind === "reading" ? (
          <Reading uri={stage.uri} what={stage.what} onClose={onClose} />
        ) : stage.kind === "label" && waitingToShow ? (
          <View style={styles.page} />
        ) : stage.kind === "label" ? (
          <LabelCheck
            start={typedFromDraft(stage.draft)}
            code={stage.code}
            id={null}
            check={stage.draft.check}
            fromKj={stage.draft.kcalFromKj}
            onClose={endLabel}
            onSaved={(product) => {
              setStage({ kind: "labelSaved", product });
            }}
          />
        ) : stage.kind === "labelSaved" ? (
          <BarcodeProduct
            product={stage.product}
            onClose={endLabel}
            onSaved={(type, name) => {
              endLabel();
              onSaved(type, name);
            }}
          />
        ) : sheet === null ? null : (
          <Review
            sheet={sheet}
            keep={kept.keep}
            onClose={onClose}
            onNewPhoto={() => {
              kept.forget();
              setNotice(null);
              setStage({ kind: "camera" });
            }}
            onSaved={(type, name) => {
              kept.forget();
              onSaved(type, name);
            }}
          />
        )}
      </View>
    </Modal>
  );
}

/** A round button over the camera or the photo: close, the gallery. */
function Round({ icon, say, onPress, big = false, on = false }: { icon: "x" | "image" | "zap"; say: string; onPress: () => void; big?: boolean; on?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={say}
      onPress={onPress}
      style={({ pressed }) => [styles.round, big ? styles.roundBig : null, pressed ? styles.pressed : null]}
    >
      <Icon name={icon} size={big ? 22 : 20} colour={on ? "orange" : "text"} />
    </Pressable>
  );
}

type Look = { kind: "idle" } | { kind: "looking" } | { kind: "found"; product: FoundProduct } | { kind: "trouble"; words: string; notListed: boolean; lost: string | null; code: string | null };

/** The live camera, filling the screen. Meal: the shutter in the middle at the foot, the gallery beside
 *  it. Barcode (33b-iii-b): a pack in view opens by itself; free, and uses none of a person's scans. */
function Camera({
  startMode,
  startCode,
  onLabelPhoto,
  onMealMode,
  onSaved,
  notice,
  onPhoto,
  onClose,
  onSearch,
}: {
  startMode: CameraMode;
  startCode: string | null;
  onLabelPhoto: (uri: string, code: string | null) => void;
  onMealMode: () => void;
  onSaved: (type: MealType, name: string) => void;
  notice: { words: string; search: boolean } | null;
  onPhoto: (uri: string) => void;
  onClose: () => void;
  onSearch: () => void;
}) {
  const { session, state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const [mode, setMode] = useState<CameraMode>(startMode);
  // The barcode a label photo is for: the pack just found not to be on our list.
  const [labelCode, setLabelCode] = useState<string | null>(startCode);
  const [scans, setScans] = useState<PhotoScansLeft | null>(null);
  const [saved, setSaved] = useState<{ items: FoundProduct[] | null; failed: boolean } | null>(null);
  const [torch, setTorch] = useState(false);
  const [look, setLook] = useState<Look>({ kind: "idle" });
  const [typing, setTyping] = useState(false);
  const [own, setOwn] = useState(false);
  const reads = useRef(NO_READS);
  // The newest lookup: an answer to any earlier one was left behind, and is dropped.
  const newest = useRef(0);
  // A box closed with the pack still in view does not open again by itself.
  const packStillInView = () => { reads.current = { ...reads.current, lookedSeen: Date.now() }; };
  const insets = useSafeAreaInsets();
  const [permission, ask] = useCameraPermissions();
  const camera = useRef<CameraView | null>(null);
  const [ready, setReady] = useState(false);
  const [taking, setTaking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const asked = useRef(false);

  // The phone's own question, once, the first time the camera opens.
  useEffect(() => {
    if (permission === null || permission.granted || !permission.canAskAgain || asked.current) return;
    asked.current = true;
    void ask();
  }, [permission, ask]);

  // How many photo scans are left, each time the camera opens; never a reason to hold anything up.
  useEffect(() => {
    let gone = false;
    void session.signedIn({ method: "GET", path: "/v1/nutrition/photo-scans" }, photoScansLeftSchema).then((answer) => {
      if (!gone && answer.kind === "ok") setScans(answer.data);
    });
    return () => {
      gone = true;
    };
  }, [session]);

  const openSaved = async () => {
    setSaved({ items: null, failed: false });
    const answer = await session.signedIn({ method: "GET", path: "/v1/nutrition/labels" }, labelFoodsSchema);
    setSaved(answer.kind === "ok" ? { items: answer.data.items.flatMap((p) => (p.status === "found" ? [p] : [])), failed: false } : { items: [], failed: true });
  };

  const lookUp = async (code: string) => {
    newest.current += 1;
    const mine = newest.current;
    setLook({ kind: "looking" });
    const answer = await session.signedIn({ method: "GET", path: `/v1/nutrition/barcode/${code}` }, barcodeReplySchema);
    if (mine !== newest.current) return;
    // Somebody else signed in while it was asked: nothing of it is shown to them.
    const now = session.state();
    if (now.kind !== "in" || now.user.id !== me) return;
    if (answer.kind !== "ok") {
      setLook({ kind: "trouble", words: answer.kind === "refused" ? answer.message : NO_CONNECTION, notListed: false, lost: answer.kind === "refused" ? null : code, code: null });
      return;
    }
    const reply = answer.data;
    if (reply.status === "found") {
      setTyping(false);
      setLook({ kind: "found", product: reply });
      return;
    }
    const notListed = reply.status === "not_found";
    if (notListed) setTyping(false);
    setLook({ kind: "trouble", words: troubleWords(reply), notListed, lost: null, code: reply.status === "not_found" ? reply.code : null });
  };
  const scanned = ({ type, data }: { type: string; data: string }) => {
    const code = codeFromCamera(type, data);
    if (code === null || typing || own || look.kind === "looking" || look.kind === "found") return;
    const next = afterRead(reads.current, code, Date.now());
    reads.current = next.memory;
    if (next.look) void lookUp(code);
  };
  const toMode = (next: CameraMode, code: string | null = null) => {
    newest.current += 1;
    setLabelCode(code);
    setMode(next);
    setFailed(null);
    setLook({ kind: "idle" });
    reads.current = NO_READS;
    if (next === "meal") onMealMode();
  };

  const take = async () => {
    const lens = camera.current;
    if (lens === null || !ready || taking) return;
    setTaking(true);
    setFailed(null);
    try {
      const picture = await lens.takePictureAsync({ quality: 0.9, exif: false });
      if (mode === "label") onLabelPhoto(picture.uri, labelCode);
      else onPhoto(picture.uri);
    } catch {
      setFailed("Couldn’t take the photo. Try again.");
    } finally {
      setTaking(false);
    }
  };
  const gallery = async () => {
    setFailed(null);
    try {
      const picked = await launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, exif: false });
      const first = picked.canceled ? undefined : picked.assets[0];
      if (first !== undefined && mode === "label") onLabelPhoto(first.uri, labelCode);
      else if (first !== undefined) onPhoto(first.uri);
    } catch {
      setFailed("Couldn’t open your photos. Try again.");
    }
  };

  const scanning = mode === "barcode";
  const trouble = scanning && look.kind === "trouble" ? look : null;
  const words = failed ?? (scanning ? (typing ? null : (trouble?.words ?? null)) : (notice?.words ?? null));
  const left = scanning ? "Barcode scans are free." : scansLeftWords(scans);
  const allowed = permission?.granted === true;
  return (
    <View style={styles.page}>
      {allowed ? (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          {...(scanning ? { barcodeScannerSettings: { barcodeTypes: [...PACK_CODES] }, onBarcodeScanned: scanned } : {})}
          onCameraReady={() => { setReady(true); }}
          onMountError={() => { setFailed("The camera couldn’t start. Choose a photo instead."); }}
        />
      ) : (
        <View style={[styles.allow, { paddingTop: insets.top + 80 }]}>
          <View style={styles.allowMark}>
            <Icon name="camera" size={34} colour="orange" />
          </View>
          <Txt kind="h2" style={styles.centre}>
            Allow the camera
          </Txt>
          <Txt kind="small" style={styles.centre}>
            {scanning ? "To scan your food’s barcode." : mode === "label" ? "To take a photo of your food’s label." : "To take a photo of your meal."}
          </Txt>
          {permission === null ? null : (
            <Button
              label={permission.canAskAgain ? "Allow camera" : "Open settings"}
              onPress={() => {
                if (permission.canAskAgain) void ask();
                else void Linking.openSettings();
              }}
              style={styles.centreSelf}
            />
          )}
        </View>
      )}
      <View style={[styles.topBar, { top: insets.top + 12 }]}>
        <Round icon="x" say="Close" onPress={onClose} />
      </View>
      {allowed ? (
        <View style={[styles.torchBar, { top: insets.top + 12 }]}>
          <Round icon="zap" say={torch ? "Turn torch off" : "Turn torch on"} on={torch} onPress={() => { setTorch((t) => !t); }} />
        </View>
      ) : null}
      {scanning && allowed ? (
        <View style={styles.guideWrap} pointerEvents="none">
          <View style={styles.guide} />
          {look.kind === "looking" ? <ActivityIndicator size="large" color={colours.orange} /> : null}
        </View>
      ) : null}
      <View style={[styles.footBar, { paddingBottom: insets.bottom + 28 }]}>
        {words === null ? null : (
          <View style={styles.notice} accessibilityLiveRegion="polite">
            <Txt kind="small" colour="text" style={styles.centre}>
              {words}
            </Txt>
            {!scanning && notice?.search === true && failed === null ? <Button label="Search food instead" kind="link" onPress={onSearch} style={styles.centreSelf} /> : null}
            {trouble?.lost != null ? <Button label="Try again" kind="link" onPress={() => { void lookUp(trouble.lost ?? ""); }} style={styles.centreSelf} /> : null}
            {trouble?.notListed === true ? (
              <>
                {canReadLabel(scans) ? (
                  <>
                    <Button label="Photo of the label" onPress={() => { toMode("label", trouble.code); }} style={styles.centreSelf} />
                    <Txt kind="tiny" style={styles.centre}>
                      {labelCostWords(scans)}
                    </Txt>
                  </>
                ) : (
                  <Txt kind="small" colour="gold" style={styles.centre}>
                    {scansLeftWords(scans)}
                  </Txt>
                )}
                <Button label="Search food" kind="link" onPress={onSearch} style={styles.centreSelf} />
                <Button label="Add your own numbers" kind="link" onPress={() => { setOwn(true); }} style={styles.centreSelf} />
              </>
            ) : null}
          </View>
        )}
        {mode === "label" && labelCode !== null ? (
          <Txt kind="tiny" colour="text" style={styles.centre}>
            For barcode {labelCode}
          </Txt>
        ) : null}
        {left === null ? null : (
          <Txt kind="tiny" colour="text" style={styles.centre}>
            {left}
          </Txt>
        )}
        <View style={styles.modes} accessibilityRole="radiogroup">
          <Chip label="Meal" on={mode === "meal"} onPress={() => { toMode("meal"); }} />
          <Chip label="Barcode" on={scanning} onPress={() => { toMode("barcode"); }} />
          <Chip label="Label" on={mode === "label"} onPress={() => { toMode("label"); }} />
        </View>
        {mode === "label" ? <Button label="Your saved labels" kind="link" onPress={() => { void openSaved(); }} style={styles.centreSelf} /> : null}
        {scanning ? null : (
          <Txt kind="tiny" style={styles.centre}>
            {PHOTO_PRIVACY_LINE}
          </Txt>
        )}
        {scanning ? (
          <Button label="Type the number" kind="link" onPress={() => { newest.current += 1; setLook({ kind: "idle" }); setTyping(true); }} style={styles.centreSelf} />
        ) : (
        <View style={styles.shutterRow}>
          <Round icon="image" say="Choose from gallery" onPress={() => { void gallery(); }} big />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            accessibilityState={{ disabled: !allowed || !ready || taking }}
            disabled={!allowed || !ready || taking}
            onPress={() => { void take(); }}
            style={({ pressed }) => [styles.shutter, !allowed || !ready ? styles.dim : null, pressed ? styles.shutterPressed : null]}
          >
            <View style={styles.shutterInner} />
          </Pressable>
          <View style={styles.roundBig} />
        </View>
        )}
      </View>
      {saved === null ? null : (
        <Sheet open title="Your saved labels" onClose={() => { setSaved(null); }}>
          {saved.items === null ? <ActivityIndicator color={colours.orange} /> : null}
          {saved.failed ? (
            <>
              <Txt kind="small" colour="badText">
                {NO_CONNECTION}
              </Txt>
              <Button label="Try again" kind="link" onPress={() => { void openSaved(); }} />
            </>
          ) : saved.items?.length === 0 ? (
            <Txt kind="small" colour="text">
              No saved labels yet.
            </Txt>
          ) : null}
          <ScrollView style={styles.savedList} keyboardShouldPersistTaps="handled">
            {(saved.items ?? []).map((product) => (
              <Button
                key={product.labelId}
                label={`${product.food.name} · ${kcalWords(product.food.startsKcal)}`}
                kind="link"
                onPress={() => {
                  setSaved(null);
                  setLook({ kind: "found", product });
                }}
              />
            ))}
          </ScrollView>
        </Sheet>
      )}
      {look.kind === "found" ? <BarcodeProduct product={look.product} onClose={() => { packStillInView(); setLook({ kind: "idle" }); }} onSaved={onSaved} /> : null}
      {own ? <BarcodeOwnFood onClose={() => { packStillInView(); setOwn(false); }} onSaved={onSaved} /> : null}
      {typing ? (
        <TypeBarcode
          busy={look.kind === "looking"}
          said={trouble?.words ?? null}
          onLook={(code) => { void lookUp(code); }}
          onClose={() => {
            newest.current += 1;
            packStillInView();
            setTyping(false);
            setLook({ kind: "idle" });
          }}
        />
      ) : null}
    </View>
  );
}

/** The photo, while the server reads it. */
function Reading({ uri, what, onClose }: { uri: string; what: "meal" | "label"; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.page}>
      <Image source={{ uri }} resizeMode="cover" style={StyleSheet.absoluteFill} accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.veil]} />
      <View style={styles.readingWords}>
        <ActivityIndicator size="large" color={colours.orange} />
        <Txt kind="h3">{what === "label" ? "Reading the label…" : "Reading your meal…"}</Txt>
      </View>
      <View style={[styles.topBar, { top: insets.top + 12 }]}>
        <Round icon="x" say="Close" onPress={onClose} />
      </View>
    </View>
  );
}

type Priced = { kind: "none" } | { kind: "lost"; for: string } | { kind: "ok"; preview: MealPreview; for: string } | { kind: "refused"; words: string; for: string };

/** The scan's foods: each at its amount, changed in the amount box or taken off; a food the photo
 *  missed added; the meal it was; and Save. Every number is the server's. */
function Review({
  sheet,
  keep,
  onClose,
  onNewPhoto,
  onSaved,
}: {
  sheet: PhotoSheet;
  keep: (sheet: PhotoSheet) => void;
  onClose: () => void;
  onNewPhoto: () => void;
  onSaved: (type: MealType, name: string) => void;
}) {
  const { session } = useSession();
  const { outbox } = useMealOutbox();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [priced, setPriced] = useState<Priced>({ kind: "none" });
  const [priceTry, setPriceTry] = useState(0);
  const priceTriesFrom = useRef(0);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [finding, setFinding] = useState<{ query: string; change: string | null } | null>(null);
  const [ask, setAsk] = useState<Ask>("none");
  const [said, setSaid] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);

  const rows = sheetRows(sheet);
  const items = sheetItems(sheet);
  const key = items === null ? "" : JSON.stringify(items);
  const scanToken = sheet.analysis.scanToken;

  // The server's numbers for the meal as it stands, a moment after it changes.
  useEffect(() => {
    if (items === null) {
      setPriced({ kind: "none" });
      return undefined;
    }
    let stale = false;
    let again: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      void session.signedIn({ method: "POST", path: "/v1/nutrition/meals/preview", body: { items, scanToken } }, mealPreviewSchema).then((answer) => {
        if (stale) return;
        if (answer.kind === "ok") setPriced({ kind: "ok", preview: answer.data, for: key });
        // The server no longer holds the scan (kept a day): it can only be taken again.
        else if (answer.kind === "refused" && answer.error === "invalid_scan") setPriced({ kind: "refused", words: SCAN_GONE, for: key });
        else if (answer.kind === "refused" && amountRefusal(answer.error) !== null) setPriced({ kind: "refused", words: amountRefusal(answer.error) ?? "", for: key });
        else {
          // The server answered, and will answer the same: asking again would never help.
          if (answer.kind === "refused" && answer.status < 500) {
            setPriced({ kind: "refused", words: PRICE_REFUSED, for: key });
            return;
          }
          // Never a wait with no end: it says so and asks again until the signal is back.
          setPriced({ kind: "lost", for: key });
          if (priceTry - priceTriesFrom.current < PRICE_RETRIES_MOST) again = setTimeout(() => { setPriceTry((n) => n + 1); }, PRICE_RETRY_MS);
        }
      });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
      if (again !== undefined) clearTimeout(again);
    };
    // `key` is the whole of `items`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scanToken, session, priceTry]);

  const priceLost = priced.kind === "lost" && priced.for === key;
  const preview = priced.kind === "ok" && priced.for === key ? priced.preview : null;
  const refusedWords = priced.kind === "refused" && priced.for === key ? priced.words : null;
  const numbers = sheetNumbers(sheet, preview);
  const held = items === null || refusedWords !== null || outbox === null || saving;
  const name = sheet.analysis.mealName.trim() === "" ? "Meal" : sheet.analysis.mealName.trim().slice(0, 200);

  const save = async () => {
    if (items === null || refusedWords !== null || savingNow.current || outbox === null) return;
    savingNow.current = true;
    setSaving(true);
    const id = newGoalId();
    const added = await outbox.add({
      id,
      body: { id, mealName: name, takenAt: new Date().toISOString(), mealType: sheet.mealType, items },
      items: numbers?.items ?? null,
      totals: numbers?.totals ?? null,
      tried: false,
      scanToken,
    });
    savingNow.current = false;
    setSaving(false);
    if (added) onSaved(sheet.mealType, name);
    else setFull(true);
  };

  const row = rows.find((r) => r.key === openRow) ?? null;
  const rowAt = row === null ? -1 : rows.indexOf(row);
  // The first food left without an amount: it holds the whole meal's numbers and its save.
  const unfinished = rows.find((r) => rowNeeds(r) !== null);
  // What each food weighs now, by row, as the server last priced it.
  const rowGrams = rows.map((_, i) => numbers?.items[i]?.gramsPoint ?? null);
  // Before one food that is a part of one dish changes, the others are put back at their grams.
  // While a part's weight is still being worked out (or the phone has no signal), the change waits and
  // says so: falling back to the shares would refill the dish with the others (re-check, N1).
  const loosened = (): PhotoSheet | null => {
    const next = withSharesAsGrams(sheet, rowGrams);
    if (next === null) setSaid("Wait a moment: the foods’ weights are still being worked out.");
    return next;
  };
  const change = (make: (base: PhotoSheet) => PhotoSheet): boolean => {
    const base = loosened();
    if (base === null) return false;
    keep(make(base));
    return true;
  };
  // The row the search changes, and what it weighs now: the food picked in its place starts there.
  const changing = finding?.change == null ? null : (rows.find((r) => r.key === finding.change) ?? null);
  const changingGrams = changing === null ? null : (numbers?.items[rows.indexOf(changing)]?.gramsPoint ?? null);
  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.reviewList} keyboardShouldPersistTaps="handled">
        <View style={[styles.band, { height: pictureTopHeight(width, height, PHOTO_TALL) }]}>
          {/* The picture alone is cut to the band, as a page's own picture is (look/PictureTop). */}
          <View style={[StyleSheet.absoluteFill, styles.band]}>
            <Image
              source={sheet.photo === undefined ? pictures.food : { uri: `data:image/jpeg;base64,${sheet.photo}` }}
              resizeMode="cover"
              style={styles.bandPicture}
              testID="meal-picture"
              accessible={false}
            />
          </View>
          <View style={[StyleSheet.absoluteFill, styles.fade]} />
          <View style={styles.photoWords}>
            <Txt kind="eyebrow">From your photo</Txt>
            <Txt kind="h1">{name}</Txt>
          </View>
          {/* Part of the photo, so it scrolls away with it and never lies over the meal's words. */}
          <View style={[styles.topBar, { top: insets.top + 12 }]}>
            <Round icon="x" say="Close" onPress={onClose} />
          </View>
        </View>
        <View style={styles.reviewBody}>
          <Txt kind="small" colour="gold">
            {PHOTO_SCAN_CAUTION}
          </Txt>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {MEAL_TYPES.map((m) => (
              <Chip key={m.type} label={m.name} on={sheet.mealType === m.type} onPress={() => { keep({ ...sheet, mealType: m.type }); }} />
            ))}
          </View>
          {said === null ? null : (
            <View style={styles.saidRow}>
              <Icon name="check" size={14} colour="goodText" />
              <Txt kind="small" colour="goodText">
                {said}
              </Txt>
            </View>
          )}
          <View>
            {rows.map((r, i) => (
              <FoodRow
                key={r.key}
                row={r}
                item={numbers?.items[i] ?? null}
                onPress={() => {
                  setSaid(null);
                  setOpenRow(r.key);
                }}
              />
            ))}
            {rows.length === 0 ? <Txt kind="small">No food left on this meal. Add one to save it.</Txt> : null}
          </View>
          {sheet.analysis.unknownItems.length === 0 ? null : (
            <View style={styles.unknown}>
              <Txt kind="tiny" style={styles.label}>
                Not in the total
              </Txt>
              {sheet.analysis.unknownItems.map((u) => (
                <View key={u} style={styles.unknownRow}>
                  <Txt kind="small" style={styles.grow}>
                    {u}
                  </Txt>
                  {rows.length >= MEAL_MOST_FOODS ? null : <Button label="Add" kind="link" say={`Add ${u}`} onPress={() => { setSaid(null); setFinding({ query: u, change: null }); }} />}
                </View>
              ))}
            </View>
          )}
          {rows.length >= MEAL_MOST_FOODS ? (
            <Txt kind="small">A meal holds up to {String(MEAL_MOST_FOODS)} foods.</Txt>
          ) : (
            <Button label="Add a food it missed" icon="plus" kind="soft" small onPress={() => { setSaid(null); setFinding({ query: "", change: null }); }} />
          )}
          {rows.some((r) => r.own === null) ? (
            <WholeDish
              applied={sharedDish(rows.filter((r) => r.own === null).map((r) => r.amount))}
              held={
                unfinished !== undefined
                  ? `${unfinished.title} needs an amount first.`
                  : rowGrams.some((g, i) => g === null && rows[i]?.own === null)
                    ? priceLost
                      ? "The foods’ weights haven’t come yet."
                      : "Working out the foods’ weights…"
                    : null
              }
              onUse={({ dish, fill }) => {
                const next = withWholeDish(sheet, dish.id, fill.value, rowGrams);
                if (next === null) return;
                keep(next);
                setSaid(`Shared out over ${dish.label}, ${fill.words}.`);
              }}
              onDishChanged={() => { setPriceTry((n) => n + 1); }}
              onClear={() => {
                const next = withoutWholeDish(sheet, rowGrams);
                if (next === null) {
                  setSaid("Wait a moment: the foods’ weights are still being worked out.");
                  return false;
                }
                keep(next);
                setSaid("Back to the amounts the photo saw.");
                return true;
              }}
            />
          ) : null}
          <Credits sources={new Set(rows.map((r) => r.source))} />
        </View>
      </ScrollView>
      <View style={[styles.reviewFoot, { paddingBottom: insets.bottom + 14 }]}>
        {numbers === null ? null : (
          <Txt kind="small" colour="text">
            {totalsWords(numbers.totals)}
          </Txt>
        )}
        {unfinished === undefined ? null : (
          <Txt kind="small" colour="badText">
            {unfinished.title}: {rowNeeds(unfinished) === "fill" ? "pick how full the dish was" : "pick an amount"}. Tap it to finish, then save.
          </Txt>
        )}
        {refusedWords === null ? null : (
          <Txt kind="small" colour="badText">
            {refusedWords}
          </Txt>
        )}
        {priceLost && rowGrams.some((g, i) => g === null && rows[i]?.own === null) ? (
          <>
            <Txt kind="small" colour="gold">
              {priceTry - priceTriesFrom.current < PRICE_RETRIES_MOST ? PRICE_LOST : PRICE_LOST_STOPPED}
            </Txt>
            <Button
              label="Try again"
              kind="link"
              onPress={() => {
                priceTriesFrom.current = priceTry + 1;
                setPriceTry((n) => n + 1);
              }}
            />
          </>
        ) : null}
        {full ? (
          <Txt kind="small" colour="badText">
            Too many meals are waiting to be sent. Go online to send them, then save this one.
          </Txt>
        ) : null}
        <View style={styles.footRow}>
          <Button label="New photo" kind="link" onPress={() => { setAsk("newPhoto"); }} />
          <Button label={saveWords(sheet.mealType)} disabled={held} onPress={() => { void save(); }} style={styles.grow} />
        </View>
      </View>
      {row === null ? null : (
        <Sheet open title={row.title} onClose={() => { setOpenRow(null); }}>
          <RowAmount
            row={row}
            waiting={rows.some((r, i) => r.amount.share !== undefined && rowGrams[i] === null)}
            onDishChanged={() => { setPriceTry((n) => n + 1); }}
            grams={numbers?.items[rowAt]?.gramsPoint ?? null}
            kcal={numbers?.items[rowAt]?.kcalPoint ?? null}
            onAmount={(amount) => { change((base) => withRowAmount(base, row.key, amount)); }}
            onOwn={(own) => {
              if (!change((base) => withRowFood(base, row.key, { own }))) return;
              setOpenRow(null);
              setSaid(`${own.name} updated.`);
            }}
            onChange={() => {
              setOpenRow(null);
              setFinding({ query: "", change: row.key });
            }}
            onUndo={
              row.wasSeen === null
                ? null
                : () => {
                    if (!change((base) => withRowFood(base, row.key, null))) return;
                    setOpenRow(null);
                    setSaid(`Back to ${row.wasSeen ?? ""}.`);
                  }
            }
            onDone={() => { setOpenRow(null); }}
            onRemove={() => {
              if (!change((base) => withRowAmount(base, row.key, null))) return;
              setOpenRow(null);
              setSaid(`${row.title} taken off.`);
            }}
          />
        </Sheet>
      )}
      <FindFood
        query={finding?.query ?? null}
        changing={changing === null ? null : changing.title}
        close={changing === null ? [] : changing.closeFoods}
        grams={changingGrams}
        taken={onSheet(sheet)}
        onClose={() => { setFinding(null); }}
        onPick={(pick) => {
          const name = "own" in pick ? pick.own.name : pick.food.name;
          if (changing === null) {
            keep(withExtra(sheet, pick));
            setSaid(`${name} added.`);
          } else {
            if (!change((base) => withRowFood(base, changing.key, pick))) return;
            setSaid(`${changing.title} changed to ${name}.`);
          }
          setFinding(null);
        }}
      />
      <Sheet open={ask === "newPhoto"} title="Take a new photo?" onClose={() => { setAsk("none"); }}>
        <Txt kind="small">A new photo uses another of your scans, and this meal won’t be saved.</Txt>
        <Button label="Take new photo" wide onPress={() => { setAsk("none"); onNewPhoto(); }} />
        <Button label="Keep this one" kind="quiet" wide onPress={() => { setAsk("none"); }} />
      </Sheet>
    </View>
  );
}

/** One food of the photo's meal: its name, its amount and its calories, as the server last priced
 *  them; the amount as picked while the server works it out. */
function FoodRow({ row, item, onPress }: { row: SheetRow; item: MealItem | null; onPress: () => void }) {
  const measure = row.measures.find((m) => m.id === row.amount.measure);
  // A food not finished says what it needs, in red: until it has it, no food of the meal is priced.
  const needs = rowNeeds(row);
  const amount =
    needs === "fill"
      ? "Pick how full the dish was"
      : needs === "amount"
        ? "Pick an amount"
        : item !== null
          ? loggedAmount(item)
          : measure === undefined
            ? NOT_KNOWN
            : typedAmount(measure, Number(row.amount.amount));
  // The scan's guess of how much, still untouched, a food whose numbers are the scan's own, and the
  // person's own food. On screen the line above says where the numbers come from, so the amount
  // marks only the guess of how much.
  const said = row.source === "own" ? " · your numbers" : row.estimated || row.source === "estimate" ? " · estimate" : "";
  const mark = row.estimated && row.source !== "estimate" ? " · estimate" : "";
  const kcal = item?.kcalPoint ?? null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Change ${row.title}, ${row.numbersFrom === null ? "" : `${row.numbersFrom}, `}${amount}${said}`}
      onPress={onPress}
      style={({ pressed }) => [styles.food, pressed ? styles.pressed : null]}
    >
      <View style={styles.grow}>
        <Txt kind="strong" numberOfLines={2}>
          {row.title}
        </Txt>
        <SourceLine source={row.source} before={row.numbersFrom === null ? "" : `${row.numbersFrom} ·`} />
        <Txt kind="tiny" colour={needs === null ? "textFaint" : "badText"}>
          {amount}
          {needs === null ? mark : ""}
        </Txt>
        {row.wasSeen === null ? null : <Txt kind="tiny">Changed from {row.wasSeen}</Txt>}
      </View>
      <Txt kind="small" colour="text">
        {kcal === null ? "" : kcalWords(kcal)}
      </Txt>
      <Icon name="go" size={16} colour="textSoft" />
    </Pressable>
  );
}

/** A food's amount on the photo's meal, changed as it is typed in; Done, and Take off the meal. */
function RowAmount({
  row,
  onDishChanged,
  grams,
  kcal,
  onAmount,
  onOwn,
  onChange,
  onUndo,
  onDone,
  onRemove,
  waiting,
}: {
  row: SheetRow;
  /** A part of one dish whose weight is still being worked out: a change waits for it. */
  waiting: boolean;
  grams: number | null;
  kcal: number | null;
  onAmount: (amount: { measure: string; amount: string }) => void;
  onOwn: (own: OwnFoodItem) => void;
  onChange: () => void;
  onDishChanged: () => void;
  onUndo: (() => void) | null;
  onDone: () => void;
  onRemove: () => void;
}) {
  const { dishes, again } = useDishes();
  const [panel, setPanel] = useState(false);
  // Not the food it is: another from the search, or the person's own. Back to what the photo saw.
  const notThis = (
    <View style={styles.notThis}>
      <SourceLine source={row.source} before={row.numbersFrom === null ? "" : `${row.numbersFrom} ·`} />
      <View style={styles.grow} />
      <Button label="Not this? Change food" kind="link" onPress={onChange} />
      {waiting ? (
        <Txt kind="small" colour="gold" style={styles.full}>
          Wait a moment: the foods’ weights are still being worked out.
        </Txt>
      ) : null}
    </View>
  );
  const undo = onUndo === null ? null : <Button label={`Back to ${row.wasSeen ?? ""}`} kind="quiet" wide onPress={onUndo} />;
  if (row.own !== null) {
    return (
      <>
        {notThis}
        <OwnFood start={row.own} name={row.own.name} action="Save" onDone={onOwn} />
        {undo}
        <Button label="Take off the meal" icon="trash" kind="quiet" wide onPress={onRemove} />
      </>
    );
  }
  return (
    <>
      {/* The food's numbers and Done stay in view under the list, on the smallest phone too. */}
      <ScrollView style={styles.rowList} contentContainerStyle={styles.rowListInner} keyboardShouldPersistTaps="handled">
      {notThis}
      <AmountPicker measures={row.measures} amount={row.amount} onAmount={onAmount} dishes={dishes} onDishes={() => { again(); onDishChanged(); }} onPanel={setPanel} grams={grams} usual={row.usual} />
      </ScrollView>
      {panel ? null : (
        <View style={styles.sheetFoot}>
          {kcal === null ? null : (
            <Txt kind="small" colour="text">
              {kcalWords(kcal)}
            </Txt>
          )}
          <Button label="Done" wide onPress={onDone} />
          {undo}
          <Button label="Take off the meal" icon="trash" kind="quiet" wide onPress={onRemove} />
        </View>
      )}
    </>
  );
}

type Found = { kind: "idle" } | { kind: "looking" } | { kind: "ok"; items: FoodSearchItem[] } | { kind: "failed"; words: string };

/** A food found by search: one the photo missed, added at its usual amount, or the one a row is
 *  changed to (`changing`, the row's name), at the grams the row weighs; a row changed is offered
 *  its close foods first, before anything is typed (33b-ii). Where the list has none, the person's
 *  own food. `query` null: closed. */
function FindFood({
  query,
  changing,
  close,
  grams,
  taken,
  onClose,
  onPick,
}: {
  query: string | null;
  changing: string | null;
  close: readonly FoodSearchItem[];
  grams: number | null;
  taken: ReadonlySet<string>;
  onClose: () => void;
  onPick: (pick: PhotoSheetPick) => void;
}) {
  const { session } = useSession();
  const [typed, setTyped] = useState("");
  const [found, setFound] = useState<Found>({ kind: "idle" });
  const [own, setOwn] = useState(false);
  useEffect(() => {
    if (query !== null) setTyped(query);
    setOwn(false);
  }, [query]);
  // The phone's back button: from the own food's form, back to the search.
  const back = (): boolean => {
    if (!own) return false;
    setOwn(false);
    return true;
  };
  const pick = (f: FoodSearchItem) => {
    const food = { canonical: f.canonical, name: f.name, source: f.source, measures: f.measures, startsAt: f.startsAt };
    // In a row's place it starts at what the row weighs; added, where the server starts it.
    const amount = changing !== null && grams !== null ? { measure: "g", amount: String(Math.max(1, Math.round(grams))) } : startingAmount(f);
    onPick({ food, amount });
  };
  useEffect(() => {
    const q = typed.trim();
    if (query === null || q === "") {
      setFound({ kind: "idle" });
      return undefined;
    }
    let stale = false;
    const timer = setTimeout(() => {
      setFound({ kind: "looking" });
      void session.signedIn({ method: "GET", path: `/v1/nutrition/foods?q=${encodeURIComponent(q.slice(0, 100))}&limit=10` }, foodSearchResponseSchema).then((answer) => {
        if (stale) return;
        if (answer.kind === "ok") setFound({ kind: "ok", items: answer.data.items });
        else setFound({ kind: "failed", words: answer.kind === "refused" ? answer.message : NO_CONNECTION });
      });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [typed, query, session]);
  if (query === null) return null;
  const list = found.kind === "ok" ? found.items.filter((f) => !taken.has(f.canonical)) : [];
  const title = changing === null ? "Add a food" : `Change ${changing}`;
  if (own) {
    return (
      <Sheet open title="Your own food" onClose={onClose} onBack={back}>
        <ScrollView style={styles.findList} keyboardShouldPersistTaps="handled">
          <OwnFood start={null} name={typed.trim()} grams={changing === null ? null : grams} action="Add" onDone={(food) => { onPick({ own: food }); }} />
        </ScrollView>
      </Sheet>
    );
  }
  const q = typed.trim();
  // A close food in the row's place weighs what the row weighs: its calories are said at that weight.
  const closeWords = (f: FoodSearchItem): string => {
    if (grams === null) return startWords(f);
    const g = Math.max(1, Math.round(grams));
    return `${kcalWords(Math.round((f.kcal * g) / 100))} · ${String(g)} g`;
  };
  const closeList = q === "" ? close.filter((f) => !taken.has(f.canonical)) : [];
  return (
    <Sheet open title={title} onClose={onClose}>
      <Field label="Search food" bare value={typed} onChange={setTyped} placeholder="Search food" ready maxLength={100} />
      <ScrollView style={styles.findList} keyboardShouldPersistTaps="handled">
        {closeList.length === 0 ? null : (
          <Txt kind="tiny" colour="textSoft" style={styles.label}>
            Close matches
          </Txt>
        )}
        {closeList.map((f) => (
          <Pressable
            key={f.canonical}
            accessibilityRole="button"
            accessibilityLabel={`Change to ${f.name}, ${closeWords(f)}`}
            onPress={() => { pick(f); }}
            style={({ pressed }) => [styles.found, pressed ? styles.pressed : null]}
          >
            <Txt kind="strong" numberOfLines={2}>
              {f.name}
            </Txt>
            <SourceLine source={f.source} before={`${closeWords(f)} ·`} />
          </Pressable>
        ))}
        {closeList.length === 0 ? null : <Txt kind="tiny">{FOOD_ALLERGY_CAUTION}</Txt>}
        {found.kind === "looking" ? <Txt kind="small">Searching…</Txt> : null}
        {found.kind === "failed" ? (
          <Txt kind="small" colour="badText">
            {found.words}
          </Txt>
        ) : null}
        {found.kind === "ok" && list.length === 0 ? <Txt kind="small">No food found. Try another word.</Txt> : null}
        {list.map((f) => (
          <Pressable
            key={f.canonical}
            accessibilityRole="button"
            accessibilityLabel={`${changing === null ? "Add" : "Change to"} ${f.name}, ${startWords(f)}`}
            onPress={() => { pick(f); }}
            style={({ pressed }) => [styles.found, pressed ? styles.pressed : null]}
          >
            <Txt kind="strong" numberOfLines={2}>
              {f.name}
            </Txt>
            <SourceLine source={f.source} before={`${startWords(f)} ·`} />
          </Pressable>
        ))}
        {found.kind === "ok" && q !== "" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add ${q} with your own numbers`}
            onPress={() => { setOwn(true); }}
            style={({ pressed }) => [styles.found, pressed ? styles.pressed : null]}
          >
            <Txt kind="strong" colour="orange" numberOfLines={2}>
              Add “{q}” with your own numbers
            </Txt>
            <Txt kind="tiny">Not on the list? Enter what you ate.</Txt>
          </Pressable>
        ) : null}
        <Credits sources={new Set([...closeList, ...list].map((f) => f.source))} />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  grow: { flex: 1 },
  centre: { textAlign: "center" },
  centreSelf: { alignSelf: "center" },
  dim: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  label: { textTransform: "uppercase", letterSpacing: 0.9 },
  topBar: { position: "absolute", left: sizes.edge },
  round: {
    width: sizes.press,
    height: sizes.press,
    borderRadius: sizes.round,
    backgroundColor: colours.overPicture,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  roundBig: { width: 56, height: 56, borderRadius: sizes.round },
  savedList: { flexGrow: 0, flexShrink: 1 },
  footBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: sizes.edge, gap: 18 },
  notice: { alignSelf: "center", maxWidth: 360, gap: 4, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 16, backgroundColor: colours.overWords },
  torchBar: { position: "absolute", right: sizes.edge },
  guideWrap: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center", gap: 16 },
  guide: { width: "78%", aspectRatio: 1.8, borderRadius: 20, borderWidth: 3, borderColor: colours.orange },
  modes: { flexDirection: "row", justifyContent: "center", gap: 8 },
  shutterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  shutter: {
    width: 80,
    height: 80,
    borderRadius: sizes.round,
    borderWidth: 4,
    borderColor: colours.text,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterPressed: { transform: [{ scale: 0.94 }] },
  shutterInner: { width: 62, height: 62, borderRadius: sizes.round, backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient, boxShadow: shadows.button },
  allow: { flex: 1, alignItems: "stretch", gap: 12, paddingHorizontal: sizes.edge * 2 },
  allowMark: {
    alignSelf: "center",
    width: 76,
    height: 76,
    borderRadius: sizes.round,
    backgroundColor: colours.orangeFill,
    borderWidth: 1,
    borderColor: colours.orangeLine,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: shadows.logo,
    marginBottom: 8,
  },
  veil: { backgroundColor: colours.veil },
  readingWords: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  reviewList: { paddingBottom: 24 },
  band: { overflow: "hidden" },
  bandPicture: { width: "100%", height: "100%" },
  fade: { experimental_backgroundImage: pictureFade },
  photoWords: { position: "absolute", left: sizes.edge, right: sizes.edge, bottom: 6, gap: 6 },
  reviewBody: { paddingHorizontal: sizes.edge, paddingTop: sizes.gap, gap: sizes.gap },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  saidRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  food: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colours.line },
  unknown: { gap: 4 },
  unknownRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: sizes.press },
  reviewFoot: { gap: 10, paddingTop: 12, paddingHorizontal: sizes.edge, borderTopWidth: 1, borderTopColor: colours.line, backgroundColor: colours.box },
  footRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sheetFoot: { gap: 10 },
  full: { width: "100%" },
  notThis: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  findList: { maxHeight: 360 },
  rowList: { flexGrow: 0, flexShrink: 1 },
  rowListInner: { gap: 14 },
  found: { minHeight: 56, justifyContent: "center", gap: 2, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colours.line },
});
