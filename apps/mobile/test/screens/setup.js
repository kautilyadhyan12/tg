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
