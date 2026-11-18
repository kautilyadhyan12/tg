package expo.modules.phonetest

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.components.containers.Landmark
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import com.google.mediapipe.tasks.vision.poselandmarker.PhoneTestCores
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.Writer
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.security.MessageDigest
import java.util.Locale
import java.util.Optional
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

// The phone test (ROADMAP Stage 5 items 51a and 51b): Kd's reference videos through the phone's own pose model, so the laptop
// can see whether the phone gives the numbers every exercise is set from. The laptop's half is
// packages/movement/scripts/phone-test.ts: it puts the videos, the models and a plan in this app's own files, opens
// PhoneTestActivity, takes back one file a run and deletes everything. What each file holds is read there through
// packages/shared/src/movement.ts. This side reads, never judges: every number goes back as the model gave it, made the
// way the laptop's points.py makes it (the same settings, the very frames it read, its timestamps).

/** The pose library the app is built with: build.gradle's version, held to it by apps/mobile/test/phoneTest.test.ts. */
internal const val LIBRARY = "tasks-vision 1.0.0"
private const val POINTS = 33
private const val BATCH = 8
/** The plan this copy reads: version 2 names each run's cores (51b). */
private const val PLAN_VERSION = 2
private const val MAX_THREADS = 8
internal val PLAIN = Regex("^[A-Za-z0-9_-]{1,80}$")
internal val HEX = Regex("^[0-9a-f]{64}$")

private class Frame(val i: Int, val t: Double, val ts: Long)
/** A video, or (fromLaptop) the folder of the laptop's own decoded pictures of it. */
private class Video(val label: String, val file: File, val sha256: String, val frames: List<Frame>, val fromLaptop: Boolean)
internal class Model(val name: String, val file: File, val sha256: String)
/** threads: the main chip's cores, or null for the library's own number. */
private class Run(val model: Model, val delegate: String, val threads: Int?)
private class Plan(
  val videos: List<Video>,
  val runs: List<Run>,
  val people: Int,
  val minDetection: Float,
  val minPresence: Float,
  val minTracking: Float,
)

internal class PhoneTest private constructor(private val context: Context) {
  companion object {
    private val running = AtomicBoolean(false)

    /** What the screen shows. */
    @Volatile
    var status: String = "Phone test\n\nGetting ready."

    /** Starts the test unless it is already running: turning the phone opens the screen again. */
    fun startOnce(context: Context) {
      if (!running.compareAndSet(false, true)) return
      thread(name = "phone-test") {
        try {
          PhoneTest(context).run()
        } finally {
          running.set(false)
        }
      }
    }
  }

  private val root = File(context.filesDir, "phone-test")
  private val out = File(root, "out")
  private var runsDone = 0
  private var runsAll = 0
  /** The plan's own check sum, written into every file, so the laptop never reads an older run's file as this one's. */
  private var planSum = ""

  fun run() {
    try {
      // getFramesAtIndex, the frames by their number in the video, came with Android 9.
      check(Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) { "This test needs Android 9 or later." }
      out.deleteRecursively()
      check(out.mkdirs()) { "The phone could not make the test's folder." }
      status = "Phone test\n\nChecking the files from the laptop."
      planSum = sha256(listOf(File(root, "plan.json")))
      val plan = readPlan()
      for (video in plan.videos) check(sha256(filesOf(video)) == video.sha256) { "The video ${video.label} did not arrive whole." }
      for (model in plan.runs.map { it.model }.distinct()) check(sha256(listOf(model.file)) == model.sha256) { "The model ${model.name} did not arrive whole." }
      runsAll = plan.videos.size * plan.runs.size
      for ((v, video) in plan.videos.withIndex()) {
        for (each in plan.runs) {
          runsDone++
          runOne(plan, video, each, v + 1, plan.videos.size)
        }
      }
      progress("done", 0, 0, null)
      status = "Phone test done.\n\nYou can unplug the phone."
    } catch (e: Throwable) {
      val reason = words(e)
      status = "The phone test stopped.\n\n$reason"
      runCatching { progress("failed", 0, 0, reason) }
    }
  }

  // ── The plan ─────────────────────────────────────────────────────────────────────
  private fun readPlan(): Plan {
    val json = JSONObject(File(root, "plan.json").readText())
    check(json.getInt("version") == PLAN_VERSION) { "The laptop's plan is not one this copy of the app reads: build the app again." }
    val models = json.getJSONArray("models").objects().map { m ->
      val name = plain(m.getString("name"))
      Model(name, File(root, "models/$name.task"), hex(m.getString("sha256")))
    }.associateBy { it.name }
    val runs = json.getJSONArray("runs").objects().map { r ->
      val model = models[r.getString("model")] ?: error("The plan runs a model it does not send.")
      val delegate = r.getString("delegate")
      check(delegate == "cpu" || delegate == "gpu") { "The plan names a chip this test does not know." }
      check(r.has("threads")) { "The plan does not say each run's cores." }
      val threads = if (r.isNull("threads")) null else r.getInt("threads")
      check(threads == null || (delegate == "cpu" && threads in 1..MAX_THREADS)) { "The plan sets cores the main chip cannot take." }
      Run(model, delegate, threads)
    }
    val videos = json.getJSONArray("videos").objects().map { v ->
      val label = plain(v.getString("label"))
      val list = v.getJSONArray("frames")
      val frames = (0 until list.length()).map { k ->
        val f = list.getJSONArray(k)
        Frame(f.getInt(0), f.getDouble(1), f.getLong(2))
      }
      check(frames.isNotEmpty()) { "The plan gives no frames for $label." }
      check(frames.zipWithNext().all { (a, b) -> b.i > a.i && b.ts > a.ts }) { "The plan's frames for $label are not in order." }
      val fromLaptop = when (v.optString("pictures", "video")) {
        "video" -> false
        "laptop" -> true
        else -> error("The plan names pictures this test does not know.")
      }
      val file = if (fromLaptop) File(root, "videos/$label") else File(root, "videos/$label.mp4")
      Video(label, file, hex(v.getString("sha256")), frames, fromLaptop)
    }
    check(videos.isNotEmpty() && runs.isNotEmpty()) { "The plan holds nothing to run." }
    return Plan(
      videos,
      runs,
      json.getInt("people"),
      json.getDouble("minDetection").toFloat(),
      json.getDouble("minPresence").toFloat(),
      json.getDouble("minTracking").toFloat(),
    )
  }

  private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

  private fun plain(name: String): String {
    check(PLAIN.matches(name)) { "The plan holds a name that is not plain." }
    return name
  }

  private fun hex(value: String): String {
    check(HEX.matches(value)) { "The plan holds a file check that is not one." }
    return value
  }

  // ── One run: one video, one model, one chip ──────────────────────────────────────
  private fun runOne(plan: Plan, video: Video, each: Run, v: Int, videos: Int) {
    val name = "${video.label}.${each.model.name}.${each.delegate}" + (each.threads?.let { ".t$it" } ?: "")
    val chip = when {
      each.delegate == "gpu" -> "the graphics chip"
      each.threads == null -> "the main chip"
      else -> "the main chip, ${each.threads} ${if (each.threads == 1) "core" else "cores"}"
    }
    val size = each.model.name.removePrefix("pose_landmarker_")
    val whose = if (video.fromLaptop) ", the laptop's pictures" else ""
    val heading = "Phone test\n\nVideo $v of $videos: ${video.label.removeSuffix("_reference").replace('_', ' ')}$whose\nThe $size model, on $chip"
    status = "$heading\n\nStarting the model."
    val wall = SystemClock.elapsedRealtimeNanos()
    val heatBefore = heat()
    val landmarker = try {
      PoseLandmarker.createFromOptions(context, options(plan, each))
    } catch (e: Throwable) {
      failed(name, video, each, "The model did not start on $chip: ${words(e)}")
      return
    }
    val createMs = since(wall)
    try {
      val part = File(out, "$name.jsonl.part")
      var leftOut = 0
      var done = 0
      part.bufferedWriter().use { w ->
        pictures(video) { frame, picture, at, decodeMs, count ->
          if (done == 0) w.write(header(plan, video, each, picture, count, createMs, heatBefore) + "\n")
          val image = BitmapImageBuilder(picture).build()
          val cpuStarted = Process.getElapsedCpuTime()
          val detectStarted = SystemClock.elapsedRealtimeNanos()
          val result = landmarker.detectForVideo(image, frame.ts)
          val detectMs = since(detectStarted)
          // The whole app's time on the cores while the model read: over detectMs, how many cores it kept busy.
          val cpuMs = (Process.getElapsedCpuTime() - cpuStarted).toDouble()
          // Closing the image recycles its picture.
          image.close()
          leftOut += writeFrame(w, frame, at, decodeMs, detectMs, cpuMs, result)
          done++
          if (done % 10 == 0 || done == video.frames.size) {
            progress("running", done, video.frames.size, null)
            status = "$heading\n\nPicture $done of ${video.frames.size}\n\nKeep the phone on its cable."
          }
        }
        check(done == video.frames.size) { "The phone read $done of the ${video.frames.size} frames of ${video.label}." }
        val end = JSONObject()
          .put("kind", "end")
          .put("frames", done)
          .put("leftOut", leftOut)
          .put("wallMs", since(wall))
          .put("heat", heat())
        w.write(end.toString() + "\n")
      }
      check(part.renameTo(File(out, "$name.jsonl"))) { "The phone could not keep the run's file." }
    } catch (e: Throwable) {
      failed(name, video, each, words(e))
    } finally {
      landmarker.close()
    }
  }

  /** Every frame the plan names, in order: its picture, its time on the phone's own clock, how long the picture took
   *  to make, and how many frames the source holds. */
  private fun pictures(video: Video, each: (Frame, Bitmap, Double, Double, Int) -> Unit) {
    if (video.fromLaptop) laptopPictures(video, each) else videoPictures(video, each)
  }

  /** The phone's own video decoder, the video's frames by their number in it. */
  private fun videoPictures(video: Video, each: (Frame, Bitmap, Double, Double, Int) -> Unit) {
    val times = playTimes(video.file)
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(video.file.path)
      val count = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT)?.toIntOrNull()
        ?: error("The phone cannot count the frames of ${video.label}.")
      val last = video.frames.last().i
      check(last < count && last < times.size) { "The phone counts $count frames in ${video.label}; the laptop kept frame ${last + 1}." }
      val wanted = video.frames.associateBy { it.i }
      val params = MediaMetadataRetriever.BitmapParams().apply { preferredConfig = Bitmap.Config.ARGB_8888 }
      var start = 0
      while (start <= last) {
        val wantedHere = minOf(BATCH, last - start + 1)
        val decodeStarted = SystemClock.elapsedRealtimeNanos()
        val batch = retriever.getFramesAtIndex(start, wantedHere, params)
        check(batch.size == wantedHere) { "The phone gave ${batch.size} of $wantedHere frames of ${video.label}." }
        val decodeMs = since(decodeStarted) / wantedHere
        for ((k, picture) in batch.withIndex()) {
          val frame = wanted[start + k]
          if (frame == null) picture.recycle() else each(frame, picture, times[frame.i], decodeMs, count)
        }
        start += wantedHere
      }
    } finally {
      retriever.release()
    }
  }

  /** The laptop's own decoded pictures (points.py frames --pictures), one PNG a kept frame, read exactly as written:
   *  with them, what still differs from the laptop is the model's part alone. */
  private fun laptopPictures(video: Video, each: (Frame, Bitmap, Double, Double, Int) -> Unit) {
    val options = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }
    for ((k, frame) in video.frames.withIndex()) {
      val started = SystemClock.elapsedRealtimeNanos()
      val picture = BitmapFactory.decodeFile(pictureFile(video, k).path, options)
        ?: error("The laptop's picture ${k + 1} of ${video.label} cannot be read.")
      each(frame, picture, frame.t, since(started), video.frames.size)
    }
  }

  private fun pictureFile(video: Video, k: Int): File = File(video.file, String.format(Locale.ROOT, "%05d.png", k))

  /** The files a video came in, in order: the video, or the laptop's pictures. */
  private fun filesOf(video: Video): List<File> =
    if (video.fromLaptop) video.frames.indices.map { pictureFile(video, it) } else listOf(video.file)

  /** The laptop's settings (points.py): the video's own frames in order, as many people as the plan asks, the same three
   *  limits; on the main chip, the plan's cores where it sets them (PhoneTestCores). */
  private fun options(plan: Plan, each: Run): PoseLandmarker.PoseLandmarkerOptions {
    val model: ByteBuffer = FileInputStream(each.model.file).channel.use { it.map(FileChannel.MapMode.READ_ONLY, 0, it.size()) }
    val base = BaseOptions.builder()
      .setModelAssetBuffer(model)
      .setDelegate(if (each.delegate == "gpu") Delegate.GPU else Delegate.CPU)
      .build()
    val options = PoseLandmarker.PoseLandmarkerOptions.builder()
      .setBaseOptions(base)
      .setRunningMode(RunningMode.VIDEO)
      .setNumPoses(plan.people)
      .setMinPoseDetectionConfidence(plan.minDetection)
      .setMinPosePresenceConfidence(plan.minPresence)
      .setMinTrackingConfidence(plan.minTracking)
      .setOutputSegmentationMasks(false)
      .build()
    return each.threads?.let { PhoneTestCores.onCores(options, it) } ?: options
  }

  /** Each frame's time as the phone plays the video, from its first frame, in the order it plays. */
  private fun playTimes(file: File): DoubleArray {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(file.path)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true
      } ?: error("The phone finds no pictures in ${file.name}.")
      extractor.selectTrack(track)
      val times = ArrayList<Long>()
      while (true) {
        val at = extractor.sampleTime
        if (at < 0) break
        times.add(at)
        if (!extractor.advance()) break
      }
      times.sort()
      val first = times.firstOrNull() ?: 0L
      return DoubleArray(times.size) { (times[it] - first) / 1000.0 }
    } finally {
      extractor.release()
    }
  }

  // ── What is written ──────────────────────────────────────────────────────────────
  private fun header(plan: Plan, video: Video, each: Run, picture: Bitmap, count: Int, createMs: Double, heat: JSONObject): String =
    JSONObject()
      .put("kind", "phone-run")
      .put("version", 1)
      .put("label", video.label)
      .put("plan", planSum)
      .put("video", JSONObject().put("sha256", video.sha256).put("frames", count))
      .put("picture", JSONObject().put("width", picture.width).put("height", picture.height))
      .put("pictures", if (video.fromLaptop) "laptop" else "video")
      .put(
        "model",
        JSONObject()
          .put("file", each.model.name)
          .put("sha256", each.model.sha256)
          .put("people", plan.people)
          .put("minDetection", plan.minDetection.toDouble())
          .put("minPresence", plan.minPresence.toDouble())
          .put("minTracking", plan.minTracking.toDouble()),
      )
      .put("delegate", each.delegate)
      .put("threads", each.threads ?: JSONObject.NULL)
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
      .put("createMs", createMs)
      .put("heat", heat)
      .toString()

  /** One frame's line; returns how many people were left out for a broken number. */
  private fun writeFrame(w: Writer, frame: Frame, at: Double, decodeMs: Double, detectMs: Double, cpuMs: Double, result: PoseLandmarkerResult): Int {
    val people = StringBuilder()
    var leftOut = 0
    val world = result.worldLandmarks()
    for ((n, points) in result.landmarks().withIndex()) {
      val person = person(points, world.getOrNull(n))
      if (person == null) {
        leftOut++
        continue
      }
      if (people.isNotEmpty()) people.append(',')
      people.append(person)
    }
    w.write("{\"i\":${frame.i},\"t\":${frame.t},\"at\":$at,\"decodeMs\":$decodeMs,\"detectMs\":$detectMs,\"cpuMs\":$cpuMs,\"people\":[$people]}\n")
    return leftOut
  }

  /** One person as points.py's person_entry makes it, or null when a number is broken. */
  private fun person(points: List<NormalizedLandmark>, world: List<Landmark>?): String? {
    if (points.size != POINTS || (world != null && world.size != POINTS)) return null
    val b = StringBuilder("{\"points\":[")
    for ((k, p) in points.withIndex()) {
      val numbers = floatArrayOf(p.x(), p.y(), p.z(), sure(p.visibility(), "visibility"), sure(p.presence(), "presence"))
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

  /** Sureness as the model gives it, held to 0..1 as points.py holds it; a model that gives none stops the run. */
  private fun sure(value: Optional<Float>, what: String): Float {
    check(value.isPresent) { "The pose model gave no $what for a point; this test needs it." }
    return value.get().coerceIn(0f, 1f)
  }

  private fun failed(name: String, video: Video, each: Run, reason: String) {
    val json = JSONObject()
      .put("kind", "failed")
      .put("label", video.label)
      .put("plan", planSum)
      .put("model", each.model.name)
      .put("delegate", each.delegate)
      .put("threads", each.threads ?: JSONObject.NULL)
      .put("reason", reason)
    File(out, "$name.jsonl.part").delete()
    File(out, "$name.failed.json").writeText(json.toString())
  }

  /** Where the test is, for the laptop: written whole, then put in place, so it never reads half of it. */
  private fun progress(state: String, frame: Int, frames: Int, reason: String?) {
    val json = JSONObject()
      .put("state", state)
      .put("run", runsDone)
      .put("runs", runsAll)
      .put("frame", frame)
      .put("frames", frames)
      .put("reason", reason ?: JSONObject.NULL)
    val part = File(root, "progress.json.part")
    part.writeText(json.toString())
    check(part.renameTo(File(root, "progress.json"))) { "The phone could not write where the test is." }
  }

  private fun heat(): JSONObject = phoneHeat(context)

  private fun since(started: Long): Double = (SystemClock.elapsedRealtimeNanos() - started) / 1_000_000.0
}

/** Android's thermal status and the battery's temperature. */
internal fun phoneHeat(context: Context): JSONObject {
  val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
  val thermal = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) power.currentThermalStatus else -1
  val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
  val tenths = battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE) ?: Int.MIN_VALUE
  val celsius: Any = if (tenths == Int.MIN_VALUE) JSONObject.NULL else tenths / 10.0
  return JSONObject().put("thermal", thermal).put("batteryC", celsius)
}

/** One check sum over the files one after another, as the laptop makes it. */
internal fun sha256(files: List<File>): String {
  val digest = MessageDigest.getInstance("SHA-256")
  val buffer = ByteArray(1 shl 16)
  for (file in files) {
    FileInputStream(file).use { input ->
      while (true) {
        val n = input.read(buffer)
        if (n < 0) break
        digest.update(buffer, 0, n)
      }
    }
  }
  return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
}

internal fun phoneAbi(): String = Build.SUPPORTED_ABIS.firstOrNull()?.takeIf { PLAIN.matches(it) } ?: "unknown"

/** A phone's own name in plain characters only, as the laptop reads it. */
internal fun phoneWords(text: String?): String {
  val plain = (text ?: "").replace(Regex("[^A-Za-z0-9 _.,:()+/-]"), "_").take(80)
  return plain.ifBlank { "unknown" }
}

/** What went wrong, in one plain line the laptop can show. */
internal fun words(e: Throwable): String {
  val said = e.message?.takeIf { it.isNotBlank() } ?: e.javaClass.simpleName
  return said.replace(Regex("[^\\x20-\\x7E]"), " ").take(300)
}
