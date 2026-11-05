import { memo, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import type { LeaderboardResponse, LeaderboardRow, MyOrgsResponse } from "@app/shared";
import { Button } from "../../look/Button";
import { Chip } from "../../look/Chip";
import { colours, medal, medalShades, shadows } from "../../look/colours";
import { medalPicture } from "../../look/medals";
import { Txt } from "../../look/Txt";
import type { Read } from "../dashboard/useRead";
import { NOT_KNOWN } from "../dashboard/words";
import { LeaderboardPage, type LeaderboardPlace } from "../gym/Leaderboard";
import { BOARD_TABS, hiddenText, nextPlaceText, ordinal, rankWords, statusText, valueText } from "../gym/leaderboardView";
import { PersonProfile, type ProfilePerson } from "../gym/PersonProfile";
import { useGymRank } from "../gym/useGymRank";
import { COMING_SOON } from "../Soon";
import { laneShare } from "./achievementsRules";
import { PaintBox, Torch } from "./parts";

// Leaderboard: the person's gym's board, the same read as the Dashboard's Your Rank (this week, from Visits, moving on
// where the gym gives way to another board), as a list of race lanes over the Egyptian painting (Kd's drawing): each
// person's torch as far along their lane as their number goes against the leader's. Worldwide is item 38's.

const METALS = ["gold", "silver", "bronze"] as const;
const PLACE_COINS = ["place_1", "place_2", "place_3"] as const;

export const BoardTab = memo(function BoardTab({ places }: { places: Read<MyOrgsResponse> }) {
  const gyms = places.kind === "ok" ? places.data.orgs.filter((o) => o.isMember) : [];
  const [picked, setPicked] = useState<string | null>(null);
  const gym = gyms.find((g) => g.id === picked) ?? gyms[0] ?? null;
  const place: LeaderboardPlace | null = gym === null ? null : { id: gym.id, name: gym.name, clockFormat: gym.clockFormat };
  return (
    <View style={styles.list}>
      <View style={styles.chips}>
        {gyms.map((g) => (
          <Chip key={g.id} label={g.name} on={g.id === gym?.id} onPress={() => { setPicked(g.id); }} />
        ))}
        <View style={styles.soon} accessible accessibilityLabel={`Worldwide: ${COMING_SOON}`}>
          <Txt kind="small" colour="textSoft">Worldwide</Txt>
          <Txt kind="tiny">{COMING_SOON}</Txt>
        </View>
      </View>
      {places.kind === "loading" ? <Txt kind="small">{NOT_KNOWN}</Txt> : null}
      {place === null ? null : <GymBoard key={place.id} place={place} />}
    </View>
  );
});

function GymBoard({ place }: { place: LeaderboardPlace }) {
  const rank = useGymRank(place.id);
  const [full, setFull] = useState(false);
  const [person, setPerson] = useState<ProfilePerson | null>(null);
  const board = rank.read.kind === "ok" && rank.read.data.gymId === place.id ? rank.read.data : null;
  return (
    <>
      <PaintBox picture="egyptpush" height={168}>
        {board === null ? (
          rank.read.kind === "failed" ? (
            <>
              <Txt kind="small">The leaderboard couldn’t load.</Txt>
              <Button label="Try again" kind="link" onPress={rank.again} />
            </>
          ) : (
            <Txt kind="small">{NOT_KNOWN}</Txt>
          )
        ) : (
          <Top board={board} />
        )}
      </PaintBox>
      {board === null || statusText(board) !== null ? null : (
        <View style={styles.lanes}>
          {board.rows.map((row) => (
            <Lane
              key={row.userId}
              row={row}
              leader={board.rows[0]?.value ?? 0}
              board={board}
              onPress={() => {
                if (row.isMe) setFull(true);
                else setPerson({ userId: row.userId, name: row.name, initials: row.initials });
              }}
            />
          ))}
        </View>
      )}
      {board !== null && board.me.hidden === null && board.me.place !== null && !board.rows.some((r) => r.isMe) ? (
        <Txt kind="small" style={styles.centre}>{`Members see the top 100. You are ${ordinal(board.me.place)}.`}</Txt>
      ) : null}
      <Button label="See the full board" style={styles.middle} onPress={() => { setFull(true); }} />
      <LeaderboardPage
        place={full ? place : null}
        onClose={() => {
          setFull(false);
          rank.again();
        }}
      />
      <PersonProfile place={place} person={person} period="this_week" onClose={() => { setPerson(null); }} />
    </>
  );
}

/** The board's name and week, then the person's own place, big, or why they have none. */
function Top({ board }: { board: LeaderboardResponse }) {
  const tab = BOARD_TABS.find((t) => t.id === board.board)?.label ?? "";
  const words = rankWords(board);
  const status = statusText(board);
  const next = board.me.hidden === null ? nextPlaceText(board.me, board.board) : null;
  return (
    <>
      <Txt kind="h3">{board.board === "streak" ? tab : `${tab} · This week`}</Txt>
      <Txt kind="small">{status === null ? `${board.gymName} · ${String(board.ranked)} on the board` : board.gymName}</Txt>
      {status !== null ? (
        <Txt colour="text" style={styles.gap}>{status}</Txt>
      ) : (
        <View style={styles.mine}>
          {board.me.hidden !== null || board.me.place === null ? null : (
            <Txt kind="hero" colour="orange" style={styles.place}>
              {words.big}
            </Txt>
          )}
          <View style={styles.grow}>
            <Txt kind="small" colour="text">{board.me.hidden !== null ? hiddenText(board.me.hidden, board.gymName) : `Your place · ${valueText(board.me.value, board.board)}`}</Txt>
            {next === null ? null : <Txt kind="small" colour="orangeLight">{next}</Txt>}
          </View>
        </View>
      )}
    </>
  );
}

/** One person's lane: their place (a coin for the top three, a stone for the rest), their initials, their name, the
 *  torch as far along as their number goes against the leader's, and the number. */
function Lane({ row, leader, board, onPress }: { row: LeaderboardRow; leader: number; board: LeaderboardResponse; onPress: () => void }) {
  const top = row.place <= 3 ? row.place - 1 : null;
  const coin = top === null ? null : medalPicture(PLACE_COINS[top] ?? "");
  const metal = top === null ? null : METALS[top] ?? null;
  const torch = row.isMe ? colours.orange : metal === null ? medal.laneOther : medal[metal];
  const length = laneShare(row.value, leader);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${ordinal(row.place)}, ${row.isMe ? "you" : row.name}, ${valueText(row.value, board.board)}. ${row.isMe ? "See the full board" : "See their profile"}`}
      onPress={onPress}
      style={({ pressed }) => [styles.lane, row.isMe ? styles.laneMine : null, pressed ? styles.pressed : null]}
    >
      {coin === null ? (
        <View style={styles.stone}>
          <Txt kind="small" style={styles.stoneWords} numberOfLines={1} fit>
            {String(row.place)}
          </Txt>
        </View>
      ) : (
        <Image source={coin} accessible={false} style={styles.coin} />
      )}
      <View style={[styles.initials, row.isMe ? styles.initialsMine : metal === null ? null : styles[metal]]}>
        <Txt kind="small" colour={row.isMe ? "onOrange" : metal === null ? "textSoft" : "onBar"} style={styles.bold} numberOfLines={1} fit>
          {row.initials}
        </Txt>
      </View>
      <View style={styles.grow}>
        <Txt kind="strong" numberOfLines={1}>
          {row.isMe ? "You" : row.name}
        </Txt>
        <View style={styles.track}>
          <View style={styles.trackLine} />
          <View style={[styles.runRow, { flex: Math.max(length, 0.0001) }]}>
            {length > 0 ? <View style={[styles.run, { backgroundColor: torch }]} /> : null}
            <View style={styles.torch}>
              <Torch colour={torch} />
            </View>
          </View>
          <View style={{ flex: 1 - length }} />
        </View>
      </View>
      <View style={styles.value}>
        <Txt kind="big" colour={row.isMe ? "orange" : "text"}>
          {String(row.value)}
        </Txt>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  soon: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.glass },
  mine: { flexDirection: "row", alignItems: "flex-end", gap: 10, marginTop: 14 },
  place: { fontSize: 46, lineHeight: 50 },
  grow: { flex: 1, minWidth: 0 },
  gap: { marginTop: 12 },
  centre: { textAlign: "center" },
  middle: { alignSelf: "center" },
  lanes: { borderRadius: 22, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.box, overflow: "hidden", paddingVertical: 4 },
  lane: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, minHeight: 64, borderTopWidth: 1, borderTopColor: medal.laneLine },
  laneMine: { experimental_backgroundImage: medalShades.mine, boxShadow: medalShades.mineEdge },
  pressed: { opacity: 0.75 },
  coin: { width: 34, height: 34 },
  stone: { width: 30, height: 30, margin: 2, borderRadius: 15, alignItems: "center", justifyContent: "center", experimental_backgroundImage: medalShades.stone, backgroundColor: medal.stone },
  stoneWords: { color: medal.stoneText, fontWeight: "700" },
  initials: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colours.fill, paddingHorizontal: 3 },
  initialsMine: { backgroundColor: colours.orange, boxShadow: shadows.dotGlow },
  gold: { experimental_backgroundImage: medalShades.gold },
  silver: { experimental_backgroundImage: medalShades.silver },
  bronze: { experimental_backgroundImage: medalShades.bronze },
  bold: { fontWeight: "700" },
  track: { height: 22, marginTop: 4, marginRight: 12, flexDirection: "row", alignItems: "center" },
  trackLine: { position: "absolute", left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: medal.laneTrack },
  runRow: { height: 22, justifyContent: "center" },
  run: { height: 5, borderRadius: 3, opacity: 0.85 },
  torch: { position: "absolute", right: -9, top: -2 },
  value: { minWidth: 34, alignItems: "flex-end" },
});
