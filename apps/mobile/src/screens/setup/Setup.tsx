import { useEffect, useRef, useState, type RefObject } from "react";
import { Image, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  defaultUnits,
  directionOf,
  screenAnswered,
  targetShownValue,
  visibleScreens,
  type SetupAnswers,
  type SetupScreenId,
  type Units,
} from "@app/shared";
import { Button } from "../../look/Button";
import { colours, orangeGradient, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { pictures } from "../../look/pictures";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { PlanBar } from "./PlanPanel";
import {
  AboutScreen,
  DayScreen,
  EquipmentScreen,
  FoodScreen,
  GoalScreen,
  HealthScreen,
  TargetScreen,
  TrainingScreen,
  WeekScreen,
  type ScreenProps,
} from "./SetupScreens";
import { useHealthStep } from "./useHealthStep";
import { LOAD_FAILED, useSetupAnswers } from "./useSetupAnswers";

// Setup on the phone (ROADMAP Stage 5 items 14a and 14b): a page over the tabs, one screen at a time, the
// browser's setup picture glowing behind it. Every answer is saved the moment it is given, and the
// server's daily number sits on every screen from the moment it exists.

const VIEWS: Partial<Record<SetupScreenId, (props: ScreenProps) => React.JSX.Element>> = {
  goal: GoalScreen,
  about: AboutScreen,
  target: TargetScreen,
  day: DayScreen,
  training: TrainingScreen,
  week: WeekScreen,
  equipment: EquipmentScreen,
  health: HealthScreen,
  food: FoodScreen,
};

export const NAME_NEEDED = "Type the name we should call you.";

/** The phone's own language tag, which says whether it weighs in pounds. */
const phoneLanguage = (): string => Intl.DateTimeFormat().resolvedOptions().locale;

/** `at`: the screen it opens on, where another page sends the person to one answer (31b: a goal's target). */
export function Setup({ open, onClose, at = null }: { open: boolean; onClose: () => void; at?: SetupScreenId | null }) {
  const insets = useSafeAreaInsets();
  // Android's back leaves as the ✕ does: the name typed is saved first, and a blank one stays to be fixed.
  const leave = useRef<() => void>(onClose);
  return (
    <Modal
      testID="setup"
      visible={open}
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => {
        leave.current();
      }}
    >
      <KeyboardAvoidingView accessibilityViewIsModal behavior="padding" style={[styles.page, { paddingTop: insets.top }]}>
        <Image source={pictures.setup} resizeMode="cover" accessible={false} style={styles.picture} />
        {open ? <SetupBody onClose={onClose} leave={leave} bottom={insets.bottom} at={at} /> : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SetupBody({
  onClose,
  leave,
  bottom,
  at,
}: {
  onClose: () => void;
  leave: RefObject<() => void>;
  bottom: number;
  at: SetupScreenId | null;
}) {
  const { session } = useSession();
  const ob = useSetupAnswers({
    onSaved: (saved) => {
      void session.keepName(saved.displayName);
    },
  });
  const health = useHealthStep();
  const [picked, setPicked] = useState<SetupScreenId | null>(at);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [units, setUnits] = useState<Units>(() => defaultUnits(phoneLanguage()));
  const [busy, setBusy] = useState(false);

  // Screen 8's answer comes from its own route, laid beside the rest as the browser does.
  const answers: SetupAnswers = { ...ob.answers, health: health.screening };
  const screens = visibleScreens(answers).filter((s) => VIEWS[s.id] !== undefined);
  /** The health screen is done only with its note ticked as well. */
  const done = (id: SetupScreenId, a: SetupAnswers): boolean => screenAnswered(id, a) && (id !== "health" || health.ticked);
  const firstOpen = () => {
    const from: SetupAnswers = ob.first === null ? answers : { ...ob.first, health: health.first };
    return screens.find((s) => !done(s.id, from))?.id ?? "goal";
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
  useEffect(() => {
    leave.current = close;
  });
  const back = index > 0 ? screens[index - 1] : undefined;

  const failed = ob.status === "failed" || health.status === "failed";
  if (screen === undefined || ob.status !== "ready" || ob.first === null || health.status !== "ready") {
    return (
      <>
        <Bar onClose={close} />
        <View style={styles.middle}>
          {failed ? (
            <>
              <Txt style={styles.centre}>{LOAD_FAILED}</Txt>
              <Button
                label="Try again"
                kind="plain"
                style={styles.self}
                onPress={() => {
                  if (ob.status === "failed") ob.retry();
                  if (health.status === "failed") health.retry();
                }}
              />
            </>
          ) : null}
        </View>
      </>
    );
  }

  const View_ = VIEWS[screen.id];
  const answered = done(screen.id, answers);

  return (
    <>
      <Bar
        onClose={close}
        onBack={
          back === undefined || busy
            ? undefined
            : () => {
                setPicked(back.id);
              }
        }
        step={index}
        steps={screens.length}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <Txt kind="h1">{screen.title}</Txt>
        <PlanBar plan={ob.plan} direction={direction} units={units} targetShown={targetShownValue(direction, answers, units)} />
        {View_ === undefined ? null : (
          <View_
            answers={answers}
            save={ob.save}
            units={units}
            setUnits={setUnits}
            name={name}
            direction={direction}
            plan={ob.plan}
            health={health}
            healthSaved={() => {
              ob.save({});
            }}
          />
        )}
      </ScrollView>
      <View style={[styles.foot, { paddingBottom: bottom + 12 }]}>
        {ob.problem === null ? null : <Txt style={styles.problem}>{ob.problem}</Txt>}
        <Button
          label={isLast ? "Done" : "Continue"}
          kind={answered ? "main" : "plain"}
          style={styles.next}
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
    </>
  );
}

/** Back on the left, a thin bar of the steps, and close on the right. */
function Bar({ onClose, onBack, step, steps }: { onClose: () => void; onBack?: (() => void) | undefined; step?: number; steps?: number }) {
  return (
    <View style={styles.bar}>
      {onBack === undefined ? (
        <View style={styles.round} />
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.round}>
          <Icon name="back" size={20} />
        </Pressable>
      )}
      {step === undefined || steps === undefined ? (
        <View style={styles.steps} />
      ) : (
        <View accessible accessibilityLabel={`Step ${String(step + 1)} of ${String(steps)}`} style={styles.steps}>
          {Array.from({ length: steps }, (_, i) => (
            <View key={i} style={[styles.stepBar, i <= step ? styles.stepDone : null]} />
          ))}
        </View>
      )}
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.round}>
        <Icon name="x" size={20} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  picture: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0.28 },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingTop: 6 },
  round: { width: sizes.press, height: sizes.press, alignItems: "center", justifyContent: "center", borderRadius: sizes.round },
  steps: { flex: 1, flexDirection: "row", gap: 4 },
  stepBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colours.track },
  stepDone: { backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient },
  body: { paddingHorizontal: sizes.edge, paddingTop: 10, paddingBottom: 28, gap: 18 },
  middle: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: sizes.edge },
  centre: { textAlign: "center" },
  self: { alignSelf: "center" },
  problem: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colours.badText, textAlign: "center" },
  foot: { gap: 8, paddingTop: 10, paddingHorizontal: sizes.edge, alignItems: "flex-end" },
  next: { minWidth: 150, alignSelf: "flex-end" },
});
