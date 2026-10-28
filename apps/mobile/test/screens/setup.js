// The phone's own bars are measured by Android; a test gives the screen a plain one.
jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);
// The robot check's web page runs only on a phone. A test's box is a plain view, and each box
// drawn is kept (`boxes`, newest last, `gone` once closed), so a test can say back what
// Cloudflare's box would.
jest.mock("react-native-webview", () => {
  const { createElement, useEffect, useRef } = require("react");
  const { View } = require("react-native");
  const boxes = [];
  function WebView(props) {
    const self = useRef(null);
    if (self.current === null) {
      self.current = { props, gone: false };
      boxes.push(self.current);
    }
    self.current.props = props;
    useEffect(() => () => {
      self.current.gone = true;
    }, []);
    return createElement(View, { testID: props.testID });
  }
  return { WebView, boxes };
});
// Google's package runs only on a phone; a screen test hands the app its own Google instead.
jest.mock("react-native-nitro-google-signin", () => ({ GoogleOneTapSignIn: {} }));
// The screen's brightness and keeping it awake are the phone's own; a test reads what was asked.
jest.mock("expo-brightness", () => ({
  getBrightnessAsync: jest.fn(() => Promise.resolve(0.4)),
  setBrightnessAsync: jest.fn(() => Promise.resolve()),
  restoreSystemBrightnessAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: jest.fn(() => Promise.resolve()),
  deactivateKeepAwake: jest.fn(() => Promise.resolve()),
}));
