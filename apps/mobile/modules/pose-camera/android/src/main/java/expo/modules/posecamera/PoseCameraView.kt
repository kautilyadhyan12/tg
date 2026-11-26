package expo.modules.posecamera

import android.content.Context
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.hardware.Sensor
import android.hardware.camera2.CameraCharacteristics
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.Range
import android.util.Size
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseCameraCores
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** The model the phone runs, put in the app by this module's build (build.gradle, checked by its SHA-256 there). */
private const val MODEL = "pose_landmarker_full.task"
private const val POINTS = 33
/** 51b-ii's pick: the full model on the main chip on 4 cores (on a phone with fewer, all of them). */
private const val CORES = 4
/** The model's own sureness settings, as every kept body-points file was measured with (phoneRun.ts SETTINGS). */
private const val SURE = 0.5f
/** The picture the model reads, upright, as 51b-ii ran it: 480 by 640. CameraX names a size as its sensor lies. */
private val PICTURE = Size(640, 480)
/** The screen's own picture of the camera, at most about this, upright 720 by 960. */
private val SHOWN = Size(960, 720)
/** The camera films no faster than this many pictures a second: the model reads about 20 (51b-ii, and 53a's own run). */
private const val FRAMES_MOST = 24
private const val FRAMES_LEAST = 15
/** A camera that gives no picture for this long, while the app is in front, has stopped. */
private const val QUIET_MS = 5_000L
/** A gravity reading older than this says nothing about now. */
private const val GRAVITY_STALE_NS = 1_000_000_000L
private const val TAG = "PoseCamera"
/** How many turned pictures go round (`picture`). */
private const val TURNED = 3

/**
 * The selfie camera's picture across the whole view, as the camera screen shows it (mirrored, as every selfie camera
 * shows a person), and the pose model reading each newest picture of it. The model reads the picture as the camera took
 * it, upright and NOT mirrored, as the proof videos were filmed, so its left is the person's own left (51b-ii: mirrored,
 * the model's left was the person's right). Each answer goes to the screen as `onPose`: the picture's size, the phone's
 * gravity at that moment, and the person found, if any; nothing is kept. Anything that stops the camera or the model is
 * said once as `onProblem`, and the screen turns the set into one counted by hand.
 */
class PoseCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val onPose by EventDispatcher()
  private val onProblem by EventDispatcher()

  private val preview = PreviewView(context).apply {
    scaleType = PreviewView.ScaleType.FILL_CENTER
    // Drawn as an ordinary view, so the screen's own drawing lies over it in every phone's order.
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
  }
  private val main = Handler(Looper.getMainLooper())
  private val debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
  private var wanted = false
  private var session: Session? = null

  init {
    addView(preview, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  fun setActive(active: Boolean) {
    wanted = active
    if (active && isAttachedToWindow) start() else if (!active) stop()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (wanted) start()
  }

  override fun onDetachedFromWindow() {
    stop()
    super.onDetachedFromWindow()
  }

  private fun start() {
    if (session != null) return
    val owner = appContext.currentActivity as? LifecycleOwner
    if (owner == null) {
      problem("camera")
      return
    }
    session = Session(owner).also { it.open() }
  }

  private fun stop() {
    session?.close()
    session = null
  }

  private fun problem(reason: String) {
    main.post { onProblem(mapOf("reason" to reason)) }
  }

  /** One opening of the camera and the model, from Start (or the screen's coming back) to its end. */
  private inner class Session(private val owner: LifecycleOwner) : SensorEventListener {
    private val worker: ExecutorService = Executors.newSingleThreadExecutor()
    private val sensorThread = HandlerThread("pose-camera-gravity").also { it.start() }
    private val sensors = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    @Volatile private var landmarker: PoseLandmarker? = null
    @Volatile private var closed = false
    @Volatile private var failed = false
    @Volatile private var gravity: FloatArray? = null
    @Volatile private var gravityAt = 0L
    @Volatile private var lastPicture = SystemClock.elapsedRealtime()
    private var provider: ProcessCameraProvider? = null
    private var useCases: List<UseCase> = emptyList()
    private val lock = Any()
    /** CameraX's picture, copied into memory made once (or into a new picture where its rows are laid out otherwise). */
    private var rawPicture: Bitmap? = null
    /** The turned pictures, used in turn (`picture`). */
    private val turned = ArrayDeque<Bitmap>(TURNED)

    private fun rawOf(proxy: ImageProxy): Bitmap {
      val plane = proxy.planes.firstOrNull()
      if (plane == null || plane.pixelStride != 4 || plane.rowStride != proxy.width * 4) return proxy.toBitmap()
      val raw = rawPicture?.takeIf { it.width == proxy.width && it.height == proxy.height }
        ?: Bitmap.createBitmap(proxy.width, proxy.height, Bitmap.Config.ARGB_8888).also { rawPicture = it }
      val pixels = plane.buffer
      pixels.rewind()
      raw.copyPixelsFromBuffer(pixels)
      return raw
    }
    private var lastTimestamp = 0L
    // Counts for the laptop's log while a folder's copy is measured (51b-ii's numbers again): never a point.
    private var answered = 0
    private var found = 0

    fun open() {
      sensors?.let { s ->
        val sensor = s.getDefaultSensor(Sensor.TYPE_GRAVITY) ?: s.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        if (sensor != null) s.registerListener(this, sensor, SensorManager.SENSOR_DELAY_GAME, Handler(sensorThread.looper))
      }
      worker.execute {
        try {
          landmarker = PoseLandmarker.createFromOptions(context, options())
        } catch (e: Throwable) {
          fail("model", e)
          return@execute
        }
        main.post { bind() }
      }
      main.postDelayed(watch, 1_000L)
    }

    private fun options(): PoseLandmarker.PoseLandmarkerOptions {
      val bytes = context.assets.open(MODEL).use { it.readBytes() }
      val model = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).put(bytes)
      model.rewind()
      val base = BaseOptions.builder().setModelAssetBuffer(model).setDelegate(Delegate.CPU).build()
      val options = PoseLandmarker.PoseLandmarkerOptions.builder()
        .setBaseOptions(base)
        .setRunningMode(RunningMode.LIVE_STREAM)
        .setNumPoses(1)
        .setMinPoseDetectionConfidence(SURE)
        .setMinPosePresenceConfidence(SURE)
        .setMinTrackingConfidence(SURE)
        .setOutputSegmentationMasks(false)
        .setResultListener { result: PoseLandmarkerResult, image: MPImage -> answer(result, image) }
        .setErrorListener { e -> fail("model", e) }
        .build()
      return PoseCameraCores.onCores(options, minOf(CORES, Runtime.getRuntime().availableProcessors()))
    }

    /** Of the speeds the selfie camera offers, the fastest no faster than `FRAMES_MOST`, the slowest start among those
     *  (so a dim room may still take longer pictures); null when it offers none, and the camera keeps its own. */
    @androidx.annotation.OptIn(markerClass = [ExperimentalCamera2Interop::class])
    private fun framesOf(cameras: ProcessCameraProvider): Range<Int>? = try {
      val front = cameras.availableCameraInfos.firstOrNull { it.lensFacing == CameraSelector.LENS_FACING_FRONT }
      val offered = front?.let { Camera2CameraInfo.from(it).getCameraCharacteristic(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES) }
      offered
        ?.filter { it.upper in FRAMES_LEAST..FRAMES_MOST }
        ?.sortedWith(compareByDescending<Range<Int>> { it.upper }.thenBy { it.lower })
        ?.firstOrNull()
    } catch (e: Throwable) {
      null
    }

    private fun bind() {
      if (closed) return
      val future = ProcessCameraProvider.getInstance(context)
      future.addListener({
        if (closed) return@addListener
        try {
          val cameras = future.get()
          if (!cameras.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) {
            fail("camera", null)
            return@addListener
          }
          // No faster than the model reads, and the screen's picture no bigger than a person 3 m away needs: the camera's
          // own work at 30 pictures a second was nearly a core, and with it the phone grew hot enough after 9 minutes to
          // slow its chip to a third (53a, the 20-minute run).
          val shownBuilder = Preview.Builder().setResolutionSelector(
            ResolutionSelector.Builder()
              .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
              .setResolutionStrategy(ResolutionStrategy(SHOWN, ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
              .build(),
          )
          val frames = framesOf(cameras)
          frames?.let { shownBuilder.setTargetFrameRate(it) }
          if (debuggable) Log.i(TAG, "frames=${frames ?: "the camera's own"}")
          val shown = shownBuilder.build()
          shown.setSurfaceProvider(preview.surfaceProvider)
          val analysis = ImageAnalysis.Builder()
            .setResolutionSelector(
              ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                .setResolutionStrategy(ResolutionStrategy(PICTURE, ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                .build(),
            )
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .build()
          analysis.setAnalyzer(worker) { proxy -> picture(proxy) }
          useCases = listOf(shown, analysis)
          provider = cameras
          lastPicture = SystemClock.elapsedRealtime()
          cameras.bindToLifecycle(owner, CameraSelector.DEFAULT_FRONT_CAMERA, shown, analysis)
        } catch (e: Throwable) {
          fail("camera", e)
        }
      }, ContextCompat.getMainExecutor(context))
    }

    /** One camera picture, on the worker: turned upright, never mirrored, and handed to the model, which drops it if it
     *  is still busy with the one before (its live mode). The pictures' memory is made once and used again for every
     *  picture: two new pictures each time (CameraX's own and the turned one) were about 40 MB of throwaway memory a
     *  second, and on Kd's phone Android's clean-up of it took nearly half a core away from the model (53a, the 20-minute
     *  run). The turned pictures go round three, so none is drawn over while the model may still be reading it: it reads
     *  one at a time and drops the pictures that come meanwhile. */
    private fun picture(proxy: ImageProxy) {
      lastPicture = SystemClock.elapsedRealtime()
      try {
        val model = landmarker ?: return
        if (closed || failed) return
        val raw = rawOf(proxy)
        val turn = proxy.imageInfo.rotationDegrees
        val sideways = turn % 180 != 0
        val width = if (sideways) raw.height else raw.width
        val height = if (sideways) raw.width else raw.height
        val upright = (if (turned.size >= TURNED) turned.removeFirst() else null)?.takeIf { it.width == width && it.height == height }
          ?: Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        turned.addLast(upright)
        val matrix = Matrix().apply {
          postRotate(turn.toFloat(), raw.width / 2f, raw.height / 2f)
          postTranslate((width - raw.width) / 2f, (height - raw.height) / 2f)
        }
        Canvas(upright).drawBitmap(raw, matrix, null)
        val timestamp = synchronized(lock) {
          val ts = maxOf(SystemClock.uptimeMillis(), lastTimestamp + 1)
          lastTimestamp = ts
          ts
        }
        model.detectAsync(BitmapImageBuilder(upright).build(), timestamp)
      } catch (e: Throwable) {
        fail("model", e)
      } finally {
        proxy.close()
      }
    }

    /** One answer, on the model's own thread: to the screen, and gone. */
    private fun answer(result: PoseLandmarkerResult, image: MPImage) {
      if (closed) return
      val points = result.landmarks().firstOrNull()?.takeIf { it.size == POINTS }
      val world = result.worldLandmarks().firstOrNull()?.takeIf { it.size == POINTS }
      val people = ArrayList<Map<String, Any>>(1)
      if (points != null) {
        // Plain number arrays: the screen gets them as they are, with no object made for each number.
        val flat = DoubleArray(POINTS * 5)
        for ((k, p) in points.withIndex()) {
          flat[k * 5] = p.x().toDouble()
          flat[k * 5 + 1] = p.y().toDouble()
          flat[k * 5 + 2] = p.z().toDouble()
          flat[k * 5 + 3] = p.visibility().orElse(0f).toDouble()
          flat[k * 5 + 4] = p.presence().orElse(0f).toDouble()
        }
        val flatWorld = DoubleArray(if (world == null) 0 else POINTS * 3)
        world?.forEachIndexed { k, p ->
          flatWorld[k * 3] = p.x().toDouble()
          flatWorld[k * 3 + 1] = p.y().toDouble()
          flatWorld[k * 3 + 2] = p.z().toDouble()
        }
        people.add(mapOf("points" to flat, "world" to flatWorld))
      }
      val g = gravity?.takeIf { SystemClock.elapsedRealtimeNanos() - gravityAt <= GRAVITY_STALE_NS }
      val event = mapOf(
        // The phone's own clock since it started (never back, and running on across a pause): the screen counts the
        // set's time from its first picture.
        "t" to result.timestampMs().toDouble(),
        "width" to image.width.toDouble(),
        "height" to image.height.toDouble(),
        "gravity" to (g?.let { doubleArrayOf(it[0].toDouble(), it[1].toDouble(), it[2].toDouble()) } ?: DoubleArray(0)),
        "people" to people,
      )
      if (debuggable) {
        synchronized(lock) {
          answered++
          if (points != null) found++
        }
      }
      main.post { if (!closed) onPose(event) }
    }

    /** Once a second on the main thread: a camera gone quiet while the app is in front has stopped. */
    private val watch: Runnable = object : Runnable {
      override fun run() {
        if (closed) return
        val inFront = owner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
        if (!inFront || provider == null) {
          lastPicture = SystemClock.elapsedRealtime()
        } else if (SystemClock.elapsedRealtime() - lastPicture > QUIET_MS) {
          fail("camera", null)
          return
        }
        if (debuggable) {
          val (a, f) = synchronized(lock) { (answered to found).also { answered = 0; found = 0 } }
          Log.i(TAG, "answers=$a found=$f")
        }
        main.postDelayed(this, 1_000L)
      }
    }

    override fun onSensorChanged(event: SensorEvent) {
      if (event.values.size < 3) return
      gravity = floatArrayOf(event.values[0], event.values[1], event.values[2])
      gravityAt = event.timestamp
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private fun fail(reason: String, e: Throwable?) {
      if (closed || failed) return
      failed = true
      Log.w(TAG, "The $reason stopped: ${e?.javaClass?.simpleName ?: "no picture"}")
      problem(reason)
    }

    fun close() {
      if (closed) return
      closed = true
      main.removeCallbacks(watch)
      try {
        provider?.unbind(*useCases.toTypedArray())
      } catch (e: Throwable) {
        // Already let go by Android.
      }
      try {
        sensors?.unregisterListener(this)
      } catch (e: Throwable) {
        // Already let go by Android.
      }
      sensorThread.quitSafely()
      // The model is closed on the worker, after any picture it is reading.
      worker.execute {
        try {
          landmarker?.close()
        } catch (e: Throwable) {
          // Closing twice, or after a failure, is nothing.
        }
        landmarker = null
      }
      // Never waited for here, on the screen's own thread.
      worker.shutdown()
    }
  }
}
