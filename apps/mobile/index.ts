import { registerRootComponent } from "expo";
import { App } from "./src/App";
import { startPushTask } from "./src/notifications/drawn";

// Before anything else: Android runs the bundle with the app closed to draw a notification.
startPushTask();

registerRootComponent(App);
