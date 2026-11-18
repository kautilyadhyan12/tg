package com.google.mediapipe.tasks.vision.poselandmarker;

import com.google.mediapipe.calculator.proto.InferenceCalculatorProto.InferenceCalculatorOptions.Delegate.Xnnpack;
import com.google.mediapipe.framework.image.MPImage;
import com.google.mediapipe.proto.CalculatorOptionsProto.CalculatorOptions;
import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.core.ErrorListener;
import com.google.mediapipe.tasks.core.OutputHandler.ResultListener;
import com.google.mediapipe.tasks.core.proto.AccelerationProto.Acceleration;
import com.google.mediapipe.tasks.core.proto.BaseOptionsProto;
import com.google.mediapipe.tasks.vision.core.RunningMode;
import com.google.mediapipe.tasks.vision.poselandmarker.proto.PoseLandmarkerGraphOptionsProto.PoseLandmarkerGraphOptions;
import java.util.Optional;

/**
 * The phone test (ROADMAP Stage 5 item 51b): the pose model on the main chip with a set number of cores. Google's
 * Android door to the library (tasks-vision 1.0.0) has no such setting: its main chip is plain TensorFlow Lite with
 * the thread count left to the library (BaseOptionsUtils), which 51a measured. The library's own settings have one
 * (Acceleration.xnnpack.num_threads, read by its model graph), so these options are the caller's own, every one of
 * them handed on as it was built, and only the chip's part of the library's settings is replaced. The options'
 * reading methods are the package's own, which is why this file lives in the library's package. A folder's copy only
 * (src/debug); the store's app holds none of it.
 */
public final class PhoneTestCores extends PoseLandmarker.PoseLandmarkerOptions {
  private final PoseLandmarker.PoseLandmarkerOptions options;
  private final int threads;

  private PhoneTestCores(PoseLandmarker.PoseLandmarkerOptions options, int threads) {
    this.options = options;
    this.threads = threads;
  }

  /** These options, read on the main chip with this many cores. */
  public static PoseLandmarker.PoseLandmarkerOptions onCores(PoseLandmarker.PoseLandmarkerOptions options, int threads) {
    if (threads < 1 || threads > 8) throw new IllegalArgumentException("The main chip takes 1 to 8 cores.");
    return new PhoneTestCores(options, threads);
  }

  @Override
  BaseOptions baseOptions() {
    return options.baseOptions();
  }

  @Override
  RunningMode runningMode() {
    return options.runningMode();
  }

  @Override
  Optional<Integer> numPoses() {
    return options.numPoses();
  }

  @Override
  Optional<Float> minPoseDetectionConfidence() {
    return options.minPoseDetectionConfidence();
  }

  @Override
  Optional<Float> minPosePresenceConfidence() {
    return options.minPosePresenceConfidence();
  }

  @Override
  Optional<Float> minTrackingConfidence() {
    return options.minTrackingConfidence();
  }

  @Override
  boolean outputSegmentationMasks() {
    return options.outputSegmentationMasks();
  }

  @Override
  Optional<ResultListener<PoseLandmarkerResult, MPImage>> resultListener() {
    return options.resultListener();
  }

  @Override
  Optional<ErrorListener> errorListener() {
    return options.errorListener();
  }

  /** The library's settings as the caller's options make them, the main chip's plain reader replaced by the same
   *  library's XNNPACK reader on this many cores. Anything but the main chip is refused, never changed. */
  @Override
  public CalculatorOptions convertToCalculatorOptionsProto() {
    CalculatorOptions all = options.convertToCalculatorOptionsProto();
    PoseLandmarkerGraphOptions graph = all.getExtension(PoseLandmarkerGraphOptions.ext);
    BaseOptionsProto.BaseOptions base = graph.getBaseOptions();
    if (!base.getAcceleration().hasTflite()) throw new IllegalStateException("Cores are set for the main chip only.");
    BaseOptionsProto.BaseOptions onCores =
        base.toBuilder()
            .setAcceleration(Acceleration.newBuilder().setXnnpack(Xnnpack.newBuilder().setNumThreads(threads)))
            .build();
    return all.toBuilder()
        .setExtension(PoseLandmarkerGraphOptions.ext, graph.toBuilder().setBaseOptions(onCores).build())
        .build();
  }
}
