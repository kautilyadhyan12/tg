import { useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  defaultUnits,
  directionOf,
  screenAnswered,
  targetShownValue,
  visibleScreens,
  type SetupScreenId,
  type Units,
} from "@app/shared";
import { Button } from "../../look/Button";
import { Badge } from "../../look/Card";
import { colours, orangeGradient, sizes } from "../../look/colours";
import { Icon, type IconName } from "../../look/Icon";
import { Txt } from "../../look/Txt";
import { WheelGroup } from "../../look/Wheel";
import { useSession } from "../../session/SessionProvider";
import { PlanPanel } from "./PlanPanel";
import {
  AboutScreen,
  DayScreen,
  EquipmentScreen,
  GoalScreen,
  TargetScreen,
  TrainingScreen,
  WeekScreen,
  type ScreenProps,
} from "./SetupScreens";
import { LOAD_FAILED, useSetupAnswers } from "./useSetupAnswers";

// Setup on the phone (ROADMAP Stage 5 item 14a): the browser's setup, a page over the tabs, one
// screen at a time with Back and Continue held at the bottom. Every answer is saved the moment it
// is given, and the server's daily number sits on every screen from the moment it exists.

const VIEWS: Partial<Record<SetupScreenId, (props: ScreenProps) => React.JSX.Element>> = {
  goal: GoalScreen,
  about: AboutScreen,
  target: TargetScreen,
  day: DayScreen,
  training: TrainingScreen,
  week: WeekScreen,
  equipment: EquipmentScreen,
};

const ICONS: Partial<Record<SetupScreenId, IconName>> = {
  goal: "target",
  about: "user",
  target: "chart",
  day: "sun",
  training: "zap",
  week: "clock",
  equipment: "dumbbell",
};

export const NAME_NEEDED = "Type the name we should call you.";

/** The phone's own language tag, which says whether it weighs in pounds. */
const phoneLanguage = (): string => Intl.DateTimeFormat().resolvedOptions().locale;

export function Setup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView accessibilityViewIsModal behavior="padding" style={[styles.page, { paddingTop: insets.top }]}>
        {open ? <SetupBody onClose={onClose} bottom={insets.bottom} /> : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SetupBody({ onClose, bottom }: { onClose: () => void; bottom: number }) {
  const { session } = useSession();
  const ob = useSetupAnswers({
    onSaved: (saved) => {
      void session.keepName(saved.displayName);
    },
  });
  const [picked, setPicked] = useState<SetupScreenId | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [units, setUnits] = useState<Units>(() => defaultUnits(phoneLanguage()));
  const [busy, setBusy] = useState(false);

  const answers = ob.answers;
  const screens = visibleScreens(answers).filter((s) => VIEWS[s.id] !== undefined);
  const firstOpen = () => {
    const from = ob.first ?? answers;
    return screens.find((s) => !screenAnswered(s.id, from))?.id ?? "goal";
  };
  const current = picked ?? (ob.first === null ? "goal" : firstOpen());
  const index = Math.max(0, screens.findIndex((s) => s.id === current));
  const screen = screens[index];
  const isLast = index === screens.length - 1;
  const direction = directionOf(answers.weightGoal);

  /** The name box saves when the person leaves it. A name is never blank. */
  const commitName = (): boolean => {
    if (nameDraft === null) return true;
    const trimmed = nameDraft.trim();
    if (trimmed === "") {
      setNameError(NAME_NEEDED);
      return false;
    }
    setNameDraft(null);
    if (trimmed !== answers.displayName) ob.save({ displayName: trimmed });
    return true;
  };
  const name = {
    text: nameDraft ?? answers.displayName ?? "",
    error: nameError,
    change: (text: string) => {
      setNameDraft(text);
      setNameError(null);
    },
    commit: commitName,
  };

  /** On only once every save so far has landed, so a later screen never stands on an answer the server refused. */
  const goOn = async (then: () => void) => {
    if (!commitName()) return;
    setBusy(true);
    const saved = await ob.settled();
    setBusy(false);
    if (saved) then();
  };

  const close = () => {
    if (commitName()) onClose();
  };

  if (screen === undefined || ob.status !== "ready" || ob.first === null) {
    return (
      <>
        <Bar onClose={close} />
        <View style={styles.middle}>
          {ob.status === "failed" ? (
            <>
              <Txt style={styles.centre}>{LOAD_FAILED}</Txt>
              <Button label="Try again" kind="plain" onPress={ob.retry} />
            </>
          ) : null}
        </View>
      </>
    );
  }

  const View_ = VIEWS[screen.id];
  const answered = screenAnswered(screen.id, answers);
  const progress = screens.length > 1 ? index / (screens.length - 1) : 1;

  return (
    <WheelGroup>
      {(release) => (
        <>
          <Bar onClose={close} step={`Step ${String(index + 1)} of ${String(screens.length)}`} progress={progress} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.body}
            onScrollBeginDrag={release}
          >
            <View style={styles.title}>
              <Badge icon={ICONS[screen.id] ?? "target"} />
              <View style={styles.grow}>
                <Txt kind="h2">{screen.title}</Txt>
                <Txt kind="small">{screen.desc}</Txt>
              </View>
            </View>
            <PlanPanel
              plan={ob.plan}
              direction={direction}
              units={units}
              targetShown={targetShownValue(direction, answers, units)}
            />
            {View_ === undefined ? null : (
              <View_
                answers={answers}
                save={ob.save}
                units={units}
                setUnits={setUnits}
                name={name}
                direction={direction}
                plan={ob.plan}
              />
            )}
          </ScrollView>
          <View style={[styles.foot, { paddingBottom: bottom + 12 }]}>
            {ob.problem === null ? null : (
              <Txt colour="badText" kind="small" style={styles.centre}>
                {ob.problem}
              </Txt>
            )}
            <View style={styles.buttons}>
              {index > 0 ? (
                <Button
                  label="Back"
                  kind="plain"
                  disabled={busy}
                  onPress={() => {
                    const back = screens[index - 1];
                    if (back !== undefined) setPicked(back.id);
                  }}
                />
              ) : null}
              <Button
                label={isLast ? "Done" : "Continue"}
                wide
                style={styles.grow}
                disabled={!answered}
                busy={busy}
                onPress={() => {
                  void goOn(() => {
                    if (isLast) onClose();
                    else setPicked(screens[index + 1]?.id ?? screen.id);
                  });
                }}
              />
            </View>
          </View>
        </>
      )}
    </WheelGroup>
  );
}

function Bar({ onClose, step, progress }: { onClose: () => void; step?: string; progress?: number }) {
  return (
    <View style={styles.bar}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
        <Icon name="x" size={20} />
      </Pressable>
      <View style={styles.grow}>
        {step === undefined ? null : (
          <>
            <Txt kind="tiny">{step}</Txt>
            <View style={styles.track}>
              <View style={[styles.fillBar, { flex: progress ?? 0 }]} />
              <View style={{ flex: 1 - (progress ?? 0) }} />
            </View>
          </>
        )}
      </View>
      <View style={styles.close} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 8 },
  close: { width: sizes.press, height: sizes.press, alignItems: "center", justifyContent: "center", borderRadius: sizes.round },
  track: { flexDirection: "row", height: 6, marginTop: 6, borderRadius: sizes.round, backgroundColor: colours.track, overflow: "hidden" },
  fillBar: { height: 6, borderRadius: sizes.round, backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient },
  body: { paddingHorizontal: sizes.edge, paddingTop: 8, paddingBottom: 24, gap: 20 },
  title: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
  middle: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: sizes.edge },
  centre: { textAlign: "center" },
  foot: {
    gap: 8,
    paddingTop: 12,
    paddingHorizontal: sizes.edge,
    borderTopWidth: 1,
    borderTopColor: colours.line,
    backgroundColor: colours.page,
  },
  buttons: { flexDirection: "row", gap: 10 },
});
