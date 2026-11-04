import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { CoverPage } from "../../look/CoverPage";
import { pictures } from "../../look/pictures";
import { BodyTab } from "./BodyTab";
import { CalendarTab } from "./CalendarTab";
import { Overview } from "./Overview";
import { Hero, type TabKey } from "./parts";
import { Trends } from "./Trends";

// Me → Progress (ROADMAP Stage 5 35c-i; Kd's drawing of 2026-11-04, reviews/35c-i-progress-mock-6-tabs.png):
// the browser's Progress page in four tabs under the bandage, each box over a chalk drawing.

export { RECORDS_READ, PREDICTIONS_READ } from "./Overview";
export { trendRead, distributionRead } from "./Trends";
export { HEATMAP_READ } from "./CalendarTab";
export { MEASUREMENTS_READ } from "./BodyTab";

export function ProgressPage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<TabKey>("overview");
  return (
    <CoverPage open={open} title="Progress" onClose={onClose} hero={<Hero tab={tab} onTab={setTab} />}>
      {open ? (
        <View style={styles.tab}>
          {/* The bandage again, faint, behind the first boxes of every tab. */}
          <Image source={pictures.progress} resizeMode="contain" accessible={false} style={styles.behind} />
          {/* A tab's boxes are drawn again each time it is opened, so they rise in again. */}
          <View key={tab} style={styles.boxes}>
            {tab === "overview" ? <Overview /> : tab === "trends" ? <Trends /> : tab === "calendar" ? <CalendarTab /> : <BodyTab />}
          </View>
        </View>
      ) : null}
    </CoverPage>
  );
}

const styles = StyleSheet.create({
  tab: { gap: 14 },
  boxes: { gap: 14 },
  behind: { position: "absolute", top: 120, left: "-45%", width: "150%", height: 640, opacity: 0.32, transform: [{ scaleX: -1 }, { rotate: "-8deg" }] },
});
