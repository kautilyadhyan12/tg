import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { badgeListSchema, gamificationMeSchema, myOrgsResponseSchema, runRecordsSchema, weeklyChallengesSchema } from "@app/shared";
import { CoverPage } from "../../look/CoverPage";
import { useMotion } from "../../look/Motion";
import { useRead } from "../dashboard/useRead";
import { useZoneSaved } from "../../session/TimeZoneSync";
import { badgeCountWords, type TabKey } from "./achievementsRules";
import { BadgesTab } from "./BadgesTab";
import { BoardTab } from "./BoardTab";
import { ChallengesTab } from "./ChallengesTab";
import { Hero } from "./parts";
import { RECORDS_PATH } from "../running/runRecords";

// Me → Achievements (ROADMAP Stage 5 35c-iii; Kd's drawing of 2026-11-05, reviews/35c-iii-achievements-mock-4.png): the
// browser's Achievements page in three tabs under the goddess: Badges, Challenges and the Leaderboard. Every tab is
// built and read as the page opens, so a tab opens at once (Kd's click-through of Progress: going between tabs lagged).

export const ACHIEVEMENTS_READS = {
  me: "/v1/gamification/me",
  badges: "/v1/gamification/badges",
  challenges: "/v1/gamification/challenges",
  places: "/v1/orgs/mine",
  records: RECORDS_PATH,
} as const;

/** About how long the page takes to slide in. */
const SLIDE_MS = 400;

export function AchievementsPage({ open, start = "badges", onClose }: { open: boolean; start?: TabKey; onClose: () => void }) {
  const [tab, setTab] = useState<TabKey>(start);
  // "4 of 19 badges" over the goddess, from the Badges tab's own read.
  const [count, setCount] = useState<string | null>(null);
  useEffect(() => {
    if (open) setTab(start);
  }, [open, start]);
  return (
    <CoverPage open={open} title="Achievements" onClose={onClose} hero={open ? <Top tab={tab} onTab={setTab} badges={count} /> : <View />}>
      {open ? <Tabs tab={tab} onCount={setCount} /> : null}
    </CoverPage>
  );
}

function Top({ tab, onTab, badges }: { tab: TabKey; onTab: (t: TabKey) => void; badges: string | null }) {
  const zoneSaved = useZoneSaved();
  const me = useRead(ACHIEVEMENTS_READS.me, gamificationMeSchema, zoneSaved);
  // The badges' read awards a badge already reached, and its XP with it: the level is read again once they are in.
  const again = me.again;
  useEffect(() => {
    if (badges !== null) again();
  }, [badges, again]);
  return <Hero xp={me.read.kind === "ok" ? me.read.data.xp : null} failed={me.read.kind === "failed"} again={again} badges={badges} tab={tab} onTab={onTab} />;
}

function Tabs({ tab, onCount }: { tab: TabKey; onCount: (words: string | null) => void }) {
  const zoneSaved = useZoneSaved();
  const badges = useRead(ACHIEVEMENTS_READS.badges, badgeListSchema, zoneSaved);
  const countWords = badges.read.kind === "ok" ? badgeCountWords(badges.read.data.badges) : null;
  useEffect(() => {
    onCount(countWords);
  }, [countWords, onCount]);
  const challenges = useRead(ACHIEVEMENTS_READS.challenges, weeklyChallengesSchema);
  const places = useRead(ACHIEVEMENTS_READS.places, myOrgsResponseSchema);
  const records = useRead(ACHIEVEMENTS_READS.records, runRecordsSchema);
  const motion = useMotion();
  const shown = useRef(new Animated.Value(1)).current;
  // A tab picked fades in over a fifth of a second; its medals and lanes were already drawn.
  useEffect(() => {
    if (!motion) {
      shown.setValue(1);
      return;
    }
    shown.setValue(0);
    const run = Animated.timing(shown, { toValue: 1, duration: 200, useNativeDriver: true });
    run.start();
    return () => {
      run.stop();
    };
  }, [tab, motion, shown]);
  const page = (key: TabKey) => (tab === key ? { opacity: shown } : styles.away);
  // The tab opened first is built with the page; the other two once it has slid in, so opening never waits on them.
  const [rest, setRest] = useState(false);
  useEffect(() => {
    const later = setTimeout(() => {
      setRest(true);
    }, SLIDE_MS);
    return () => {
      clearTimeout(later);
    };
  }, []);
  const built = (key: TabKey) => key === tab || rest;
  return (
    <View>
      <Animated.View style={page("badges")}>{built("badges") ? <BadgesTab read={badges.read} again={badges.again} records={records.read} recordsAgain={records.again} /> : null}</Animated.View>
      <Animated.View style={page("challenges")}>{built("challenges") ? <ChallengesTab read={challenges.read} again={challenges.again} /> : null}</Animated.View>
      <Animated.View style={page("leaderboard")}>{built("leaderboard") ? <BoardTab places={places.read} /> : null}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  away: { display: "none" },
});
