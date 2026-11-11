// A payment company's own page in a browser tab over the app (Chrome's custom tab on Android, Safari's on an iPhone), so
// it can offer Google Pay or Apple Pay, which a page inside the app cannot. A copy of the app built before the tab opens
// the phone's own browser instead.
import { Linking, processColor } from "react-native";
import { browserTabNative } from "./browserTabNative";

/** How the page went away: on an iPhone the tab says when it is closed (`closed`); on Android the tab only opens, and the
 *  app learns they are back when it comes to the front again (`opened`). */
export type TabOpened = "opened" | "closed";

/** Opens `url` in a tab over the app, its bar the app's colour (`bar`) and its buttons the app's (`controls`); the phone's
 *  own browser where the tab is not built in. */
export async function openInTab(url: string, colours: { bar: string; controls: string }): Promise<TabOpened> {
  const native = browserTabNative;
  if (native === null) {
    await Linking.openURL(url);
    return "opened";
  }
  const result = await native.openBrowserAsync(url, {
    toolbarColor: processColor(colours.bar),
    secondaryToolbarColor: processColor(colours.bar),
    controlsColor: processColor(colours.controls),
    showTitle: true,
    enableDefaultShareMenuItem: false,
    showInRecents: false,
    enableBarCollapsing: false,
    dismissButtonStyle: "close",
  });
  return result.type === "opened" ? "opened" : "closed";
}
