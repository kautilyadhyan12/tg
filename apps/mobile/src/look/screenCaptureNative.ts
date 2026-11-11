// Screenshots and screen recordings blanked (expo-screen-capture's Android code: the window marked secure). A copy of
// the app built before the package has none of it, nor do the tests, which hand in their own (test/screens/setup.js).
import { requireOptionalNativeModule } from "expo";

export interface ScreenCaptureNative {
  /** Mark the app's window secure: screenshots and recordings of it come out blank. */
  preventScreenCapture(): Promise<void>;
  /** Take the mark off again. */
  allowScreenCapture(): Promise<void>;
}

export const screenCaptureNative: ScreenCaptureNative | null = requireOptionalNativeModule<ScreenCaptureNative>("ExpoScreenCapture");
