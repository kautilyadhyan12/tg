package expo.modules.phonetest

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.BatteryManager
import android.os.Build
import android.os.Debug
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PhoneTestCores
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.Writer
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

// The live camera test (ROADMAP Stage 5 item 51b-ii): the phone's own camera through the pose model, as the camera screen
// will run it (CameraX's newest picture, the library's live mode, which drops a picture while it is busy, the camera and
// the skeleton drawn), for 20 minutes off the charger, once for each set-up on the laptop's plan; and ten seconds of a
// still body through the selfie camera and the back camera. The laptop's half is
// packages/movement/scripts/phone-live.ts; what decides is packages/movement/scripts/phoneLive.ts. This side records,
// never judges. No picture is ever written: a 20-minute run writes counts and times, a still body its points.

private const val LIVE_PLAN_VERSION = 1
private const val POINTS = 33
/** Before a run's clock starts, the camera must have seen the body in this many seconds in a row. */
private const val SEEN_FOR_S = 3
/** A camera that gives no picture for this long has stopped. */
private const val CAMERA_QUIET_MS = 10_000L
/** How long the phone waits for a body, for its cable to come out, or for its turn. */
private const val WAIT_MS = 30 * 60 * 1000L
private const val UNPLUG = "Unplug the phone's cable and leave it facing the laptop's screen.\n\nThe test starts by itself."
private const val LOOKING = "Looking for the person on the laptop's screen."
private const val POINT_BACK = "Point the phone's back camera at the laptop's screen and keep it still.\n\nIt starts by itself when it sees the person."
private const val TURN_ROUND = "Turn the phone round, so this screen faces the laptop's screen.\n\nIt beeps twice when it is done: then unplug its cable."

private class LiveSetup(val model: Model, val delegate: String, val threads: Int?)
private class StillStep(val camera: String, val setup: LiveSetup)
private class LivePlan(
  val people: Int,
  val minDetection: Float,
  val minPresence: Float,
  val minTracking: Float,
  /** The model's pictures, upright. */
  val width: Int,
  val height: Int,
  val still: List<StillStep>,
  val live: List<LiveSetup>,
  val stillSeconds: Int,
  val minutes: Int,
  val settleSeconds: Int,
  val coolLeastMin: Int,
  val coolMostMin: Int,
)

/** What one second of a run saw, counted by the camera's and the model's own threads. */
private class Tally {
  var camera = 0
  var read = 0
  var found = 0
  val waits = ArrayList<Long>()
}

internal class PhoneTestLive private constructor(private val screen: PhoneTestLiveActivity) {
  companion object {
    private val running = AtomicBoolean(false)

    @Volatile
    var status: String = "Live camera test\n\nGetting ready."

    /** The screen went away: whatever is running stops and says so. */
    @Volatile
    var screenGone = false

    fun startOnce(screen: PhoneTestLiveActivity) {
      screenGone = false
      if (!running.compareAndSet(false, true)) return
      thread(name = "phone-test-live") {
        try {
          PhoneTestLive(screen).run()
        } finally {
          running.set(false)
        }
      }
    }
  }

  private val context: Context = screen.applicationContext
  private val root = File(context.filesDir, "phone-live")
  private val out = File(root, "out")
  private val main = Handler(Looper.getMainLooper())
  private var planSum = ""
  private var cameras: ProcessCameraProvider? = null
  private var step = 0
  private var steps = 0

  // The run in progress, shared with the camera's and the model's threads.
  private val lock = Any()
  private var tally = Tally()
  private val arrivals = HashMap<Long, Long>()
  private var lastTimestamp = 0L
  @Volatile private var lastPicture = 0L
  @Volatile private var modelError: String? = null
  @Volatile private var frames: Writer? = null
  @Volatile private var framesStart = -1L
  private var mirror = true

  fun run() {
    try {
      out.deleteRecursively()
      check(out.mkdirs()) { "The phone could not make the test's folder." }
      check(context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
        "This copy may not use the camera: the laptop grants it before it opens this screen."
      }
      say("starting", 0, 0, "Checking the files from the laptop.")
      planSum = sha256(listOf(File(root, "plan.json")))
      val plan = readPlan()
      for (model in (plan.still.map { it.setup.model } + plan.live.map { it.model }).distinct()) {
        check(sha256(listOf(model.file)) == model.sha256) { "The model ${model.name} did not arrive whole." }
      }
      steps = plan.still.size + plan.live.size

      // The still body, on the cable: the laptop shows one picture of a person standing.
      cameras = ProcessCameraProvider.getInstance(context).get(30, TimeUnit.SECONDS)
      // The back camera first, while this screen still faces the person holding the phone; then the phone is turned
      // round, its screen to the laptop, where nobody can read it: from there on it beeps when it needs somebody.
      for ((k, still) in plan.still.withIndex()) {
        step = k + 1
        val hint = when {
          still.camera == "back" -> POINT_BACK
          k > 0 -> TURN_ROUND
          else -> LOOKING
        }
        say(if (k > 0) "turn" else "still", 0, plan.stillSeconds, hint)
        stillOne(plan, k, still, hint)
      }

      say("unplug", 0, 0, UNPLUG)
      // The laptop says when its screen plays the videos, so the cable never comes out before they show.
      runCatching { waitFor(120_000L, "") { File(root, "laptop-ready").exists() } }
      offTheCable(plan)

      var firstHeat: JSONObject? = null
      for ((k, setup) in plan.live.withIndex()) {
        step = plan.still.size + k + 1
        if (k > 0) cool(plan, firstHeat)
        // A run the cable went into cannot count: it is dropped, and run again from its first second once the cable
        // is out (51b-ii's first try ran its first run on the charger).
        while (true) {
          try {
            val heat = liveOne(plan, k, setup)
            if (k == 0) firstHeat = heat
            break
          } catch (e: Plugged) {
            offTheCable(plan)
          }
        }
      }
      say("done", 0, 0, "Live camera test done.\n\nPlug the phone into the laptop again.")
      // Three beeps, then again each minute, until somebody plugs it in (at most 30 minutes).
      val until = SystemClock.elapsedRealtime() + WAIT_MS
      while (!battery().getBoolean("plugged") && SystemClock.elapsedRealtime() < until) {
        beep(3)
        pause(60_000)
      }
    } catch (e: Throwable) {
      val reason = words(e)
      runCatching { say("failed", 0, 0, "The live camera test stopped.\n\n$reason", reason) }
    } finally {
      cameras?.let { p -> runCatching { onMain { p.unbindAll() } } }
    }
  }

  /** Beeps twice and waits until the cable is out, then for the plan's settling time with the cable out the whole
   *  time: a cable that goes back in starts it again. */
  private fun offTheCable(plan: LivePlan) {
    while (true) {
      say("unplug", 0, 0, UNPLUG)
      beep(2)
      waitFor(WAIT_MS, "The cable was not unplugged within 30 minutes.") { !plugged() }
      say("settle", 0, plan.settleSeconds, "Unplugged. Starting in ${plan.settleSeconds} seconds.\n\nLeave the phone facing the laptop's screen.")
      var back = false
      for (s in 0 until plan.settleSeconds) {
        pause(1000)
        if (plugged()) {
          back = true
          break
        }
      }
      if (!back) return
    }
  }

  private fun plugged(): Boolean = battery().getBoolean("plugged")

  // ── The plan ─────────────────────────────────────────────────────────────────────
  private fun readPlan(): LivePlan {
    val json = JSONObject(File(root, "plan.json").readText())
    check(json.getInt("version") == LIVE_PLAN_VERSION) { "The laptop's plan is not one this copy of the app reads: build the app again." }
    val models = json.getJSONArray("models").objects().map { m ->
      val name = m.getString("name")
      check(PLAIN.matches(name)) { "The plan holds a name that is not plain." }
      val sum = m.getString("sha256")
      check(HEX.matches(sum)) { "The plan holds a file check that is not one." }
      Model(name, File(root, "models/$name.task"), sum)
    }.associateBy { it.name }
    fun setup(r: JSONObject): LiveSetup {
      val model = models[r.getString("model")] ?: error("The plan runs a model it does not send.")
      val delegate = r.getString("delegate")
      check(delegate == "cpu" || delegate == "gpu") { "The plan names a chip this test does not know." }
      val threads = if (r.isNull("threads")) null else r.getInt("threads")
      check(threads == null || (delegate == "cpu" && threads in 1..8)) { "The plan sets cores the main chip cannot take." }
      return LiveSetup(model, delegate, threads)
    }
    val still = json.getJSONArray("still").objects().map { s ->
      val camera = s.getString("camera")
      check(camera == "selfie" || camera == "back") { "The plan names a camera this test does not know." }
      StillStep(camera, setup(s))
    }
    val live = json.getJSONArray("live").objects().map(::setup)
    check(live.size in 1..10 && still.size <= 2) { "The plan holds no run, or too many." }
    val picture = json.getJSONObject("picture")
    val cool = json.getJSONObject("cool")
    return LivePlan(
      json.getInt("people").also { check(it == 1) { "The live test asks for one person." } },
      json.getDouble("minDetection").toFloat(),
      json.getDouble("minPresence").toFloat(),
      json.getDouble("minTracking").toFloat(),
      picture.getInt("width"),
      picture.getInt("height"),
      still,
      live,
      json.getInt("stillSeconds").also { check(it in 1..60) { "The still body's time is not one this test takes." } },
      json.getInt("minutes").also { check(it in 1..60) { "The run's minutes are not ones this test takes." } },
      json.getInt("settleSeconds").also { check(it in 0..600) { "The wait before a run is not one this test takes." } },
      cool.getInt("least"),
      cool.getInt("most").also { check(it in cool.getInt("least")..60) { "The cooling's minutes are not ones this test takes." } },
    )
  }

  private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

  // ── A still body: its points, ten seconds ────────────────────────────────────────
  private fun stillOne(plan: LivePlan, k: Int, still: StillStep, hint: String) {
    val name = "still.${still.camera}"
    val part = File(out, "$name.jsonl.part")
    try {
      val landmarker = open(plan, still.setup, still.camera)
      try {
        val created = createMs
        val heading = "Still body, the ${still.camera} camera"
        waitForBody(heading, hint)
        part.bufferedWriter().use { w ->
          w.write(header(plan, "still", k, still.camera, still.setup, created) + "\n")
          framesStart = -1L
          frames = w
          val started = SystemClock.elapsedRealtime()
          for (s in 0 until plan.stillSeconds) {
            say("still", s, plan.stillSeconds, "$heading\n\nKeep the phone still: ${plan.stillSeconds - s} seconds.")
            pause(1000)
            stopIfBroken()
          }
          // The model's thread writes pictures under this same lock, and only while `frames` is this file.
          synchronized(w) {
            frames = null
            w.write(end(plan.stillSeconds, SystemClock.elapsedRealtime() - started, null) + "\n")
          }
        }
      } finally {
        frames = null
        close(landmarker)
      }
      check(part.renameTo(File(out, "$name.jsonl"))) { "The phone could not keep the run's file." }
    } catch (e: Throwable) {
      if (e is Stop) throw e
      failed(name, "still", k, words(e))
    }
  }

  // ── A 20-minute run ──────────────────────────────────────────────────────────────
  /** Returns how warm the phone was when the run's clock started. */
  private fun liveOne(plan: LivePlan, k: Int, setup: LiveSetup): JSONObject? {
    val name = "live.$k"
    val part = File(out, "$name.jsonl.part")
    val seconds = plan.minutes * 60
    val heading = "Run ${k + 1} of ${plan.live.size}: ${setup.model.name.removePrefix("pose_landmarker_")}, ${chipWords(setup)}"
    var startHeat: JSONObject? = null
    try {
      val landmarker = open(plan, setup, "selfie")
      try {
        val created = createMs
        waitForBody(heading, LOOKING)
        part.bufferedWriter().use { w ->
          val head = header(plan, "live", k, "selfie", setup, created)
          startHeat = JSONObject(head).getJSONObject("heat")
          w.write(head + "\n")
          synchronized(lock) { tally = Tally() }
          val started = SystemClock.elapsedRealtime()
          var lastAt = started
          var lastCpu = Process.getElapsedCpuTime()
          var stopped: String? = null
          var s = 0
          while (s < seconds) {
            // Each second on the clock, never after a sleep's length: a slow second is as long as it really was.
            val next = started + (s + 1) * 1000L
            pause(maxOf(0L, next - SystemClock.elapsedRealtime()))
            val now = SystemClock.elapsedRealtime()
            val cpu = Process.getElapsedCpuTime()
            val one = synchronized(lock) { tally.also { tally = Tally() } }
            val wall = now - lastAt
            val charging = plugged()
            w.write(second(s, wall, one, cpu - lastCpu, charging) + "\n")
            if (charging) throw Plugged()
            lastAt = now
            lastCpu = cpu
            s++
            if (s % 60 == 0) w.write(minute(s / 60) + "\n")
            val rate = "%.1f".format(java.util.Locale.ROOT, one.read * 1000.0 / maxOf(1L, wall))
            status = "$heading\n\nMinute ${s / 60 + 1} of ${plan.minutes}\n$rate answers a second\n\nLeave the phone facing the laptop's screen."
            if (s % 10 == 0) progress("running", s, seconds, null)
            stopped = brokenReason()
            if (stopped != null) break
          }
          w.write(end(s, SystemClock.elapsedRealtime() - started, stopped) + "\n")
        }
      } finally {
        close(landmarker)
      }
      check(part.renameTo(File(out, "$name.jsonl"))) { "The phone could not keep the run's file." }
    } catch (e: Throwable) {
      if (e is Stop) throw e
      if (e is Plugged) {
        part.delete()
        throw e
      }
      failed(name, "live", k, words(e))
    }
    return startHeat
  }

  /** Between runs: the camera and the model off, at least the plan's least minutes, then until the phone is no warmer
   *  than at the first run's start (its thermal status, and its battery within 1 °C), at most the plan's most. */
  private fun cool(plan: LivePlan, first: JSONObject?) {
    val started = SystemClock.elapsedRealtime()
    while (true) {
      val minutes = ((SystemClock.elapsedRealtime() - started) / 60_000L).toInt()
      val heat = phoneHeat(context)
      val cool = first != null && heat.getInt("thermal") <= first.getInt("thermal") &&
        !heat.isNull("batteryC") && !first.isNull("batteryC") && heat.getDouble("batteryC") <= first.getDouble("batteryC") + 1.0
      if (minutes >= plan.coolMostMin || (minutes >= plan.coolLeastMin && cool)) return
      say("cooling", minutes, plan.coolMostMin, "Cooling down before the next run: minute ${minutes + 1}.\n\nBattery ${heat.opt("batteryC")} °C. Leave the phone where it is.")
      pause(10_000)
    }
  }

  // ── The camera and the model ─────────────────────────────────────────────────────
  private var createMs = 0.0
  private var cameraThread: ExecutorService? = null

  /** The model in its live mode, and the camera given to it and to the screen. */
  private fun open(plan: LivePlan, setup: LiveSetup, camera: String): PoseLandmarker {
    modelError = null
    lastPicture = SystemClock.elapsedRealtime()
    synchronized(lock) {
      tally = Tally()
      arrivals.clear()
    }
    val began = SystemClock.elapsedRealtimeNanos()
    val landmarker = PoseLandmarker.createFromOptions(context, options(plan, setup))
    createMs = (SystemClock.elapsedRealtimeNanos() - began) / 1_000_000.0
    mirror = camera == "selfie"
    val provider = cameras ?: error("The camera is not ready.")
    val executor = Executors.newSingleThreadExecutor()
    cameraThread = executor
    onMain {
      val aspect = ResolutionSelector.Builder().setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
      val preview = Preview.Builder().setResolutionSelector(aspect.build()).build()
      preview.setSurfaceProvider(screen.preview.surfaceProvider)
      // CameraX names a size as the camera's sensor lies, on its side.
      val wanted = Size(maxOf(plan.width, plan.height), minOf(plan.width, plan.height))
      val analysis = ImageAnalysis.Builder()
        .setResolutionSelector(aspect.setResolutionStrategy(ResolutionStrategy(wanted, ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)).build())
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
        .build()
      analysis.setAnalyzer(executor) { proxy -> picture(proxy, landmarker) }
      provider.unbindAll()
      val selector = if (camera == "back") CameraSelector.DEFAULT_BACK_CAMERA else CameraSelector.DEFAULT_FRONT_CAMERA
      provider.bindToLifecycle(screen, selector, preview, analysis)
    }
    return landmarker
  }

  private fun close(landmarker: PoseLandmarker) {
    cameras?.let { p -> onMain { p.unbindAll() } }
    cameraThread?.let {
      it.shutdown()
      it.awaitTermination(5, TimeUnit.SECONDS)
    }
    cameraThread = null
    landmarker.close()
    screen.skeleton.show(null, 0, 0)
  }

  private fun options(plan: LivePlan, setup: LiveSetup): PoseLandmarker.PoseLandmarkerOptions {
    val model: ByteBuffer = FileInputStream(setup.model.file).channel.use { it.map(FileChannel.MapMode.READ_ONLY, 0, it.size()) }
    val base = BaseOptions.builder()
      .setModelAssetBuffer(model)
      .setDelegate(if (setup.delegate == "gpu") Delegate.GPU else Delegate.CPU)
      .build()
    val options = PoseLandmarker.PoseLandmarkerOptions.builder()
      .setBaseOptions(base)
      .setRunningMode(RunningMode.LIVE_STREAM)
      .setNumPoses(plan.people)
      .setMinPoseDetectionConfidence(plan.minDetection)
      .setMinPosePresenceConfidence(plan.minPresence)
      .setMinTrackingConfidence(plan.minTracking)
      .setOutputSegmentationMasks(false)
      .setResultListener { result: PoseLandmarkerResult, image: MPImage -> answer(result, image) }
      .setErrorListener { e -> modelError = words(e) }
      .build()
    return setup.threads?.let { PhoneTestCores.onCores(options, it) } ?: options
  }

  /** One camera picture, on the camera's thread: turned upright (and mirrored for the selfie camera, as the screen
   *  shows it), as Google's own Android sample does, then handed to the model, which drops it if it is still busy. */
  private fun picture(proxy: ImageProxy, landmarker: PoseLandmarker) {
    val arrived = SystemClock.uptimeMillis()
    lastPicture = SystemClock.elapsedRealtime()
    try {
      val raw = proxy.toBitmap()
      val turn = Matrix().apply {
        postRotate(proxy.imageInfo.rotationDegrees.toFloat())
        if (mirror) postScale(-1f, 1f)
      }
      val upright = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, turn, true)
      if (upright !== raw) raw.recycle()
      val timestamp = synchronized(lock) {
        tally.camera++
        val ts = maxOf(arrived, lastTimestamp + 1)
        lastTimestamp = ts
        arrivals[ts] = arrived
        // A picture the model dropped never gets an answer: forget the old ones.
        if (arrivals.size > 64) arrivals.keys.filter { it < ts - 5000 }.forEach { arrivals.remove(it) }
        ts
      }
      landmarker.detectAsync(BitmapImageBuilder(upright).build(), timestamp)
    } catch (e: Throwable) {
      modelError = words(e)
    } finally {
      proxy.close()
    }
  }

  /** One answer, on the model's thread. */
  private fun answer(result: PoseLandmarkerResult, image: MPImage) {
    val now = SystemClock.uptimeMillis()
    val points = result.landmarks().firstOrNull()?.takeIf { it.size == POINTS }
    synchronized(lock) {
      tally.read++
      if (points != null) tally.found++
      arrivals.remove(result.timestampMs())?.let { tally.waits.add(now - it) }
    }
    frames?.let { w ->
      synchronized(w) {
        if (frames === w) {
          if (framesStart < 0) framesStart = result.timestampMs()
          val t = (result.timestampMs() - framesStart).toDouble()
          val people = if (points == null) "" else person(result) ?: ""
          w.write("{\"kind\":\"frame\",\"t\":$t,\"people\":[$people]}\n")
        }
      }
    }
    screen.skeleton.show(points?.flatMap { listOf(it.x(), it.y()) }?.toFloatArray(), image.width, image.height)
  }

  /** The first person as points.py's person_entry makes it, or null when a number is broken. */
  private fun person(result: PoseLandmarkerResult): String? {
    val points = result.landmarks().firstOrNull() ?: return null
    val world = result.worldLandmarks().firstOrNull()
    if (points.size != POINTS || (world != null && world.size != POINTS)) return null
    val b = StringBuilder("{\"points\":[")
    for ((k, p) in points.withIndex()) {
      val numbers = floatArrayOf(p.x(), p.y(), p.z(), p.visibility().orElse(0f).coerceIn(0f, 1f), p.presence().orElse(0f).coerceIn(0f, 1f))
      if (numbers.any { !it.isFinite() }) return null
      if (k > 0) b.append(',')
      b.append('[').append(numbers.joinToString(",")).append(']')
    }
    b.append("],\"world\":")
    if (world == null) {
      b.append("null")
    } else {
      b.append('[')
      for ((k, p) in world.withIndex()) {
        val numbers = floatArrayOf(p.x(), p.y(), p.z())
        if (numbers.any { !it.isFinite() }) return null
        if (k > 0) b.append(',')
        b.append('[').append(numbers.joinToString(",")).append(']')
      }
      b.append(']')
    }
    return b.append('}').toString()
  }

  /** Waits until the camera has seen a body in each of the last few seconds. */
  private fun waitForBody(heading: String, hint: String) {
    val started = SystemClock.elapsedRealtime()
    var seen = 0
    while (seen < SEEN_FOR_S) {
      status = "Live camera test\n\n$heading\n\n$hint"
      pause(1000)
      stopIfBroken()
      val one = synchronized(lock) { tally.also { tally = Tally() } }
      seen = if (one.read > 0 && one.found * 2 >= one.read) seen + 1 else 0
      if (SystemClock.elapsedRealtime() - started > WAIT_MS) throw IllegalStateException("The camera saw no person for 30 minutes.")
    }
  }

  private fun brokenReason(): String? = when {
    screenGone -> "The test's screen was closed."
    modelError != null -> "The model stopped: $modelError"
    SystemClock.elapsedRealtime() - lastPicture > CAMERA_QUIET_MS -> "The camera gave no picture for 10 seconds."
    else -> null
  }

  private fun stopIfBroken() {
    brokenReason()?.let { throw IllegalStateException(it) }
  }

  // ── What is written ──────────────────────────────────────────────────────────────
  private fun header(plan: LivePlan, part: String, k: Int, camera: String, setup: LiveSetup, created: Double): String {
    val size = screen.skeleton.pictureSize()
    return JSONObject()
      .put("kind", "phone-live")
      .put("version", 1)
      .put("plan", planSum)
      .put("part", part)
      .put("step", k)
      .put("camera", camera)
      .put("picture", JSONObject().put("width", size?.width ?: plan.width).put("height", size?.height ?: plan.height))
      .put(
        "model",
        JSONObject()
          .put("file", setup.model.name)
          .put("sha256", setup.model.sha256)
          .put("people", plan.people)
          .put("minDetection", plan.minDetection.toDouble())
          .put("minPresence", plan.minPresence.toDouble())
          .put("minTracking", plan.minTracking.toDouble()),
      )
      .put("delegate", setup.delegate)
      .put("threads", setup.threads ?: JSONObject.NULL)
      .put(
        "phone",
        JSONObject()
          .put("maker", phoneWords(Build.MANUFACTURER))
          .put("model", phoneWords(Build.MODEL))
          .put("android", phoneWords(Build.VERSION.RELEASE))
          .put("sdk", Build.VERSION.SDK_INT)
          .put("abi", phoneAbi()),
      )
      .put("library", LIBRARY)
      .put("createMs", created)
      .put("heat", phoneHeat(context))
      .put("battery", battery())
      .toString()
  }

  private fun second(s: Int, wallMs: Long, one: Tally, cpuMs: Long, plugged: Boolean): String {
    val waits = one.waits.sorted()
    val wait = if (waits.isEmpty()) JSONObject.NULL else JSONObject().put("middle", waits[(waits.size - 1) / 2]).put("most", waits.last())
    return JSONObject()
      .put("kind", "second")
      .put("s", s)
      .put("wallMs", wallMs)
      .put("camera", one.camera)
      .put("read", one.read)
      .put("found", one.found)
      .put("waitMs", wait)
      .put("cpuMs", cpuMs)
      .put("plugged", plugged)
      .toString()
  }

  private fun minute(m: Int): String {
    val manager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
    val charge = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER)
    val memory = ActivityManager.MemoryInfo().also { (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(it) }
    return JSONObject()
      .put("kind", "minute")
      .put("m", m)
      .put("heat", phoneHeat(context))
      .put("battery", battery())
      .put("chargeUah", if (charge > 0) charge else JSONObject.NULL)
      .put(
        "memory",
        JSONObject()
          .put("appMb", Debug.getPss() / 1024.0)
          .put("freeMb", memory.availMem / (1024.0 * 1024.0))
          .put("low", memory.lowMemory),
      )
      .toString()
  }

  private fun end(seconds: Int, wallMs: Long, stopped: String?): String =
    JSONObject()
      .put("kind", "end")
      .put("seconds", seconds)
      .put("wallMs", wallMs)
      .put("heat", phoneHeat(context))
      .put("battery", battery())
      .put("stopped", stopped ?: JSONObject.NULL)
      .toString()

  /** The battery's charge, whether a charger is in, and whether the battery saver is on. */
  private fun battery(): JSONObject {
    val sticky = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val level = sticky?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = sticky?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
    val plugged = (sticky?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0) != 0
    val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    val percent: Any = if (level >= 0 && scale > 0) (level * 100 + scale / 2) / scale else JSONObject.NULL
    return JSONObject().put("percent", percent).put("plugged", plugged).put("saver", power.isPowerSaveMode)
  }

  private fun failed(name: String, part: String, k: Int, reason: String) {
    File(out, "$name.jsonl.part").delete()
    val json = JSONObject().put("kind", "failed").put("plan", planSum).put("part", part).put("step", k).put("reason", reason)
    File(out, "$name.failed.json").writeText(json.toString())
  }

  /** What the screen says, and where the test is for the laptop. */
  private fun say(stage: String, second: Int, seconds: Int, words: String, reason: String? = null) {
    status = "Live camera test\n\n$words"
    progress(stage, second, seconds, reason)
  }

  /** Written whole, then put in place, so the laptop never reads half of it. */
  private fun progress(stage: String, second: Int, seconds: Int, reason: String?) {
    val json = JSONObject()
      .put("stage", stage)
      .put("step", step)
      .put("steps", steps)
      .put("second", second)
      .put("seconds", seconds)
      .put("reason", reason ?: JSONObject.NULL)
    val part = File(root, "progress.json.part")
    part.writeText(json.toString())
    check(part.renameTo(File(root, "progress.json"))) { "The phone could not write where the test is." }
  }

  private fun chipWords(setup: LiveSetup): String = when {
    setup.delegate == "gpu" -> "the graphics chip"
    setup.threads == null -> "the main chip"
    else -> "the main chip, ${setup.threads} cores"
  }

  /** Short beeps, on the alarm's sound, which a phone set to silent still plays. */
  private fun beep(times: Int) {
    val tone = runCatching { ToneGenerator(AudioManager.STREAM_ALARM, 100) }.getOrNull() ?: return
    try {
      repeat(times) {
        tone.startTone(ToneGenerator.TONE_PROP_BEEP, 300)
        pause(600)
      }
    } finally {
      tone.release()
    }
  }

  /** A wait that ends early, with the whole test, if the screen is closed. */
  private fun pause(ms: Long) {
    val until = SystemClock.elapsedRealtime() + ms
    while (true) {
      if (screenGone) throw Stop("The test's screen was closed.")
      val left = until - SystemClock.elapsedRealtime()
      if (left <= 0) return
      Thread.sleep(minOf(left, 250L))
    }
  }

  private fun waitFor(limitMs: Long, late: String, done: () -> Boolean) {
    val until = SystemClock.elapsedRealtime() + limitMs
    while (!done()) {
      if (SystemClock.elapsedRealtime() > until) throw IllegalStateException(late)
      pause(1000)
    }
  }

  /** Runs on the main thread and waits for it: CameraX is bound there. */
  private fun onMain(work: () -> Unit) {
    val done = CountDownLatch(1)
    var failure: Throwable? = null
    main.post {
      try {
        work()
      } catch (e: Throwable) {
        failure = e
      } finally {
        done.countDown()
      }
    }
    check(done.await(30, TimeUnit.SECONDS)) { "The phone's screen did not answer for 30 seconds." }
    failure?.let { throw it }
  }
}

/** The whole test stops: the screen was closed. */
private class Stop(message: String) : RuntimeException(message)

/** The cable went in during a run: the run is dropped and made again. */
private class Plugged : RuntimeException("The cable went in.")
