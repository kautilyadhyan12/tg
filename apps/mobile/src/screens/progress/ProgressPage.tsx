import { useEffect, useRef, useState, type ComponentType } from "react";
import { Animated, Image, StyleSheet, View } from "react-native";
import { CoverPage } from "../../look/CoverPage";
import { useMotion } from "../../look/Motion";
import { pictures } from "../../look/pictures";
import { BodyTab } from "./BodyTab";
import { CalendarTab } from "./CalendarTab";
import { Overview } from "./Overview";
import { Hero, TABS, type TabKey } from "./parts";
import { Trends } from "./Trends";

// Me → Progress (ROADMAP Stage 5 35c-i; Kd's drawing of 2026-11-04, reviews/35c-i-progress-mock-6-tabs.png):
// the browser's Progress page in four tabs under the bandage, each box over a chalk drawing.

export { RECORDS_READ, PREDICTIONS_READ } from "./Overview";
export { trendRead, distributionRead } from "./Trends";
export { HEATMAP_READ } from "./CalendarTab";
export { MEASUREMENTS_READ } from "./BodyTab";

const TAB_PAGES: Record<TabKey, ComponentType> = { overview: Overview, trends: Trends, calendar: CalendarTab, body: BodyTab };

export function ProgressPage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<TabKey>("overview");
  const motion = useMotion();
  const shown = useRef(new Animated.Value(1)).current;
  // A tab picked fades in over a fifth of a second; its boxes were already drawn.
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
  return (
    <CoverPage open={open} title="Progress" onClose={onClose} hero={<Hero tab={tab} onTab={setTab} />}>
      {open ? (
        <View style={styles.tab}>
          {/* The bandage again, faint, behind the first boxes of every tab. */}
          <Image source={pictures.progress} resizeMode="contain" accessible={false} style={styles.behind} />
          {/* All four tabs are built, and read, when the page opens: a tab opens at once, its numbers
              already there (Kd's click-through: going from one to another lagged). */}
          {TABS.map((t) => {
            const Page = TAB_PAGES[t.key];
            return (
              <Animated.View key={t.key} style={[styles.boxes, tab === t.key ? { opacity: shown } : styles.away]}>
                <Page />
              </Animated.View>
            );
          })}
        </View>
      ) : null}
    </CoverPage>
  );
}

const styles = StyleSheet.create({
  tab: { gap: 14 },
  boxes: { gap: 14 },
  away: { display: "none" },
  behind: { position: "absolute", top: 120, left: "-45%", width: "150%", height: 640, opacity: 0.32, transform: [{ scaleX: -1 }, { rotate: "-8deg" }] },
});
