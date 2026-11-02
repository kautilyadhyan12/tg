import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colours, sizes } from "./colours";
import { Icon, type IconName } from "./Icon";
import { fonts, Txt } from "./Txt";

/** The five tabs at the bottom; the one you are on is orange. `labels`: a word in place of a tab's own name;
 *  `dots`: what a tab's lit dot says to a screen reader ("new messages"), for a tab that has one lit. */
export function TabBar({
  state,
  navigation,
  icons,
  labels = {},
  dots = {},
}: BottomTabBarProps & { icons: Record<string, IconName>; labels?: Record<string, string>; dots?: Record<string, string> }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { height: sizes.tabBar + insets.bottom, paddingBottom: insets.bottom }]}>
      {state.routes.map((route, index) => {
        const on = state.index === index;
        const label = labels[route.name] ?? route.name;
        const dot = dots[route.name];
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={dot === undefined ? label : `${label}, ${dot}`}
            onPress={() => {
              const press = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!on && !press.defaultPrevented) navigation.navigate(route.name);
            }}
            style={styles.tab}
          >
            <View style={[styles.icon, on ? styles.iconOn : null]}>
              <Icon name={icons[route.name] ?? "grid"} size={22} colour={on ? "orange" : "textFaint"} />
              {dot === undefined ? null : <View testID={`dot-${route.name}`} style={styles.dot} />}
            </View>
            <Txt colour={on ? "orange" : "textFaint"} style={on ? styles.labelOn : styles.label}>
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colours.tabBar,
    borderTopWidth: 1,
    borderTopColor: colours.line,
  },
  tab: { flex: 1, minHeight: sizes.press, alignItems: "center", justifyContent: "center", gap: 3 },
  icon: {
    width: 52,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { position: "absolute", top: 2, right: 10, width: 9, height: 9, borderRadius: 5, backgroundColor: colours.orange, borderWidth: 1.5, borderColor: colours.tabBar },
  iconOn: { backgroundColor: colours.orangeFill, borderColor: colours.orangeLine },
  label: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
  labelOn: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14 },
});
