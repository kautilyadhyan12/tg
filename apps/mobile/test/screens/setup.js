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
      this.uri = name === undefined ? dir : `${dir.uri}/${name}`;
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
    base64() {
      return files.has(this.uri) ? Promise.resolve(files.get(this.uri)) : Promise.reject(new Error("no such file"));
    }
    move(to) {
      files.set(to.uri, files.get(this.uri));
      files.delete(this.uri);
      this.uri = to.uri;
      return Promise.resolve();
    }
  }
  // A download is a test's to answer (`File.downloadFileAsync.mockImplementation`); by default it lands.
  // As on the phone: a folder that is gone refuses the file, and a download stopped before it lands writes nothing.
  const folders = new Set();
  File.downloadFileAsync = jest.fn((_url, to, options) => {
    if (options?.signal?.aborted) return Promise.reject(new Error("The operation was aborted."));
    if (!folders.has(to.uri.slice(0, to.uri.lastIndexOf("/")))) return Promise.reject(new Error("no such folder"));
    files.set(to.uri, "photo");
    return Promise.resolve(to);
  });
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
// The camera, the gallery and the drawing of a photo are the phone's own (33b-i). A test says what
// each gives back (`camera`, `picker.next`, `drawing.base64`) and reads what was asked of it.
jest.mock("expo-camera", () => {
  const { createElement, forwardRef, useEffect, useImperativeHandle, useState } = require("react");
  const { View } = require("react-native");
  const granted = { granted: true, canAskAgain: true, status: "granted", expires: "never" };
  const camera = { permission: granted, afterAsk: granted, asked: 0, pictures: 0, fails: false };
  const CameraView = forwardRef(function CameraView(props, ref) {
    useImperativeHandle(ref, () => ({
      takePictureAsync: () => {
        camera.pictures += 1;
        return camera.fails ? Promise.reject(new Error("camera")) : Promise.resolve({ uri: "file:///camera/photo.jpg", width: 4000, height: 3000 });
      },
    }));
    // Once a view, as an iPhone does.
    const { onCameraReady } = props;
    useEffect(() => {
      onCameraReady?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return createElement(View, { testID: "camera-view", facing: props.facing, enableTorch: props.enableTorch, barcodeScannerSettings: props.barcodeScannerSettings, onBarcodeScanned: props.onBarcodeScanned });
  });
  function useCameraPermissions() {
    const [now, setNow] = useState(camera.permission);
    const ask = () => {
      camera.asked += 1;
      setNow(camera.afterAsk);
      return Promise.resolve(camera.afterAsk);
    };
    return [now, ask, ask];
  }
  return { CameraView, useCameraPermissions, camera };
});
jest.mock("expo-image-picker", () => {
  const picker = { next: { canceled: true, assets: null }, opened: 0 };
  return {
    picker,
    launchImageLibraryAsync: jest.fn(() => {
      picker.opened += 1;
      return Promise.resolve(picker.next);
    }),
  };
});
jest.mock("expo-image-manipulator", () => {
  // `base64`: what the drawing gives back (`queue`, where set, first); `sizes`: each size it was asked to draw; `saves`: how it was asked to save.
  const drawing = { base64: "", queue: [], sizes: [], saves: [], fails: false };
  const image = (size) => ({
    width: size.width,
    height: size.height,
    saveAsync: (options) => {
      drawing.saves.push({ format: options?.format, compress: options?.compress });
      if (drawing.fails) return Promise.reject(new Error("drawing"));
      const base64 = drawing.queue.shift() ?? drawing.base64;
      return Promise.resolve({ uri: "file:///cache/small.jpg", ...size, ...(options?.base64 ? { base64 } : {}) });
    },
  });
  const manipulate = (source) => {
    let size = typeof source === "string" ? { width: 3000, height: 4000 } : { width: source.width, height: source.height };
    const context = {
      resize: (to) => {
        size = { width: to.width ?? size.width, height: to.height ?? size.height };
        drawing.sizes.push(size);
        return context;
      },
      renderAsync: () => Promise.resolve(image(size)),
    };
    return context;
  };
  return { drawing, ImageManipulator: { manipulate }, SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" } };
});
