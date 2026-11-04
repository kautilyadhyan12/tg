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
    get name() {
      return this.uri.slice(this.uri.lastIndexOf("/") + 1);
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
      const at = typeof dir === "string" ? dir : dir.uri;
      this.uri = name === undefined ? at : `${at}/${name}`;
    }
    get exists() {
      return folders.has(this.uri);
    }
    get name() {
      return this.uri.slice(this.uri.lastIndexOf("/") + 1);
    }
    /** What is right inside it, files and folders, as the phone lists them. */
    list() {
      const inside = (uri) => uri.startsWith(`${this.uri}/`) && !uri.slice(this.uri.length + 1).includes("/");
      return [...[...folders].filter(inside).map((uri) => new Directory({ uri })), ...[...files.keys()].filter(inside).map((uri) => new File(uri))];
    }
    create() {
      folders.add(this.uri);
    }
    delete() {
      folders.delete(this.uri);
      for (const uri of [...files.keys()]) if (uri.startsWith(`${this.uri}/`)) files.delete(uri);
    }
  }
  return { File, Directory, Paths: { document: new Directory({ uri: "documents" }), cache: new Directory({ uri: "cache" }) } };
});
// The phone's own Share box (19b): it takes a file's address; a test reads what it was given
// (`shareAsync.mock.calls`) or says it fails (`mockRejectedValueOnce`, `isAvailableAsync.mockResolvedValueOnce(false)`).
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));
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
// The phone's notifications (18b-i). A test says what Android answers (`notifications.permission`,
// `afterAsk`, `token`) and reads what was asked of it. Off by default, so no screen test meets the
// question it did not ask for.
jest.mock("expo-notifications", () => {
  const off = { granted: false, canAskAgain: false, status: "denied" };
  const notifications = {
    permission: off,
    afterAsk: off,
    asked: 0,
    token: "phone-address-1",
    presented: [],
    dismissed: [],
    dismissedAll: 0,
    unregistered: 0,
    taps: [],
    received: [],
    scheduled: [],
    tokenListeners: [],
    last: null,
    handler: null,
    channels: [],
    registeredTasks: [],
  };
  // Listeners stay: the app listens for taps from the moment it starts, once.
  const reset = () => {
    Object.assign(notifications, { permission: off, afterAsk: off, asked: 0, token: "phone-address-1", presented: [], dismissed: [], dismissedAll: 0, unregistered: 0, last: null, handler: null, channels: [], scheduled: [] });
  };
  return {
    notifications,
    reset,
    AndroidImportance: { DEFAULT: 5 },
    setNotificationHandler: (handler) => {
      notifications.handler = handler;
    },
    setNotificationChannelAsync: (id, channel) => {
      notifications.channels.push({ id, ...channel });
      return Promise.resolve(null);
    },
    getPermissionsAsync: () => Promise.resolve(notifications.permission),
    requestPermissionsAsync: () => {
      notifications.asked += 1;
      notifications.permission = notifications.afterAsk;
      return Promise.resolve(notifications.afterAsk);
    },
    getDevicePushTokenAsync: () => Promise.resolve({ type: "android", data: notifications.token }),
    addPushTokenListener: (listener) => {
      notifications.tokenListeners.push(listener);
      return { remove: () => { notifications.tokenListeners = notifications.tokenListeners.filter((one) => one !== listener); } };
    },
    addNotificationResponseReceivedListener: (listener) => {
      notifications.taps.push(listener);
      return { remove: () => { notifications.taps = notifications.taps.filter((one) => one !== listener); } };
    },
    addNotificationReceivedListener: (listener) => {
      notifications.received.push(listener);
      return { remove: () => { notifications.received = notifications.received.filter((one) => one !== listener); } };
    },
    scheduleNotificationAsync: (request) => {
      notifications.scheduled.push(request);
      return Promise.resolve(request.identifier ?? "scheduled");
    },
    getLastNotificationResponse: () => notifications.last,
    clearLastNotificationResponse: () => {
      notifications.last = null;
    },
    getPresentedNotificationsAsync: () => Promise.resolve(notifications.presented),
    dismissNotificationAsync: (id) => {
      notifications.dismissed.push(id);
      return Promise.resolve();
    },
    dismissAllNotificationsAsync: () => {
      notifications.dismissedAll += 1;
      return Promise.resolve();
    },
    registerTaskAsync: (name) => {
      notifications.registeredTasks.push(name);
      return Promise.resolve(null);
    },
    unregisterForNotificationsAsync: () => {
      notifications.unregistered += 1;
      return Promise.resolve();
    },
  };
});
// The task Android runs to draw a notification: its body is called by the tests themselves (drawPush).
jest.mock("expo-task-manager", () => {
  const tasks = new Map();
  return { tasks, defineTask: (name, task) => { tasks.set(name, task); } };
});
// The phone's own key store, for what is not the sign-in (the notifications' "Not now").
jest.mock("expo-secure-store", () => {
  const kept = new Map();
  return {
    kept,
    getItemAsync: (key) => Promise.resolve(kept.has(key) ? kept.get(key) : null),
    setItemAsync: (key, value) => {
      kept.set(key, value);
      return Promise.resolve();
    },
    deleteItemAsync: (key) => {
      kept.delete(key);
      return Promise.resolve();
    },
  };
});
