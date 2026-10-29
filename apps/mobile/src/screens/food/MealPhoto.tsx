import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { launchImageLibraryAsync } from "expo-image-picker";
import {
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
import { NO_MEASURE, amountRefusal, loggedAmount, startWords, startingAmount } from "./measures";
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
  type PhotoSheet,
  type SheetRow,
} from "./photo";
import type { KeptSheet } from "./PhotoSheetStore";
import { sharedDish } from "./dishShares";
import { OwnFood } from "./OwnFood";
import { WholeDish } from "./WholeDish";
import { Credits, SourceLine } from "./SourceLine";

// Log a meal from a photo (ROADMAP Stage 5 33b-i). The live camera opens at once, as food apps open
// it; a photo taken before is picked from the gallery in the corner. The photo is made small and
// rebuilt on the phone before it is sent (`photo.ts`), the scan's foods are reviewed, changed or taken
// off, a food it missed is added, and Save keeps the meal on the phone until the server has it.

/** A scan takes the server up to about fifty seconds: the photo, then the check of unclear foods. */
const SCAN_WAIT_MS = 75_000;
const NO_CONNECTION = "No connection. Try again.";
const SCAN_GONE = "This photo’s scan has run out, so this meal can’t be saved. Take a new photo.";
/** The photo's band over the review, as tall as a page's own picture is for the phone's shape. */
const PHOTO_TALL = 0.78;
const UNREADABLE = "That photo couldn’t be read. Try another one.";

type Stage = { kind: "camera" } | { kind: "reading"; uri: string } | { kind: "review" };
type Ask = "none" | "newPhoto";

interface MealPhotoProps {
  open: boolean;
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
  return saved.base64 ?? null;
}

export function MealPhoto({ open, kept, onClose, onSaved, onSearch }: MealPhotoProps) {
  const { session, state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const [stage, setStage] = useState<Stage>({ kind: "camera" });
  const [notice, setNotice] = useState<{ words: string; search: boolean } | null>(null);
  // A free try the server gave for a photo it could not read, or for a scan its scanner failed.
  const retake = useRef<string | null>(null);
  const sheet = kept.sheet ?? null;

  // Opened with a photo meal kept: its review; else the camera.
  useEffect(() => {
    if (!open) return;
    setNotice(null);
    setStage((now) => (now.kind === "reading" ? now : kept.sheet !== null && kept.sheet !== undefined ? { kind: "review" } : { kind: "camera" }));
    // Judged as it stood when it was opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const scan = useCallback(
    async (uri: string) => {
      setNotice(null);
      setStage({ kind: "reading", uri });
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

  if (!open) return null;
  return (
    <Modal visible animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={styles.page} testID="meal-photo">
        {stage.kind === "camera" ? (
          <Camera
            notice={notice}
            onPhoto={(uri) => {
              void scan(uri);
            }}
            onClose={onClose}
            onSearch={onSearch}
          />
        ) : stage.kind === "reading" ? (
          <Reading uri={stage.uri} onClose={onClose} />
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
function Round({ icon, say, onPress, big = false }: { icon: "x" | "image"; say: string; onPress: () => void; big?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={say}
      onPress={onPress}
      style={({ pressed }) => [styles.round, big ? styles.roundBig : null, pressed ? styles.pressed : null]}
    >
      <Icon name={icon} size={big ? 22 : 20} />
    </Pressable>
  );
}

/** The live camera, filling the screen: the shutter in the middle at the foot, the gallery beside it. */
function Camera({ notice, onPhoto, onClose, onSearch }: { notice: { words: string; search: boolean } | null; onPhoto: (uri: string) => void; onClose: () => void; onSearch: () => void }) {
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

  const take = async () => {
    const lens = camera.current;
    if (lens === null || !ready || taking) return;
    setTaking(true);
    setFailed(null);
    try {
      const picture = await lens.takePictureAsync({ quality: 0.9, exif: false });
      onPhoto(picture.uri);
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
      if (first !== undefined) onPhoto(first.uri);
    } catch {
      setFailed("Couldn’t open your photos. Try again.");
    }
  };

  const words = failed ?? notice?.words ?? null;
  const allowed = permission?.granted === true;
  return (
    <View style={styles.page}>
      {allowed ? (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
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
            To take a photo of your meal.
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
      <View style={[styles.footBar, { paddingBottom: insets.bottom + 28 }]}>
        {words === null ? null : (
          <View style={styles.notice} accessibilityLiveRegion="polite">
            <Txt kind="small" colour="text" style={styles.centre}>
              {words}
            </Txt>
            {notice?.search === true && failed === null ? <Button label="Search food instead" kind="link" onPress={onSearch} style={styles.centreSelf} /> : null}
          </View>
        )}
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
      </View>
    </View>
  );
}

/** The photo, while the server reads it. */
function Reading({ uri, onClose }: { uri: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.page}>
      <Image source={{ uri }} resizeMode="cover" style={StyleSheet.absoluteFill} accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.veil]} />
      <View style={styles.readingWords}>
        <ActivityIndicator size="large" color={colours.orange} />
        <Txt kind="h3">Reading your meal…</Txt>
      </View>
      <View style={[styles.topBar, { top: insets.top + 12 }]}>
        <Round icon="x" say="Close" onPress={onClose} />
      </View>
    </View>
  );
}

type Priced = { kind: "none" } | { kind: "ok"; preview: MealPreview; for: string } | { kind: "refused"; words: string; for: string };

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
    const timer = setTimeout(() => {
      void session.signedIn({ method: "POST", path: "/v1/nutrition/meals/preview", body: { items, scanToken } }, mealPreviewSchema).then((answer) => {
        if (stale) return;
        if (answer.kind === "ok") setPriced({ kind: "ok", preview: answer.data, for: key });
        // The server no longer holds the scan (kept a day): it can only be taken again.
        else if (answer.kind === "refused" && answer.error === "invalid_scan") setPriced({ kind: "refused", words: SCAN_GONE, for: key });
        else if (answer.kind === "refused" && amountRefusal(answer.error) !== null) setPriced({ kind: "refused", words: amountRefusal(answer.error) ?? "", for: key });
        else setPriced({ kind: "none" });
      });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // `key` is the whole of `items`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scanToken, session]);

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
  // What each food weighs now, by row, as the server last priced it.
  const rowGrams = rows.map((_, i) => numbers?.items[i]?.gramsPoint ?? null);
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
                  <Button label="Add" kind="link" say={`Add ${u}`} onPress={() => { setSaid(null); setFinding({ query: u, change: null }); }} />
                </View>
              ))}
            </View>
          )}
          <Button label="Add a food it missed" icon="plus" kind="soft" small onPress={() => { setSaid(null); setFinding({ query: "", change: null }); }} />
          {rows.some((r) => r.own === null) ? (
            <WholeDish
              applied={sharedDish(rows.filter((r) => r.own === null).map((r) => r.amount))}
              held={rowGrams.some((g, i) => g === null && rows[i]?.own === null) ? "The dishes show once the foods’ weights are worked out." : null}
              onUse={({ dish, fill }) => {
                const next = withWholeDish(sheet, dish.id, fill.value, rowGrams);
                if (next === null) return;
                keep(next);
                setSaid(`Shared out over ${dish.label}, ${fill.words}.`);
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
        {refusedWords === null ? null : (
          <Txt kind="small" colour="badText">
            {refusedWords}
          </Txt>
        )}
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
        <Sheet open title={row.name} onClose={() => { setOpenRow(null); }}>
          <RowAmount
            row={row}
            grams={numbers?.items[rowAt]?.gramsPoint ?? null}
            kcal={numbers?.items[rowAt]?.kcalPoint ?? null}
            onAmount={(amount) => { keep(withRowAmount(sheet, row.key, amount)); }}
            onOwn={(own) => {
              keep(withRowFood(sheet, row.key, { own }));
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
                    keep(withRowFood(sheet, row.key, null));
                    setOpenRow(null);
                    setSaid(`Back to ${row.wasSeen ?? ""}.`);
                  }
            }
            onDone={() => { setOpenRow(null); }}
            onRemove={() => {
              keep(withRowAmount(sheet, row.key, null));
              setOpenRow(null);
              setSaid(`${row.name} taken off.`);
            }}
          />
        </Sheet>
      )}
      <FindFood
        query={finding?.query ?? null}
        changing={changing === null ? null : changing.name}
        grams={changingGrams}
        taken={onSheet(sheet)}
        onClose={() => { setFinding(null); }}
        onPick={(pick) => {
          const name = "own" in pick ? pick.own.name : pick.food.name;
          if (changing === null) {
            keep(withExtra(sheet, pick));
            setSaid(`${name} added.`);
          } else {
            keep(withRowFood(sheet, changing.key, pick));
            setSaid(`${changing.name} changed to ${name}.`);
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
  const amount =
    item !== null
      ? loggedAmount(item)
      : row.amount.measure === NO_MEASURE
        ? "Pick an amount"
        : measure === undefined
          ? NOT_KNOWN
          : typedAmount(measure, Number(row.amount.amount));
  // The scan's guess of how much, still untouched, a food whose numbers are the scan's own, and the
  // person's own food.
  const mark = row.source === "own" ? " · your numbers" : row.estimated || row.source === "estimate" ? " · estimate" : "";
  const kcal = item?.kcalPoint ?? null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Change ${row.name}, ${amount}${mark}`}
      onPress={onPress}
      style={({ pressed }) => [styles.food, pressed ? styles.pressed : null]}
    >
      <View style={styles.grow}>
        <Txt kind="strong" numberOfLines={2}>
          {row.name}
        </Txt>
        <Txt kind="tiny">
          {amount}
          {mark}
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
  grams,
  kcal,
  onAmount,
  onOwn,
  onChange,
  onUndo,
  onDone,
  onRemove,
}: {
  row: SheetRow;
  grams: number | null;
  kcal: number | null;
  onAmount: (amount: { measure: string; amount: string }) => void;
  onOwn: (own: OwnFoodItem) => void;
  onChange: () => void;
  onUndo: (() => void) | null;
  onDone: () => void;
  onRemove: () => void;
}) {
  const { dishes, again } = useDishes();
  const [panel, setPanel] = useState(false);
  // Not the food it is: another from the search, or the person's own. Back to what the photo saw.
  const notThis = (
    <View style={styles.notThis}>
      <SourceLine source={row.source} />
      <View style={styles.grow} />
      <Button label="Not this? Change food" kind="link" onPress={onChange} />
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
      {notThis}
      <AmountPicker measures={row.measures} amount={row.amount} onAmount={onAmount} dishes={dishes} onDishes={again} onPanel={setPanel} grams={grams} usual={row.usual} />
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
 *  changed to (`changing`, the row's name), at the grams the row weighs. Where the list has none, the
 *  person's own food. `query` null: closed. */
function FindFood({
  query,
  changing,
  grams,
  taken,
  onClose,
  onPick,
}: {
  query: string | null;
  changing: string | null;
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
  return (
    <Sheet open title={title} onClose={onClose}>
      <Field label="Search food" bare value={typed} onChange={setTyped} placeholder="Search food" ready maxLength={100} />
      <ScrollView style={styles.findList} keyboardShouldPersistTaps="handled">
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
        <Credits sources={new Set(list.map((f) => f.source))} />
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
  footBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: sizes.edge, gap: 18 },
  notice: { alignSelf: "center", maxWidth: 360, gap: 4, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 16, backgroundColor: colours.overWords },
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
  notThis: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  findList: { maxHeight: 360 },
  found: { minHeight: 56, justifyContent: "center", gap: 2, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colours.line },
});
