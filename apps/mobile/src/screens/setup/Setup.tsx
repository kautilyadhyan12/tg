import { useEffect, useRef, useState, type RefObject } from "react";
import { Image, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  SCREENS,
  SCREEN_OF_MISSING,
  cleanEquipment,
  defaultUnits,
  directionOf,
  missingText,
  myInvitationsResponseSchema,
  openSetupAnswers,
  orgWords,
  screenAnswered,
  targetShownValue,
  visibleScreens,
  type MyInvitation,
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
import { invitationsPath } from "../Invitation";
import { SignOutAsk } from "../SignOutAsk";
import { PlanBar } from "./PlanPanel";
import {
  AboutScreen,
  DayScreen,
  EquipmentScreen,
  FoodScreen,
  GoalScreen,
  HealthScreen,
  PlaceScreen,
  PlanScreen,
  TargetScreen,
  TrainingScreen,
  WeekScreen,
  type ScreenProps,
} from "./SetupScreens";
import { useHealthStep } from "./useHealthStep";
import { LOAD_FAILED, useSetupAnswers } from "./useSetupAnswers";

// Setup on the phone (ROADMAP Stage 5 items 14a to 14c): one screen at a time, the browser's setup
// picture glowing behind it. Every answer is saved the moment it is given, and the server's daily
// number sits on every screen from the moment it exists. In front of the tabs until it is finished
// ("front"), with Sign out its only way out; opened from Me or a goal after that ("over"), with close.

const VIEWS: Record<SetupScreenId, (props: ScreenProps) => React.JSX.Element> = {
  goal: GoalScreen,
  about: AboutScreen,
  target: TargetScreen,
  day: DayScreen,
  training: TrainingScreen,
  week: WeekScreen,
  equipment: EquipmentScreen,
  health: HealthScreen,
  food: FoodScreen,
  gym: PlaceScreen,
  plan: PlanScreen,
};

export const NAME_NEEDED = "Type the name we should call you.";

/** The phone's own language tag, which says whether it weighs in pounds. */
const phoneLanguage = (): string => Intl.DateTimeFormat().resolvedOptions().locale;

/** The place step's heading, in the words of the places that invited the person: "Your yoga
 *  studio", "Your trainer"; more than one kind is "Where you train". */
export function placeTitle(invitations: readonly MyInvitation[]): string {
  const kinds = new Set(invitations.map((one) => orgWords(one.gym.orgType).itToMembers));
  const [only] = kinds;
  return kinds.size === 1 && only !== undefined ? `Your ${only}` : "Where you train";
}

type Mode = "over" | "front";

interface SetupProps {
  open: boolean;
  /** Close; in front of the tabs, the end of setup. */
  onClose: () => void;
  /** `at`: the screen it opens on, where another page sends the person to one answer (31b: a goal's target). */
  at?: SetupScreenId | null;
  mode?: Mode;
}

export function Setup({ open, onClose, at = null, mode = "over" }: SetupProps) {
  const insets = useSafeAreaInsets();
  // Android's back leaves as the ✕ does: the name typed is saved first, and a blank one stays to be
  // fixed. In front of the tabs it goes back a step, and nowhere from the first.
  const leave = useRef<() => void>(mode === "over" ? onClose : () => undefined);
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
        {open ? <SetupBody onClose={onClose} leave={leave} bottom={insets.bottom} at={at} mode={mode} /> : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** The invitations waiting when setup opened, read once: the place step is asked only for them. A
 *  read that fails asks nothing, as the Gym tab lists them too. */
function useWaiting(): MyInvitation[] | null {
  const { session } = useSession();
  const [waiting, setWaiting] = useState<MyInvitation[] | null>(null);
  useEffect(() => {
    const run = { live: true };
    void (async () => {
      const answer = await session.signedIn({ method: "GET", path: invitationsPath }, myInvitationsResponseSchema);
      if (run.live) setWaiting(answer.kind === "ok" ? answer.data.invitations.filter((one) => one.state === "pending") : []);
    })();
    return () => {
      run.live = false;
    };
  }, [session]);
  return waiting;
}

function SetupBody({
  onClose,
  leave,
  bottom,
  at,
  mode,
}: {
  onClose: () => void;
  leave: RefObject<() => void>;
  bottom: number;
  at: SetupScreenId | null;
  mode: Mode;
}) {
  const { session } = useSession();
  const ob = useSetupAnswers({
    onSaved: (saved) => {
      void session.keepName(saved.displayName);
    },
  });
  const health = useHealthStep();
  const waiting = useWaiting();
  const [picked, setPicked] = useState<SetupScreenId | null>(at);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [units, setUnits] = useState<Units>(() => defaultUnits(phoneLanguage()));
  const [busy, setBusy] = useState(false);
  /** On a screen opened by the plan's Adjust: its Continue goes to the first answer still open, or back to the plan. */
  const [adjusting, setAdjusting] = useState(false);
  /** The questions a refused finish named, until the person moves. */
  const [refused, setRefused] = useState<string[] | null>(null);
  const [finished, setFinished] = useState(false);
  const [askingOut, setAskingOut] = useState(false);

  // Screen 8's answer comes from its own route, laid beside the rest as the browser does.
  const answers: SetupAnswers = { ...ob.answers, health: health.screening };
  const screens = visibleScreens(answers).filter((s) => s.id !== "gym" || (waiting ?? []).length > 0);
  /** The health screen is done with its answer saved, no Yes left waiting for "Check first", and its note ticked. */
  const done = (id: SetupScreenId, a: SetupAnswers, ticked: boolean = health.ticked): boolean =>
    screenAnswered(id, a) && (id !== "health" || (ticked && !health.pendingYes));
  /** The first screen still open in `from`, or the plan when none is. */
  const openIn = (from: SetupAnswers, ticked: boolean): SetupScreenId =>
    screens.find((s) => s.id !== "plan" && !done(s.id, from, ticked))?.id ?? "plan";
  /** Where the person lands, from the answers and the tick as they stood on opening: a tick never moves them on. */
  const firstOpen = () => openIn(ob.first === null ? answers : { ...ob.first, health: health.first }, health.firstTicked === true);
  const current = picked ?? (ob.first === null ? "goal" : firstOpen());
  const index = Math.max(0, screens.findIndex((s) => s.id === current));
  const screen = screens[index];
  const direction = directionOf(answers.weightGoal);
  const isPlan = screen?.id === "plan";
  const nextId = adjusting ? openIn(answers, health.ticked) : (screens[index + 1]?.id ?? "plan");
  const setupDone = ob.answers.onboardingCompleted === true;

  const goTo = (id: SetupScreenId) => {
    setPicked(id);
    setRefused(null);
    // Arriving back on the plan, by any way, ends an adjustment.
    if (id === "plan") setAdjusting(false);
  };
  const adjust = (id: SetupScreenId) => {
    goTo(id);
    setAdjusting(true);
  };

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
    if (!commitName() || health.saving) return;
    setBusy(true);
    const saved = await ob.settled();
    setBusy(false);
    if (saved) then();
  };

  const close = () => {
    if (commitName()) onClose();
  };
  const back = index > 0 ? screens[index - 1] : undefined;
  useEffect(() => {
    leave.current =
      mode === "over"
        ? close
        : () => {
            if (back !== undefined && !busy) goTo(back.id);
          };
  });

  /** Somebody who finished on another phone or in the browser is not asked again. */
  const finishedElsewhere = mode === "front" && ob.first?.onboardingCompleted === true;
  useEffect(() => {
    if (!finishedElsewhere) return;
    void (async () => {
      await session.keepSetupDone(true);
      onClose();
    })();
  }, [finishedElsewhere, onClose, session]);

  // What still stands between the person and Finish, in the server's words: what the plan lacks,
  // the answers only setup asks, and the health note's tick, each with the way to its screen.
  const open = openSetupAnswers(refused ?? (ob.plan === null ? ob.missing : []), answers);
  const toAnswer = [
    ...new Set<SetupScreenId>([
      ...open.map((k) => SCREEN_OF_MISSING[k]).filter((id): id is SetupScreenId => id !== undefined),
      ...(health.ticked ? [] : ["health" as const]),
    ]),
  ];
  // Every screen answered, as the browser asks: the server's own check does not ask for the level,
  // the places or the equipment.
  const allAnswered = screens.every((s) => s.id === "plan" || done(s.id, answers));
  const canFinish = allAnswered && open.length === 0 && health.ticked && health.planTicked && !health.pendingYes && !health.saving && !busy;

  const finish = async () => {
    if (!commitName()) return;
    setBusy(true);
    const result = await ob.finish({ availableEquipment: cleanEquipment(answers.availableEquipment) });
    if (result.ok) await session.keepSetupDone(true);
    setBusy(false);
    if (result.ok) {
      setFinished(true);
      return;
    }
    if (result.missing !== null) {
      setRefused(result.missing);
      // The server holds no health answer, whatever this screen believed (a reset elsewhere).
      if (result.missing.includes("health")) health.forget();
    }
  };

  const right =
    mode === "over"
      ? { onClose: close }
      : {
          onSignOut: () => {
            setAskingOut(true);
          },
        };
  const signOutAsk = (
    <SignOutAsk
      open={askingOut}
      onClose={() => {
        setAskingOut(false);
      }}
    />
  );

  if (finished) {
    return (
      <View style={[styles.middle, { paddingBottom: bottom + 24 }]}>
        <View style={styles.doneMark}>
          <Icon name="check" size={30} colour="onOrange" />
        </View>
        <Txt kind="h1" style={styles.centre}>
          You’re all set
        </Txt>
        <Button label="Start" style={styles.self} onPress={onClose} />
      </View>
    );
  }

  const failed = ob.status === "failed" || health.status === "failed";
  if (
    screen === undefined ||
    ob.status !== "ready" ||
    ob.first === null ||
    health.status !== "ready" ||
    waiting === null ||
    finishedElsewhere
  ) {
    return (
      <>
        <Bar {...right} />
        {signOutAsk}
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
  const title = screen.id === "gym" ? placeTitle(waiting) : screen.title;

  return (
    <>
      <Bar
        {...right}
        onBack={
          back === undefined || busy
            ? undefined
            : () => {
                goTo(back.id);
              }
        }
        step={index}
        steps={screens.length}
      />
      {signOutAsk}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <Txt kind="h1">{title}</Txt>
        <PlanBar plan={ob.plan} direction={direction} units={units} targetShown={targetShownValue(direction, answers, units)} />
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
            // A refusal that named this question has just been answered.
            setRefused((named) => (named === null ? null : named.filter((k) => k !== "health")));
            ob.save({});
          }}
          invitations={waiting}
          adjust={adjust}
          busy={busy || health.saving}
        />
        {isPlan && !setupDone && toAnswer.length > 0 ? (
          <View accessibilityRole="summary" style={styles.open}>
            {open.length > 0 ? <Txt style={styles.openWords}>Before you finish, answer {missingText(open)}.</Txt> : null}
            {health.ticked ? null : <Txt style={styles.openWords}>Read the note on the Health screen and tick it.</Txt>}
            {toAnswer.map((id) => (
              <Button
                key={id}
                label={`Go to ${SCREENS.find((s) => s.id === id)?.title ?? id}`}
                kind="soft"
                small
                disabled={busy}
                onPress={() => {
                  adjust(id);
                }}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
      <View style={[styles.foot, { paddingBottom: bottom + 12 }]}>
        {/* Said here, under the button, so it is seen on whichever screen the person is on. */}
        {ob.problem === null ? null : <Txt style={styles.problem}>{ob.problem}</Txt>}
        {health.problem === null ? null : <Txt style={styles.problem}>{health.problem}</Txt>}
        {isPlan && !setupDone ? (
          <Button
            label="Finish setup"
            kind={canFinish ? "main" : "plain"}
            style={styles.next}
            disabled={!canFinish}
            busy={busy}
            onPress={() => void finish()}
          />
        ) : (
          <Button
            label={isPlan ? "Done" : adjusting && nextId === "plan" ? "Back to your plan" : "Continue"}
            kind={answered ? "main" : "plain"}
            style={styles.next}
            disabled={!answered || health.saving}
            busy={busy}
            onPress={() => {
              void goOn(() => {
                if (isPlan) close();
                else goTo(nextId);
              });
            }}
          />
        )}
      </View>
    </>
  );
}

/** Back on the left, a thin bar of the steps, and close on the right; in front of the tabs, Sign out there. */
function Bar({
  onClose,
  onSignOut,
  onBack,
  step,
  steps,
}: {
  onClose?: () => void;
  onSignOut?: () => void;
  onBack?: (() => void) | undefined;
  step?: number;
  steps?: number;
}) {
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
      {onSignOut === undefined ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.round}>
          <Icon name="x" size={20} />
        </Pressable>
      ) : (
        <Button label="Sign out" kind="quiet" small onPress={onSignOut} />
      )}
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
  middle: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, padding: sizes.edge },
  centre: { textAlign: "center" },
  self: { alignSelf: "center", minWidth: 150 },
  problem: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colours.badText, textAlign: "center" },
  foot: { gap: 8, paddingTop: 10, paddingHorizontal: sizes.edge, alignItems: "flex-end" },
  next: { minWidth: 150, alignSelf: "flex-end" },
  open: { gap: 10, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.overWords },
  openWords: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colours.text },
  doneMark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.orange,
    experimental_backgroundImage: orangeGradient,
  },
});
