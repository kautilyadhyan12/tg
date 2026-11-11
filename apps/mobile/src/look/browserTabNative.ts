// A web page in a browser tab over the app: expo-web-browser's own Android and iPhone code. A copy of the app built before
// the package has none of it, nor do the tests, which hand in their own (test/screens/setup.js).
import { requireOptionalNativeModule } from "expo";

export interface BrowserTabNative {
  openBrowserAsync(url: string, options: Record<string, unknown>): Promise<{ type: string }>;
}

export const browserTabNative: BrowserTabNative | null = requireOptionalNativeModule<BrowserTabNative>("ExpoWebBrowser");
