import { useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import type { GymPostReaction } from "@app/shared";
import { colours, sizes } from "../../look/colours";
import { Icon, type IconName } from "../../look/Icon";
import { fonts, Txt } from "../../look/Txt";
import { reactionButtons, reactionSummary, type Reactable } from "./updatesView";

const REACTION_ICONS: Readonly<Record<GymPostReaction, IconName>> = { like: "like", love: "heart", strong: "strong", fire: "flame" };

/** One button until it is tapped; then the four reactions, and picking one closes them (Kd's click-through, 2026-10-30).
 *  `onPicking` says while the four are open, so what sits beside them can make room. */
export function Reactions({ item, what, busy, onReact, onPicking }: { item: Reactable; what: string; busy: boolean; onReact: (reaction: GymPostReaction) => void; onPicking?: (picking: boolean) => void }) {
  const [picking, setPickingNow] = useState(false);
  const setPicking = (next: boolean) => {
    setPickingNow(next);
    onPicking?.(next);
  };
  const summary = reactionSummary(item, what);
  if (picking) {
    return (
      <>
        {reactionButtons(item).map((r) => (
          <Pressable
            key={r.id}
            testID={`react-${r.id}`}
            accessibilityRole="button"
            accessibilityLabel={r.label}
            accessibilityState={{ selected: r.mine, disabled: busy }}
            disabled={busy}
            onPress={() => {
              setPicking(false);
              onReact(r.id);
            }}
            style={[styles.reaction, r.mine ? styles.reactionMine : null]}
          >
            <Icon name={REACTION_ICONS[r.id]} size={16} colour={r.mine ? "orange" : "textSoft"} />
            {r.count > 0 ? (
              <Txt kind="small" colour={r.mine ? "orange" : "textSoft"} style={styles.bold}>
                {r.count.toLocaleString("en")}
              </Txt>
            ) : null}
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close reactions"
          onPress={() => {
            setPicking(false);
          }}
          style={styles.reaction}
        >
          <Icon name="x" size={16} colour="textSoft" />
        </Pressable>
      </>
    );
  }
  return (
    <Pressable
      testID="react-open"
      accessibilityRole="button"
      accessibilityLabel={summary.label}
      accessibilityState={{ selected: item.mine !== null, disabled: busy }}
      disabled={busy}
      onPress={() => {
        setPicking(true);
      }}
      style={[styles.reaction, item.mine === null ? null : styles.reactionMine]}
    >
      {summary.given.length === 0 ? (
        <>
          <Icon name="smileplus" size={16} colour="textSoft" />
          <Txt kind="small" colour="textSoft" style={styles.bold}>
            React
          </Txt>
        </>
      ) : (
        <>
          {summary.given.map((r) => (
            <Icon key={r.id} name={REACTION_ICONS[r.id]} size={16} colour={r.mine ? "orange" : "textSoft"} />
          ))}
          <Txt kind="small" colour={item.mine === null ? "textSoft" : "orange"} style={styles.bold}>
            {summary.total.toLocaleString("en")}
          </Txt>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bold: { fontFamily: fonts.bold },
  reaction: {
    minHeight: sizes.press,
    minWidth: sizes.press,
    paddingHorizontal: 12,
    borderRadius: sizes.round,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colours.fill,
    borderWidth: 1,
    borderColor: colours.line,
  },
  reactionMine: { backgroundColor: colours.orangeFill, borderColor: colours.orangeLine },
});
