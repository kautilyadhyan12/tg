package expo.modules.posecamera

import android.content.Context
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import android.hardware.Sensor
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureRequest
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.Range
import android.util.Size
import android.view.Surface
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.UseCase
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.facebook.react.common.assets.ReactFontManager
import com.google.mediapipe.framework.image.BitmapExtractor
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseCameraCores
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** The model the phone runs, put in the app by this module's build (build.gradle, checked by its SHA-256 there). */
private const val MODEL = "pose_landmarker_full.task"
private const val POINTS = 33
/** 51b-ii's pick, the one the phone proof counts with (phoneCounts.ts, CHOSEN_RUN): the full model on the main chip on 4
 *  cores (on a phone with fewer, all of them). The graphics chip answered 20 a second off the charger for 8½ minutes on
 *  Kd's phone (53a), but no proof row has been read on it, and 51b-ii saw it lose the body in 23 to 43 of 100 answers: it
 *  may be taken only once the proof passes on its points (53a's round one). */
private const val CORES = 4
/** The model's own sureness settings, as every kept body-points file was measured with (phoneRun.ts SETTINGS). */
private const val SURE = 0.5f
/** The picture the model reads, upright, as 51b-ii ran it: 480 by 640. CameraX names a size as its sensor lies. */
private val PICTURE = Size(640, 480)
/** The camera films no faster than this many pictures a second: the model reads about 20 (51b-ii, and 53a's own run). */
private const val FRAMES_MOST = 24
private const val FRAMES_LEAST = 15
/** A camera that gives no picture for this long, while the app is in front, has stopped. */
private const val QUIET_MS = 5_000L
/** A gravity reading older than this says nothing about now. */
private const val GRAVITY_STALE_NS = 1_000_000_000L
private const val TAG = "PoseCamera"
/** How many turned pictures go round (`picture`): a picture is copied for the screen once the model has answered it, at
 *  up to 20 a second and with an answer taking up to about 150 ms, so six are never drawn over while the model or the
 *  screen's copy still reads one. */
private const val TURNED = 6

// The body's drawing, as Kd's drawing of 2026-11-26 has it, in the screen's points: a gold halo and glow round each white
// line, a dark ring on each joint with a gold dot, gold corners round the person, the words 22 above them.
private const val HALO_DP = 16f
private const val GLOW_DP = 7f
private const val LINE_DP = 2.5f
private const val RING_DP = 7f
private const val RING_LINE_DP = 2f
private const val DOT_DP = 2.5f
private const val CORNER_DP = 3f
private const val CORNER_ARM_DP = 26f
private const val WORDS_ABOVE_DP = 22f
private const val WORDS_SHADOW_DP = 6f

/** How the screen draws the body, handed over once by the app (src/camera/skeleton.ts `bodyDrawing`): which points are
 *  joined and which ringed, how sure the model must be of a point to draw it, how far the corners stand out, the words over
 *  them in the look's eyebrow, and the look's colours by name. */
class BodyDrawing : Record {
  @Field val lines: List<Int> = emptyList()
  @Field val joints: List<Int> = emptyList()
  @Field val nose: Int = 0
  @Field val sure: Double = 0.5
  @Field val room: Double = 0.06
  @Field val words: String = ""
  @Field val font: String = ""
  @Field val wordsSize: Double = 11.0
  @Field val wordsLine: Double = 14.0
  @Field val wordsSpacing: Double = 0.0
  @Field val wordsGrowth: Double = 1.0
  @Field val line: Int = 0
  @Field val glow: Int = 0
  @Field val halo: Int = 0
  @Field val joint: Int = 0
  @Field val gold: Int = 0
  @Field val shadow: Int = 0
}

/**
 * The person the model found, drawn by the phone over the very picture it was read from, in the same moment (`answer`):
 * drawn by the app's script they reached the screen after the picture, and fell further behind as it worked (Kd at 53a's
 * run: "the lines lagging a lot again"). The picture fills the view, cut at its sides or top, and is mirrored (`shown`), so
 * a point at x across the picture lies at the mirror of x on the screen. Nothing when it follows nobody.
 */
private class BodyOverlay(context: Context) : View(context) {
  private val density = resources.displayMetrics.density
  private var drawing: BodyDrawing? = null
  /** x, y, seen and in the picture, for each point; null with nobody. */
  private var points: FloatArray? = null
  private var aspect = 0f
  private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
  }
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val words = Paint(Paint.ANTI_ALIAS_FLAG)
  private val bones = Path()
  private val corners = Path()
  private val xs = FloatArray(POINTS)
  private val ys = FloatArray(POINTS)
  private val seen = BooleanArray(POINTS)

  fun setDrawing(d: BodyDrawing) {
    drawing = d
    val growth = minOf(resources.configuration.fontScale, d.wordsGrowth.toFloat())
    words.typeface = try {
      ReactFontManager.getInstance().getTypeface(d.font, Typeface.NORMAL, context.assets)
    } catch (e: Throwable) {
      Typeface.DEFAULT_BOLD
    }
    words.textSize = d.wordsSize.toFloat() * density * growth
    words.letterSpacing = if (d.wordsSize > 0) (d.wordsSpacing / d.wordsSize).toFloat() else 0f
    words.color = d.gold
    words.setShadowLayer(WORDS_SHADOW_DP * density, 0f, density, d.shadow)
    invalidate()
  }

  fun show(next: FloatArray?, pictureAspect: Float) {
    points = next
    aspect = pictureAspect
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    val d = drawing ?: return
    val p = points ?: return
    val w = width.toFloat()
    val h = height.toFloat()
    if (!(aspect > 0f) || w <= 0f || h <= 0f) return
    // The picture as the screen shows it: as tall as the view, or as wide, whichever covers it; centred.
    val tall = maxOf(w / aspect, h)
    val wide = tall * aspect
    val left = (w - wide) / 2f
    val top = (h - tall) / 2f
    val sure = d.sure.toFloat()
    for (k in 0 until POINTS) {
      val x = p[k * 4]
      val y = p[k * 4 + 1]
      seen[k] = x.isFinite() && y.isFinite() && p[k * 4 + 2] >= sure && p[k * 4 + 3] >= sure
      xs[k] = w - (left + x * wide)
      ys[k] = top + y * tall
    }
    val ok = { k: Int -> k in 0 until POINTS && seen[k] }

    bones.rewind()
    var i = 0
    while (i + 1 < d.lines.size) {
      val a = d.lines[i]
      val b = d.lines[i + 1]
      i += 2
      if (ok(a) && ok(b)) {
        bones.moveTo(xs[a], ys[a])
        bones.lineTo(xs[b], ys[b])
      }
    }
    var joints = 0
    var minX = Float.MAX_VALUE
    var maxX = -Float.MAX_VALUE
    var minY = Float.MAX_VALUE
    var maxY = -Float.MAX_VALUE
    for (k in d.joints) {
      if (!ok(k)) continue
      joints++
      minX = minOf(minX, xs[k])
      maxX = maxOf(maxX, xs[k])
      minY = minOf(minY, ys[k])
      maxY = maxOf(maxY, ys[k])
    }
    if (bones.isEmpty && joints == 0) return

    // The corners round the body, with the head, once enough of it is seen.
    val boxed = joints >= 4
    var boxLeft = 0f
    var boxTop = 0f
    if (boxed) {
      if (ok(d.nose)) {
        minY = minOf(minY, ys[d.nose])
        maxY = maxOf(maxY, ys[d.nose])
      }
      val room = (maxY - minY) * d.room.toFloat()
      boxLeft = minX - room
      boxTop = minY - room * 2f
      val right = maxX + room
      val bottom = maxY + room
      val arm = minOf(CORNER_ARM_DP * density, (right - boxLeft) / 4f)
      corners.rewind()
      corners.moveTo(boxLeft, boxTop + arm); corners.lineTo(boxLeft, boxTop); corners.lineTo(boxLeft + arm, boxTop)
      corners.moveTo(right - arm, boxTop); corners.lineTo(right, boxTop); corners.lineTo(right, boxTop + arm)
      corners.moveTo(right, bottom - arm); corners.lineTo(right, bottom); corners.lineTo(right - arm, bottom)
      corners.moveTo(boxLeft + arm, bottom); corners.lineTo(boxLeft, bottom); corners.lineTo(boxLeft, bottom - arm)
      stroke.color = d.gold
      stroke.strokeWidth = CORNER_DP * density
      canvas.drawPath(corners, stroke)
    }

    stroke.color = d.halo
    stroke.strokeWidth = HALO_DP * density
    canvas.drawPath(bones, stroke)
    stroke.color = d.glow
    stroke.strokeWidth = GLOW_DP * density
    canvas.drawPath(bones, stroke)
    stroke.color = d.line
    stroke.strokeWidth = LINE_DP * density
    canvas.drawPath(bones, stroke)

    stroke.strokeWidth = RING_LINE_DP * density
    for (k in d.joints) {
      if (!ok(k)) continue
      fill.color = d.joint
      canvas.drawCircle(xs[k], ys[k], RING_DP * density, fill)
      canvas.drawCircle(xs[k], ys[k], RING_DP * density, stroke)
      fill.color = d.gold
      canvas.drawCircle(xs[k], ys[k], DOT_DP * density, fill)
    }

    if (boxed && d.words.isNotEmpty()) {
      // The words' line box starts 22 above the corners, the words centred in it, as the look's eyebrow sets them.
      val lineBox = d.wordsLine.toFloat() * density * minOf(resources.configuration.fontScale, d.wordsGrowth.toFloat())
      val m = words.fontMetrics
      val baseline = boxTop - WORDS_ABOVE_DP * density + (lineBox - (m.descent - m.ascent)) / 2f - m.ascent
      canvas.drawText(d.words, boxLeft, baseline, words)
    }
  }
}

/**
 * The selfie camera's pictures across the whole view, mirrored as every selfie camera shows a person, each the very
 * picture the pose model has just read, so the body's lines the screen draws from its answer lie on the body in it: drawn
 * on the camera's live picture they trailed the body by the model's time and the screen's (Kd at 53a's run: "the lines
 * that track body is lagging"). The model reads the picture as the camera took it, upright and NOT mirrored, as the proof
 * videos were filmed, so its left is the person's own left (51b-ii: mirrored, the model's left was the person's right). It
 * reads on the main chip's 4 cores (`CORES`). Each answer goes to the screen as `onPose`: the picture's size, the phone's
 * gravity at that moment and how the screen is turned from the phone's own axes, and the person found, if any; nothing is
 * kept. Anything that stops the camera or the model is said once as
 * `onProblem`, and the screen turns the set into one counted by hand.
 */
class PoseCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val onPose by EventDispatcher()
  private val onProblem by EventDispatcher()

  /** The model's own pictures, filling the view (cut at its sides or top, never stretched) and mirrored. */
  private val shown = ImageView(context).apply {
    scaleType = ImageView.ScaleType.CENTER_CROP
    scaleX = -1f
    setBackgroundColor(Color.BLACK)
  }
  private val body = BodyOverlay(context)
  private val main = Handler(Looper.getMainLooper())
  private val debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
  private var wanted = false
  private var session: Session? = null

  init {
    // One over the other: Expo's view lays its own children out side by side, and the body beside its picture was drawn
    // off the screen's edge.
    val stack = FrameLayout(context)
    stack.addView(shown, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    stack.addView(body, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    addView(stack, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  fun setDrawing(drawing: BodyDrawing) = body.setDrawing(drawing)

  fun setActive(active: Boolean) {
    wanted = active
    if (active && isAttachedToWindow) start() else if (!active) stop()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    keepOutOfRecents(true)
    if (wanted) start()
  }

  override fun onDetachedFromWindow() {
    stop()
    keepOutOfRecents(false)
    super.onDetachedFromWindow()
  }

  /**
   * While the camera's picture of the person is on the screen, Android keeps no still of the app for its app switcher (the
   * camera's security pass, H1: Home pressed in a set, or the switcher opened to change the music, saved that picture in the
   * phone's own storage and showed it there and on the way back). Android 13 and later; the person's own screenshots still
   * work.
   */
  private fun keepOutOfRecents(out: Boolean) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    appContext.currentActivity?.setRecentsScreenshotEnabled(!out)
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
    // Paused, or gone: no line is left on a picture the model no longer reads.
    body.show(null, 0f)
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
    /** The two pictures the screen shows in turn, each a copy of one the model has answered. */
    private val showing = arrayOfNulls<Bitmap>(2)
    private var nextShown = 0
    /** How the screen is turned from the phone's own axes, in degrees: Android reads gravity in those axes, and the picture
     *  is turned upright for the screen (on a tablet held upright, 90 or 270). Read once, as the camera is set up, and the
     *  camera turns its pictures by that same reading (`bind`), so the two never disagree; a folding phone opened makes the
     *  screen anew, and the camera with it. */
    @Volatile private var screenTurn = 0

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

    /** Of the speeds the selfie camera offers, the fastest no faster than `FRAMES_MOST`, a steady one first: a speed that
     *  may fall below `FRAMES_LEAST` in a dim room (Kd's phone offered 8 to 20) would leave the model too few pictures.
     *  Null when it offers none, and the camera keeps its own. */
    @androidx.annotation.OptIn(markerClass = [ExperimentalCamera2Interop::class])
    private fun framesOf(cameras: ProcessCameraProvider): Range<Int>? = try {
      val front = cameras.availableCameraInfos.firstOrNull { it.lensFacing == CameraSelector.LENS_FACING_FRONT }
      val offered = front?.let { Camera2CameraInfo.from(it).getCameraCharacteristic(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES) }
      offered
        ?.filter { it.upper in FRAMES_LEAST..FRAMES_MOST }
        ?.sortedWith(compareByDescending<Range<Int>> { it.lower >= FRAMES_LEAST }.thenByDescending { it.upper }.thenByDescending { it.lower })
        ?.firstOrNull()
    } catch (e: Throwable) {
      null
    }

    @androidx.annotation.OptIn(markerClass = [ExperimentalCamera2Interop::class])
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
          // One stream, the model's: the screen shows the pictures it read. And no faster than the model reads: at 30
          // pictures a second, beside a second stream for the screen, the camera's own work was nearly a core, and with it
          // the phone grew hot enough after 9 minutes to slow its chip to a third (53a, the 20-minute runs).
          val rotation = display?.rotation ?: Surface.ROTATION_0
          screenTurn = rotation * 90
          val builder = ImageAnalysis.Builder()
            .setTargetRotation(rotation)
            .setResolutionSelector(
              ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                .setResolutionStrategy(ResolutionStrategy(PICTURE, ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                .build(),
            )
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
          val frames = framesOf(cameras)
          frames?.let { Camera2Interop.Extender(builder).setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, it) }
          if (debuggable) Log.i(TAG, "frames=${frames ?: "the camera's own"}")
          val analysis = builder.build()
          analysis.setAnalyzer(worker) { proxy -> picture(proxy) }
          useCases = listOf(analysis)
          provider = cameras
          lastPicture = SystemClock.elapsedRealtime()
          cameras.bindToLifecycle(owner, CameraSelector.DEFAULT_FRONT_CAMERA, analysis)
        } catch (e: Throwable) {
          fail("camera", e)
        }
      }, ContextCompat.getMainExecutor(context))
    }

    /** One camera picture, on the worker: turned upright, never mirrored, and handed to the model, which drops it if it
     *  cannot take it now (its live mode), as 53a's first runs measured it on the main chip (15 to 20 answers a second). The
     *  pictures' memory is made once and used again for every picture: two new pictures each time
     *  (CameraX's own and the turned one) were about 40 MB of throwaway memory a second, and on Kd's phone Android's
     *  clean-up of it took nearly half a core away from the model (53a, the 20-minute run). */
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

    /** One answer, on the model's own thread: to the screen with the picture it read, and gone. */
    private fun answer(result: PoseLandmarkerResult, image: MPImage) {
      if (closed) return
      val picture = showingCopy(image)
      val points = result.landmarks().firstOrNull()?.takeIf { it.size == POINTS }
      val world = result.worldLandmarks().firstOrNull()?.takeIf { it.size == POINTS }
      val people = ArrayList<Map<String, Any>>(1)
      var drawn: FloatArray? = null
      if (points != null) {
        drawn = FloatArray(POINTS * 4)
        for ((k, p) in points.withIndex()) {
          drawn[k * 4] = p.x()
          drawn[k * 4 + 1] = p.y()
          drawn[k * 4 + 2] = p.visibility().orElse(0f)
          drawn[k * 4 + 3] = p.presence().orElse(0f)
        }
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
        "turn" to screenTurn.toDouble(),
        "people" to people,
      )
      if (debuggable) {
        synchronized(lock) {
          answered++
          if (points != null) found++
        }
      }
      main.post {
        if (closed) return@post
        // The picture and the body read from it, drawn in the same frame.
        if (picture != null) shown.setImageBitmap(picture)
        body.show(drawn, if (image.height > 0) image.width.toFloat() / image.height else 0f)
        onPose(event)
      }
    }

    /** The picture the model read, copied into the one of the screen's two pictures it is not showing; null if it cannot
     *  be read. */
    private fun showingCopy(image: MPImage): Bitmap? = try {
      val read = BitmapExtractor.extract(image)
      val k = nextShown
      nextShown = 1 - k
      val copy = showing[k]?.takeIf { it.width == read.width && it.height == read.height }
        ?: Bitmap.createBitmap(read.width, read.height, Bitmap.Config.ARGB_8888).also { showing[k] = it }
      Canvas(copy).drawBitmap(read, 0f, 0f, null)
      copy
    } catch (e: Throwable) {
      null
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
      // When it came, on the clock the answers are judged by: a phone's sensor clock may run from another start.
      gravityAt = SystemClock.elapsedRealtimeNanos()
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
