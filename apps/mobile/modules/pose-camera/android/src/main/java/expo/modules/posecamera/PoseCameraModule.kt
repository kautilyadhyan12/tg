package expo.modules.posecamera

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The camera screen (ROADMAP Stage 5 item 53a): one view, the selfie camera's picture with the pose model reading it. The
// app's own code (apps/mobile/src/camera) turns each answer into the movement engine's frame and decides everything; this
// side only reads. No picture and no body point is ever written or sent from here: each answer goes to the screen and is
// gone.
class PoseCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PoseCamera")

    View(PoseCameraView::class) {
      Events("onPose", "onProblem")

      /** The camera and the model run while true, and are let go while false (a rest, a paused set, the screen gone). */
      Prop("active") { view: PoseCameraView, active: Boolean -> view.setActive(active) }
    }
  }
}
