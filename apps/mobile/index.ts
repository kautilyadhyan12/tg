import { registerRootComponent } from "expo";
import { App } from "./src/App";
import { startPushTask } from "./src/notifications/drawn";
import { startRunTask } from "./src/screens/running/recorder";

// Before anything else: Android runs the bundle with the app closed to draw a notification, and to
// hand over a run's points.
startPushTask();
startRunTask();

registerRootComponent(App);
