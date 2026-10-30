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
// The phone's own files: a screen test that logs a meal hands the app its own store
// (`mealStore`); every other test gets this one, in memory, which forgets nothing between tests.
jest.mock("expo-file-system", () => {
  const files = new Map();
  class File {
    constructor(dir, name) {
      this.uri = `${dir.uri}/${name}`;
    }
    get exists() {
      return files.has(this.uri);
    }
    text() {
      return Promise.resolve(files.get(this.uri) ?? "");
    }
    create() {
      files.set(this.uri, "");
    }
    delete() {
      files.delete(this.uri);
    }
    write(text) {
      files.set(this.uri, text);
    }
    move(to) {
      files.set(to.uri, files.get(this.uri));
      files.delete(this.uri);
      this.uri = to.uri;
      return Promise.resolve();
    }
  }
  // A download is a test's to answer (`File.downloadFileAsync.mockImplementation`); by default it lands.
  File.downloadFileAsync = jest.fn((_url, to) => {
    files.set(to.uri, "photo");
    return Promise.resolve(to);
  });
  const folders = new Set();
  class Directory {
    constructor(dir, name) {
      this.uri = `${dir.uri}/${name}`;
    }
    get exists() {
      return folders.has(this.uri);
    }
    create() {
      folders.add(this.uri);
    }
    delete() {
      folders.delete(this.uri);
      for (const uri of [...files.keys()]) if (uri.startsWith(`${this.uri}/`)) files.delete(uri);
    }
  }
  return { File, Directory, Paths: { document: { uri: "documents" }, cache: { uri: "cache" } } };
});
