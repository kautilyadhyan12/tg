import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, FlatList, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  gymChallengeBoardResponseSchema,
  gymChallengesResponseSchema,
  memberGymChallengeResponseSchema,
  type GymChallengeBoardResponse,
  type GymChallengeRow,
  type GymChallengesResponse,
  type GymClockFormat,
  type MemberGymChallenge,
} from "@app/shared";
import { Button } from "../../look/Button";
import { Card, Pill } from "../../look/Card";
import { colours, sizes } from "../../look/colours";
import { Icon, type IconName } from "../../look/Icon";
import { Modal } from "../../look/Modal";
import { PictureTop } from "../../look/PictureTop";
import { Steps } from "../../look/Progress";
import { Sheet } from "../../look/Sheet";
import { pictureTopHeight } from "../../look/sizing";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { NO_ANSWER } from "../SignIn";
import { ordinal } from "./classesView";
import {
  BOARD_NOT_READ,
  CHALLENGES_NOT_READ,
  CHALLENGE_GONE,
  aboutLine,
  boardNote,
  boardPath,
  challengeChip,
  challengeDates,
  challengesNotShown,
  challengesPath,
  countText,
  dayMarks,
  howToWin,
  inTeams,
  joinNote,
  joinedPath,
  leaveBox,
  markLabel,
  myTeam,
  myTeamNote,
  noChallenges,
  notCountingNote,
  pickBox,
  placeLine,
  printed,
  progress,
  resultOf,
  rowLine,
  teamPath,
  teamRows,
  teamRuleNote,
  teamsLine,
  whoLine,
  type TeamLine,
} from "./challengesView";
import { LeaderboardPage, NameBox } from "./Leaderboard";
import { hiddenText, updatedText } from "./leaderboardView";
import { PersonProfile, type ProfilePerson } from "./PersonProfile";

// A place's challenges for its member (spec Part 3 §15.6; ROADMAP Stage 5 item 17d): a short list, and each challenge on
// a page of its own, its whole board one press on. The server works every number and place out and leaves hidden people
// out; "You're in" is only ever what its last answer said. Read on opening and when the app comes back.

export interface ChallengesPlace {
  id: string;
  name: string;
  clockFormat: GymClockFormat;
}

interface ChallengesPageProps {
  place: ChallengesPlace | null;
  /** The challenge to open at once (See the challenge, on a result's post). */
  openId?: string | null;
  onClose: () => void;
  /** Somebody was blocked or unblocked from a profile opened here: the page behind reads again. */
  onChanged?: () => void;
}

const LIST_PICTURE_TALL = 0.6;
const PAGE_PICTURE_TALL = 0.5;
const PROFILE_PERIOD = "this_month";
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** The page over the Gym tab or Updates; closed while `place` is null. */
export function ChallengesPage({ place, openId = null, onClose, onChanged }: ChallengesPageProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={place !== null} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View testID="challenges-page" accessibilityViewIsModal style={styles.page}>
        {place === null ? null : <Body key={place.id} place={place} firstOpen={openId} onClose={onClose} top={insets.top} bottom={insets.bottom} {...(onChanged === undefined ? {} : { onChanged })} />}
      </View>
    </Modal>
  );
}

type Held = { kind: "loading" } | { kind: "failed"; status: number | null } | { kind: "ok"; list: GymChallengesResponse };
type Doing = { kind: "join" | "leave" } | { kind: "pick"; teamId: string };

interface BodyProps {
  place: ChallengesPlace;
  firstOpen: string | null;
  onClose: () => void;
  onChanged?: () => void;
  top: number;
  bottom: number;
}

function Body({ place, firstOpen, onClose, onChanged, top, bottom }: BodyProps) {
  const { session } = useSession();
  const [held, setHeld] = useState<Held>({ kind: "loading" });
  const [openId, setOpenId] = useState<string | null>(firstOpen);
  const [busy, setBusy] = useState<{ id: string; doing: Doing } | null>(null);
  // What the last press on a challenge answered when it failed, by challenge.
  const [said, setSaid] = useState<Record<string, string | undefined>>({});
  // Reads are numbered as they start: an answer stands only if no later read or press has started.
  const started = useRef(0);
  const live = useRef(true);

  const load = useCallback(
    async (quiet: boolean) => {
      started.current += 1;
      const number = started.current;
      const answer = await session.signedIn({ method: "GET", path: challengesPath(place.id) }, gymChallengesResponseSchema);
      if (!live.current || number !== started.current) return;
      // Another place's challenges are never shown under this one.
      if (answer.kind === "ok" && answer.data.gymId === place.id) {
        setHeld({ kind: "ok", list: answer.data });
        return;
      }
      // A read made by itself never takes the page away over a lost connection; a 404 does.
      const failed: Held = { kind: "failed", status: answer.kind === "refused" ? answer.status : null };
      if (!quiet || failed.status === 404) setHeld(failed);
      else setHeld((was) => (was.kind === "ok" ? was : failed));
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
  }, [load]);

  /** Asked twice it is done once, so a press with no answer is safe to press again. Nothing is drawn until it answers. */
  const press = async (challenge: MemberGymChallenge, doing: Doing) => {
    if (busy !== null) return;
    setBusy({ id: challenge.id, doing });
    setSaid((all) => ({ ...all, [challenge.id]: undefined }));
    const answer = await session.signedIn(
      doing.kind === "pick"
        ? { method: "PUT", path: teamPath(place.id, challenge.id), body: { teamId: doing.teamId } }
        : { method: doing.kind === "join" ? "PUT" : "DELETE", path: joinedPath(place.id, challenge.id) },
      memberGymChallengeResponseSchema,
    );
    if (!live.current) return;
    setBusy(null);
    if (answer.kind === "ok" && answer.data.challenge.id === challenge.id) {
      const now = answer.data.challenge;
      // A read that started before this answer may not hold what the press did.
      started.current += 1;
      setHeld((was) => (was.kind !== "ok" ? was : { ...was, list: { ...was.list, challenges: was.list.challenges.map((c) => (c.id === now.id ? now : c)) } }));
      return;
    }
    setSaid((all) => ({ ...all, [challenge.id]: answer.kind === "refused" ? answer.message : NO_ANSWER }));
    // It may have reached the server, or the challenge is not as this page showed it.
    void load(true);
  };

  const list = held.kind === "ok" ? held.list : null;
  const paused = list?.status === "paused";
  const notShown = challengesNotShown(place.name);
  const again = () => {
    setHeld({ kind: "loading" });
    void load(false);
  };
  const empty =
    held.kind === "loading" ? (
      <Txt kind="small">Loading…</Txt>
    ) : held.kind === "failed" ? (
      <Card style={styles.box}>
        <Txt colour="badText">{held.status === 404 ? notShown : CHALLENGES_NOT_READ}</Txt>
        <Button label="Try again" kind="soft" small onPress={again} />
      </Card>
    ) : (
      <Txt colour="text">{paused ? notShown : noChallenges(place.name)}</Txt>
    );

  return (
    <>
      <FlatList
        testID="challenges-list"
        style={styles.grow}
        contentContainerStyle={[styles.list, { paddingBottom: bottom + 24 }]}
        data={list === null || paused ? [] : list.challenges}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={<PictureTop picture="weeklychallenges" tall={LIST_PICTURE_TALL} eyebrow={place.name} title="Challenges" />}
        ListEmptyComponent={<View style={styles.edge}>{empty}</View>}
        renderItem={({ item }) =>
          list === null ? null : (
            <ChallengeRow
              challenge={item}
              today={list.today}
              gymName={place.name}
              onOpen={() => {
                setOpenId(item.id);
              }}
            />
          )
        }
      />
      <BackButton top={top} onPress={onClose} />
      <Modal
        visible={openId !== null}
        animationType="slide"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => {
          setOpenId(null);
        }}
      >
        {openId === null ? null : (
          <OneChallenge
            place={place}
            held={held}
            id={openId}
            busy={busy !== null && busy.id === openId ? busy.doing : null}
            said={said[openId]}
            top={top}
            bottom={bottom}
            onPress={(challenge, doing) => void press(challenge, doing)}
            onAgain={again}
            onReadAgain={() => void load(true)}
            onClose={() => {
              setOpenId(null);
            }}
            {...(onChanged === undefined ? {} : { onChanged })}
          />
        )}
      </Modal>
    </>
  );
}

function BackButton({ top, onPress }: { top: number; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onPress} style={[styles.back, { top: top + BACK_TOP }]}>
      <Icon name="back" size={18} />
    </Pressable>
  );
}

function ChallengeRow({ challenge, today, gymName, onOpen }: { challenge: MemberGymChallenge; today: string; gymName: string; onOpen: () => void }) {
  const chip = challengeChip(challenge, today);
  const line = rowLine(challenge, today, gymName);
  const mine = challenge.state === "running" && !challenge.cancelled ? progress(challenge) : null;
  const win = howToWin(challenge);
  return (
    <Pressable testID={`challenge-${challenge.id}`} accessibilityRole="button" accessibilityLabel={`${challenge.name}. ${chip.text}. ${win}.${line === null ? "" : ` ${line}`}`} onPress={onOpen}>
      <Card style={[styles.rowBox, challenge.cancelled ? styles.faded : null]}>
        <View style={styles.between}>
          <Txt kind="h3" style={[styles.grow, challenge.cancelled ? styles.struck : null]}>
            {challenge.name}
          </Txt>
          <Pill label={chip.text} tone={chip.tone} />
        </View>
        <Txt kind="small" colour="orange">
          {win}
        </Txt>
        {mine === null || mine.share === null ? null : <Steps share={mine.share} />}
        {line === null ? null : (
          <Txt kind="small" colour="text">
            {line}
          </Txt>
        )}
      </Card>
    </Pressable>
  );
}

function Fact({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <View style={styles.fact}>
      <Icon name={icon} size={16} colour="orange" />
      <Txt kind="small" colour="text" style={styles.grow}>
        {children}
      </Txt>
    </View>
  );
}

interface OneProps {
  place: ChallengesPlace;
  held: Held;
  id: string;
  busy: Doing | null;
  said: string | undefined;
  top: number;
  bottom: number;
  onPress: (challenge: MemberGymChallenge, doing: Doing) => void;
  onAgain: () => void;
  onReadAgain: () => void;
  onClose: () => void;
  onChanged?: () => void;
}

/** One challenge on a page of its own, always as the page's last read has it. */
function OneChallenge({ place, held, id, busy, said, top, bottom, onPress, onAgain, onReadAgain, onClose, onChanged }: OneProps) {
  const list = held.kind === "ok" ? held.list : null;
  const challenge = list === null ? undefined : list.challenges.find((c) => c.id === id);
  return (
    <View testID="challenge-page" accessibilityViewIsModal style={styles.page}>
      {challenge === undefined || list === null ? (
        <>
          <PictureTop picture="weeklychallenges" tall={PAGE_PICTURE_TALL} eyebrow={place.name} title="Challenges" />
          <View style={[styles.edge, styles.lines]}>
            {held.kind === "loading" ? (
              <Txt kind="small">Loading…</Txt>
            ) : held.kind === "failed" ? (
              <>
                <Txt colour="badText">{held.status === 404 ? challengesNotShown(place.name) : CHALLENGES_NOT_READ}</Txt>
                <Button label="Try again" kind="soft" small onPress={onAgain} />
              </>
            ) : (
              <Txt colour="text">{CHALLENGE_GONE}</Txt>
            )}
          </View>
        </>
      ) : (
        <Loaded place={place} list={list} challenge={challenge} busy={busy} said={said} top={top} bottom={bottom} onPress={onPress} onReadAgain={onReadAgain} {...(onChanged === undefined ? {} : { onChanged })} />
      )}
      <BackButton top={top} onPress={onClose} />
    </View>
  );
}

interface LoadedProps {
  place: ChallengesPlace;
  list: GymChallengesResponse;
  challenge: MemberGymChallenge;
  busy: Doing | null;
  said: string | undefined;
  top: number;
  bottom: number;
  onPress: (challenge: MemberGymChallenge, doing: Doing) => void;
  onReadAgain: () => void;
  onChanged?: () => void;
}

function Loaded({ place, list, challenge, busy, said, top, bottom, onPress, onReadAgain, onChanged }: LoadedProps) {
  const [box, setBox] = useState<"counts" | "leave" | null>(null);
  const [picking, setPicking] = useState<TeamLine | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const [person, setPerson] = useState<ProfilePerson | null>(null);
  const gym = place.name;
  const chip = challengeChip(challenge, list.today);
  const result = resultOf(challenge, list.today, gym);
  const teamed = inTeams(challenge);
  const teamsSaid = teamsLine(challenge, gym);
  const teamNote = myTeamNote(challenge, gym);
  const teamRule = teamRuleNote(challenge);
  const note = boardNote(challenge);
  const quiet = notCountingNote(challenge, list.checkingIn, gym);
  const join = joinNote(challenge);
  const waiting = challenge.state === "coming" && challenge.me !== null && challenge.who === "joined";
  const pressing = busy !== null;
  const pick = picking === null || !challenge.can.pick ? null : pickBox(challenge, picking.name);
  const leave = leaveBox(challenge);
  return (
    <>
      <ScrollView style={styles.grow} contentContainerStyle={{ paddingBottom: bottom + 24 }}>
        <PictureTop picture="weeklychallenges" tall={PAGE_PICTURE_TALL} eyebrow={gym} title={challenge.name} />
        <View style={[styles.edge, styles.lines]}>
          <View style={styles.between}>
            <Pill label={chip.text} tone={chip.tone} />
            <Button
              label="What counts"
              kind="quiet"
              say={`What ${challenge.name} counts`}
              onPress={() => {
                setBox("counts");
              }}
            />
          </View>
          <Txt kind="h3" colour="orange">
            {howToWin(challenge)}
          </Txt>
          <Fact icon="calendar">{challengeDates(challenge, list.today)}</Fact>
          <Fact icon="zap">{aboutLine(challenge)}</Fact>
          <Fact icon="users">{whoLine(challenge, gym)}</Fact>
          {teamsSaid === null ? null : <Fact icon="flag">{teamsSaid}</Fact>}
          {challenge.prize === "" ? null : <Fact icon="star">{`Prize: ${challenge.prize}`}</Fact>}
          {challenge.details === "" ? null : <Txt kind="small">{challenge.details}</Txt>}

          {challenge.cancelled ? (
            <Txt colour="text">{`${gym} cancelled this challenge.`}</Txt>
          ) : (
            <>
              {result === null ? null : (
                <Card testID="challenge-result" style={styles.winner}>
                  <Icon name="trophy" size={20} colour="gold" />
                  <View style={styles.grow}>
                    <Txt colour="text" style={styles.bold}>
                      {result.headline}
                    </Txt>
                    {result.mine === null ? null : <Txt kind="small">{result.mine}</Txt>}
                  </View>
                </Card>
              )}
              {waiting ? <Txt colour="goodText" style={styles.bold}>You’re in.</Txt> : null}
              {quiet === null ? null : (
                <Txt kind="small" colour="orange">
                  {quiet}
                </Txt>
              )}
              <Mine challenge={challenge} today={list.today} place={place} onReadAgain={onReadAgain} />
              {teamed ? (
                <Teams
                  challenge={challenge}
                  pressing={pressing}
                  onPick={(team) => {
                    setPicking(team);
                  }}
                />
              ) : (
                <Podium challenge={challenge} onPerson={setPerson} />
              )}
              {teamRule === null ? null : <Txt kind="small">{teamRule}</Txt>}
              {teamNote === null ? null : <Txt kind="small" colour="text">{teamNote}</Txt>}
              {note === null ? null : <Txt kind="small">{note}</Txt>}
              {!challenge.can.join ? null : (
                <Button
                  label="Join the challenge"
                  wide
                  busy={busy?.kind === "join"}
                  disabled={pressing}
                  say={`Join ${challenge.name}`}
                  onPress={() => {
                    onPress(challenge, { kind: "join" });
                  }}
                />
              )}
              {join === null ? null : <Txt kind="small">{join}</Txt>}
              {challenge.board.status !== "shown" ? null : (
                <Button
                  label={`${teamed ? "See everyone’s numbers" : "See the whole board"} (${challenge.board.ranked.toLocaleString("en")})`}
                  kind="plain"
                  small
                  wide
                  say={`See the whole board of ${challenge.name}`}
                  onPress={() => {
                    setBoardOpen(true);
                  }}
                />
              )}
              {!challenge.can.leave ? null : (
                <Button
                  label="Leave"
                  kind="quiet"
                  busy={busy?.kind === "leave"}
                  disabled={pressing}
                  say={`Leave ${challenge.name}`}
                  style={styles.middle}
                  onPress={() => {
                    setBox("leave");
                  }}
                />
              )}
            </>
          )}
          {said === undefined ? null : (
            <Txt kind="small" colour="badText">
              {said}
            </Txt>
          )}
        </View>
      </ScrollView>

      <Sheet
        open={box === "counts"}
        title="What counts"
        onClose={() => {
          setBox(null);
        }}
      >
        <Txt colour="text">{challenge.words.explain}</Txt>
      </Sheet>
      <Sheet
        open={box === "leave"}
        title={leave.title}
        onClose={() => {
          setBox(null);
        }}
      >
        <View style={styles.lines}>
          <Txt colour="text">{leave.line}</Txt>
          <Button
            label="Leave"
            kind="danger"
            wide
            say="Leave the challenge"
            onPress={() => {
              setBox(null);
              onPress(challenge, { kind: "leave" });
            }}
          />
          <Button
            label="Stay in"
            kind="quiet"
            style={styles.middle}
            onPress={() => {
              setBox(null);
            }}
          />
        </View>
      </Sheet>
      <Sheet
        open={pick !== null}
        title={pick?.title ?? ""}
        onClose={() => {
          setPicking(null);
        }}
      >
        {pick === null || picking === null ? null : (
          <View style={styles.lines}>
            <Txt colour="text">{pick.line}</Txt>
            <Button
              label={pick.yes}
              wide
              say={`Yes, ${pick.yes}`}
              onPress={() => {
                const { id } = picking;
                setPicking(null);
                onPress(challenge, { kind: "pick", teamId: id });
              }}
            />
            <Button
              label="Not now"
              kind="quiet"
              style={styles.middle}
              onPress={() => {
                setPicking(null);
              }}
            />
          </View>
        )}
      </Sheet>
      <PersonProfile
        place={place}
        person={person}
        period={PROFILE_PERIOD}
        onClose={() => {
          setPerson(null);
        }}
        {...(onChanged === undefined ? {} : { onChanged })}
      />
      <WholeBoard
        open={boardOpen}
        place={place}
        challenge={challenge}
        timezone={list.timezone}
        top={top}
        bottom={bottom}
        onClose={() => {
          setBoardOpen(false);
          // Places move while the board is open: this page says the same as it.
          onReadAgain();
        }}
        {...(onChanged === undefined ? {} : { onChanged })}
      />
    </>
  );
}

/** The member's number: how far, what is left, their place, and each counted day as a flame. */
function Mine({ challenge, today, place, onReadAgain }: { challenge: MemberGymChallenge; today: string; place: ChallengesPlace; onReadAgain: () => void }) {
  const [box, setBox] = useState<"board" | "name" | null>(null);
  const mine = progress(challenge);
  if (mine === null || challenge.me === null || challenge.state === "coming") return null;
  const where = placeLine(challenge);
  const { hidden } = challenge.me;
  return (
    <Card testID="challenge-mine" style={[styles.mine, mine.done ? styles.mineDone : null]}>
      <View style={styles.between}>
        <Txt style={styles.grow}>
          <Txt kind="h1">{printed(mine.big, challenge.words)}</Txt>
          <Txt kind="small" colour="text">
            {mine.of === null ? (mine.unit === "" ? "" : ` ${mine.unit}`) : ` of ${printed(mine.of, challenge.words)}${mine.unit === "" ? "" : ` ${mine.unit}`}`}
          </Txt>
        </Txt>
        {mine.done ? <Pill label="Done" tone="orange" icon="check" /> : null}
      </View>
      {mine.share === null ? null : <Steps share={mine.share} />}
      {mine.note === null ? null : (
        <Txt kind="small" colour={mine.done ? "orange" : "text"}>
          {mine.note}
        </Txt>
      )}
      {where === null ? null : (
        <Txt kind="small" colour="text">
          {where}
        </Txt>
      )}
      {hidden === null ? null : <Txt kind="small">{hiddenText(hidden, place.name)}</Txt>}
      {hidden === "hide_me" || hidden === "under_18" ? (
        <Button
          label="Change Hide me"
          kind="link"
          say="Change Hide me on the Leaderboard"
          style={styles.start}
          onPress={() => {
            setBox("board");
          }}
        />
      ) : null}
      {hidden === "no_name" ? (
        <Button
          label="Add your name"
          kind="link"
          style={styles.start}
          onPress={() => {
            setBox("name");
          }}
        />
      ) : null}
      <Flames challenge={challenge} today={today} />
      <LeaderboardPage
        place={box === "board" ? place : null}
        onClose={() => {
          setBox(null);
          onReadAgain();
        }}
      />
      <Sheet
        open={box === "name"}
        title="Your full name"
        onClose={() => {
          setBox(null);
        }}
      >
        {box === "name" ? (
          <NameBox
            onSaved={() => {
              setBox(null);
              onReadAgain();
              return Promise.resolve(true);
            }}
          />
        ) : null}
      </Sheet>
    </Card>
  );
}

function Flames({ challenge, today }: { challenge: MemberGymChallenge; today: string }) {
  const marks = dayMarks(challenge, today);
  if (marks === null) return null;
  return (
    <View style={styles.flames}>
      <View style={styles.week}>
        {WEEKDAYS.map((letter, i) => (
          <View key={`${letter}${String(i)}`} style={styles.flameCell}>
            <Txt kind="tiny">{letter}</Txt>
          </View>
        ))}
      </View>
      {marks.weeks.map((week, w) => (
        <View key={String(w)} style={styles.week}>
          {week.map((cell, i) =>
            cell === null ? (
              <View key={`out-${String(i)}`} style={styles.flameCell} />
            ) : (
              <View key={cell.day} accessible accessibilityRole="image" accessibilityLabel={markLabel(cell, challenge.words)} style={[styles.flameCell, cell.state === "yes" ? styles.lit : null, cell.state === "open" ? styles.open : null]}>
                <Icon name="flame" size={18} colour={cell.state === "yes" || cell.state === "open" ? "orange" : "textFaint"} filled={cell.state === "yes"} />
              </View>
            ),
          )}
        </View>
      ))}
      {marks.whole ? null : <Txt kind="tiny">This week. Your number counts every day of the challenge.</Txt>}
    </View>
  );
}

function Initials({ text }: { text: string }) {
  return (
    <View style={styles.initials}>
      <Txt kind="small" colour="orange" numberOfLines={1}>
        {text}
      </Txt>
    </View>
  );
}

const MEDAL: Record<number, "gold" | "text" | "orangeLight"> = { 1: "gold", 2: "text", 3: "orangeLight" };

function Podium({ challenge, onPerson }: { challenge: MemberGymChallenge; onPerson: (person: ProfilePerson) => void }) {
  const { top } = challenge.board;
  if (top.length === 0) return null;
  return (
    <View style={styles.podium}>
      {top.map((row) => {
        const number = countText(row.value, challenge.words);
        const inside = (
          <>
            <Txt kind="small" colour={MEDAL[row.place] ?? "textSoft"} style={styles.bold}>
              {ordinal(row.place)}
            </Txt>
            <Initials text={row.isMe ? "You" : row.initials} />
            <Txt kind="small" colour="text" numberOfLines={1}>
              {row.isMe ? "You" : row.name}
            </Txt>
            <Txt kind="h3" style={styles.centre}>
              {printed(row.value, challenge.words)}
            </Txt>
            {row.reached ? (
              <Txt kind="tiny" colour="orange">
                Reached
              </Txt>
            ) : null}
          </>
        );
        const said = `${ordinal(row.place)}: ${row.isMe ? "you" : row.name}, ${number}${row.reached ? ", reached the target" : ""}`;
        const look = [styles.step, row.place === 1 ? styles.stepFirst : null, row.isMe ? styles.stepMine : null];
        if (row.isMe) {
          return (
            <View key={row.userId} accessible accessibilityLabel={said} style={look}>
              {inside}
            </View>
          );
        }
        return (
          <Pressable
            key={row.userId}
            accessibilityRole="button"
            accessibilityLabel={`${said}, see their profile`}
            style={look}
            onPress={() => {
              onPerson({ userId: row.userId, name: row.name, initials: row.initials });
            }}
          >
            {inside}
          </Pressable>
        );
      })}
    </View>
  );
}

function Teams({ challenge, pressing, onPick }: { challenge: MemberGymChallenge; pressing: boolean; onPick: (team: TeamLine) => void }) {
  const rows = teamRows(challenge);
  const mine = myTeam(challenge);
  if (rows.length === 0) return null;
  return (
    <View style={styles.lines}>
      {rows.map((team) => (
        <Card key={team.id} testID={`team-${team.id}`} style={[styles.team, team.isMine ? styles.mineDone : null]}>
          <View style={styles.between} accessible accessibilityLabel={team.label}>
            <Txt kind="small" colour={team.place === null ? "textSoft" : (MEDAL[team.place] ?? "textSoft")} style={styles.teamPlace}>
              {team.place === null ? "–" : ordinal(team.place)}
            </Txt>
            <View style={styles.grow}>
              <Txt kind="h3">{team.name}</Txt>
              <Txt kind="small">{team.people}</Txt>
            </View>
            {team.isMine ? <Pill label="Your team" tone="orange" /> : null}
            {team.number === null ? null : (
              <Txt kind="small" colour="text" style={styles.bold}>
                {team.number}
              </Txt>
            )}
          </View>
          {team.reached ? (
            <Txt kind="tiny" colour="orange">
              Reached
            </Txt>
          ) : null}
          {challenge.can.pick && !team.isMine ? (
            <Button
              label={challenge.teamBoard?.mine === null ? "Join team" : "Move here"}
              kind={challenge.teamBoard?.mine === null ? "main" : "plain"}
              small
              disabled={pressing}
              say={`${challenge.teamBoard?.mine === null ? "Join" : "Move to"} ${team.name}`}
              style={styles.start}
              onPress={() => {
                onPick(team);
              }}
            />
          ) : null}
        </Card>
      ))}
      {mine === null ? null : (
        <Card style={styles.team}>
          <Txt kind="small" colour="text" style={styles.bold}>{`Your team: ${mine.name}`}</Txt>
          {mine.people.map((p) => (
            <View key={p.userId} style={styles.person}>
              <Initials text={p.initials} />
              <Txt colour="text" numberOfLines={1} style={styles.grow}>
                {p.name}
              </Txt>
              {p.number === null ? null : <Txt kind="small" colour="text">{p.number}</Txt>}
            </View>
          ))}
          {mine.more === null ? null : <Txt kind="small">{mine.more}</Txt>}
          {mine.note === null ? null : <Txt kind="small">{mine.note}</Txt>}
        </Card>
      )}
    </View>
  );
}

type BoardHeld = { kind: "loading" } | { kind: "failed" } | { kind: "ok"; board: GymChallengeBoardResponse };

interface WholeBoardProps {
  open: boolean;
  place: ChallengesPlace;
  challenge: MemberGymChallenge;
  timezone: string;
  top: number;
  bottom: number;
  onClose: () => void;
  onChanged?: () => void;
}

/** The first hundred, with the member's own line under them; a name opens that person's profile. */
function WholeBoard({ open, place, challenge, timezone, top, bottom, onClose, onChanged }: WholeBoardProps) {
  const { session } = useSession();
  const [held, setHeld] = useState<BoardHeld>({ kind: "loading" });
  const [person, setPerson] = useState<ProfilePerson | null>(null);
  const [round, setRound] = useState(0);
  const { width, height } = useWindowDimensions();
  const [scrolled, setScrolled] = useState(false);
  const { id } = challenge;

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    let number = 0;
    const read = async (quiet: boolean) => {
      number += 1;
      const mine = number;
      const answer = await session.signedIn({ method: "GET", path: boardPath(place.id, id) }, gymChallengeBoardResponseSchema);
      if (!live || mine !== number) return;
      // An answer about another challenge is never drawn as this one's.
      if (answer.kind === "ok" && answer.data.challengeId === id) setHeld({ kind: "ok", board: answer.data });
      else setHeld((was) => (quiet && was.kind === "ok" ? was : { kind: "failed" }));
    };
    setHeld({ kind: "loading" });
    void read(false);
    const back = AppState.addEventListener("change", (state) => {
      if (state === "active") void read(true);
    });
    return () => {
      live = false;
      back.remove();
    };
  }, [open, session, place.id, id, round]);

  const board = held.kind === "ok" ? held.board : null;
  const me = board?.me ?? null;
  const meInRows = board?.rows.some((r) => r.isMe) ?? false;
  const empty =
    held.kind === "loading" ? (
      <Txt kind="small">Loading…</Txt>
    ) : held.kind === "failed" ? (
      <View style={styles.lines}>
        <Txt colour="badText">{BOARD_NOT_READ}</Txt>
        <Button
          label="Try again"
          kind="soft"
          small
          onPress={() => {
            setRound((n) => n + 1);
          }}
        />
      </View>
    ) : (
      <Txt colour="text">The places show once 3 people have a number in this challenge.</Txt>
    );
  return (
    <Modal visible={open} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View testID="challenge-board" accessibilityViewIsModal style={styles.page}>
        <FlatList
          style={styles.grow}
          contentContainerStyle={styles.boardList}
          scrollEventThrottle={32}
          onScroll={(event) => {
            setScrolled(event.nativeEvent.contentOffset.y > pictureTopHeight(width, height, PAGE_PICTURE_TALL) - top - BACK_BAR);
          }}
          data={board?.rows ?? []}
          keyExtractor={(r) => r.userId}
          ListHeaderComponent={
            <View>
              <PictureTop picture="rank" tall={PAGE_PICTURE_TALL} eyebrow={challenge.name} title="The board" />
              <View style={styles.edge}>
                <Txt kind="tiny">
                  {`${howToWin(challenge)}${board === null ? "" : ` · ${board.ranked.toLocaleString("en")} on the board · ${updatedText(board.asOf, timezone, place.clockFormat)}`}`}
                </Txt>
              </View>
            </View>
          }
          ListEmptyComponent={<View style={styles.edge}>{empty}</View>}
          renderItem={({ item }) => (
            <BoardRow
              row={item}
              challenge={challenge}
              onPerson={() => {
                setPerson({ userId: item.userId, name: item.name, initials: item.initials });
              }}
            />
          )}
        />
        {scrolled ? (
          <View style={[styles.bar, { minHeight: top + BACK_BAR }]}>
            <Txt kind="h3" numberOfLines={1}>
              The board
            </Txt>
          </View>
        ) : null}
        <BackButton top={top} onPress={onClose} />
        {me === null || meInRows ? null : (
          <View testID="board-me" style={[styles.meBar, { paddingBottom: bottom + 10 }]}>
            <View style={[styles.meRow, me.hidden === null ? null : styles.faded]}>
              <Txt kind="h3" colour="textSoft" style={styles.place}>
                {me.place === null ? "–" : ordinal(me.place)}
              </Txt>
              <Txt kind="h3" style={styles.grow}>
                You
              </Txt>
              <Txt kind="h3">{printed(me.value, challenge.words)}</Txt>
            </View>
            {me.hidden === null ? null : <Txt kind="small">{hiddenText(me.hidden, place.name)}</Txt>}
            {me.hidden === null && me.place !== null ? <Txt kind="small">Members see the first 100. Your place is here.</Txt> : null}
          </View>
        )}
        <PersonProfile
          place={place}
          person={person}
          period={PROFILE_PERIOD}
          onClose={() => {
            setPerson(null);
          }}
          {...(onChanged === undefined ? {} : { onChanged })}
        />
      </View>
    </Modal>
  );
}

function BoardRow({ row, challenge, onPerson }: { row: GymChallengeRow; challenge: MemberGymChallenge; onPerson: () => void }) {
  const said = `${ordinal(row.place)}: ${row.isMe ? "you" : row.name}, ${countText(row.value, challenge.words)}${row.reached ? ", reached the target" : ""}`;
  const inside = (
    <>
      <Txt kind="h3" colour={row.place <= 3 ? "orange" : "textSoft"} style={styles.place}>
        {ordinal(row.place)}
      </Txt>
      <Initials text={row.isMe ? "You" : row.initials} />
      <Txt kind="h3" numberOfLines={1} style={styles.grow}>
        {row.isMe ? "You" : row.name}
      </Txt>
      {row.reached ? <Icon name="check" size={16} colour="orange" /> : null}
      <Txt kind="h3">{printed(row.value, challenge.words)}</Txt>
    </>
  );
  if (row.isMe) {
    return (
      <View accessible accessibilityLabel={said} style={[styles.boardRow, styles.boardMine]}>
        {inside}
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${said}, see their profile`} onPress={onPerson} style={styles.boardRow}>
      {inside}
    </Pressable>
  );
}

/** The Back button's place under the phone's clock, and the bar that holds it once the page has scrolled. */
const BACK_TOP = 12;
const BACK_BAR = BACK_TOP + sizes.press + 8;

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  grow: { flex: 1 },
  list: { gap: sizes.gap },
  edge: { paddingHorizontal: sizes.edge, paddingTop: 8 },
  lines: { gap: 10 },
  box: { padding: 16, gap: 10 },
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
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    justifyContent: "flex-end",
    paddingLeft: sizes.edge + sizes.press + 12,
    paddingRight: sizes.edge,
    paddingBottom: 8 + (sizes.press - 20) / 2,
    backgroundColor: colours.page,
    borderBottomWidth: 1,
    borderBottomColor: colours.lineStrong,
  },
  rowBox: { marginHorizontal: sizes.edge, padding: 14, gap: 6 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  fact: { flexDirection: "row", alignItems: "center", gap: 8 },
  faded: { opacity: 0.6 },
  struck: { textDecorationLine: "line-through" },
  bold: { fontFamily: fonts.bold },
  centre: { textAlign: "center" },
  start: { alignSelf: "flex-start" },
  middle: { alignSelf: "center" },
  winner: { flexDirection: "row", gap: 10, padding: 12, backgroundColor: colours.goldFill, borderColor: colours.goldLine },
  mine: { padding: 14, gap: 8 },
  mineDone: { backgroundColor: colours.orangeFill, borderColor: colours.orangeLine },
  flames: { gap: 4, marginTop: 4 },
  week: { flexDirection: "row" },
  flameCell: { flex: 1, alignItems: "center", minHeight: 20 },
  lit: { filter: [{ dropShadow: { offsetX: 0, offsetY: 0, standardDeviation: 3, color: colours.orange } }] },
  open: { opacity: 0.55 },
  initials: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.orangeFill,
    borderWidth: 1,
    borderColor: colours.orangeLine,
  },
  podium: { flexDirection: "row", gap: 8 },
  step: { flex: 1, alignItems: "center", gap: 4, padding: 10, borderRadius: 16, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.fill },
  stepFirst: { backgroundColor: colours.goldFill, borderColor: colours.goldLine },
  stepMine: { backgroundColor: colours.orangeFill, borderColor: colours.orangeLine },
  team: { padding: 12, gap: 8 },
  teamPlace: { minWidth: 30, fontFamily: fonts.bold },
  person: { flexDirection: "row", alignItems: "center", gap: 10 },
  boardList: { gap: 6, paddingBottom: 16 },
  boardRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: sizes.press, marginHorizontal: sizes.edge - 8, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 14 },
  boardMine: { backgroundColor: colours.orangeFill },
  place: { minWidth: 40, textAlign: "right" },
  meBar: { borderTopWidth: 1, borderTopColor: colours.lineStrong, backgroundColor: colours.box, paddingHorizontal: sizes.edge, paddingTop: 10, gap: 4 },
  meRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: sizes.press },
});
