package expo.modules.runmotion

import android.content.Context
import android.hardware.GeomagneticField
import android.hardware.display.DisplayManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.Display
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.floor
import kotlin.math.sqrt

// The phone's motion during a run (ROADMAP Stage 5 item 37i): Android's own accelerometer, which needs no
// permission. A phone on somebody who walks or runs is shaken at every step; one on somebody who stands is not,
// however unsure the GPS is of where it is.
//
// Held by the app's process, not by its screen, as the heart rate monitor is (modules/heart-rate): the readings are
// summed for as long as the app's process lives, the screen locked included only while Android keeps the app working
// (a phone set to Restricted in its battery settings takes the run's service off foreground; Start says so, 37l). For each second
// it keeps one number, the standard deviation over that second of the acceleration's size (gravity included, so
// how the phone is held does not matter), and the app takes them when it next looks (`take`), with each batch of
// location points. Nothing here decides what is still or moving: the app's own code does, where it is tested.
class RunMotionModule : Module() {
  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("RunMotion")

    /** Start reading the accelerometer: false on a phone with none. Started twice, it is one listener. */
    Function("start") { context?.let { Motion.start(it) } ?: false }

    /** Stop reading it, and forget what was not taken. */
    Function("stop") { Motion.stop() }

    /** The seconds finished since the last take, oldest first: { at, sd, n }. */
    Function("take") { Motion.take() }

    Events("heading")

    /** Start reading the compass (37p), while a run's map is on screen: false on a phone with none. Each reading is
     *  sent as "heading": { r, rotation, declination, accuracy, status }. Started twice, it is one listener. */
    Function("compassStart") { context?.let { ctx -> Compass.start(ctx) { said -> sendEvent("heading", said) } } ?: false }

    /** Stop reading the compass. */
    Function("compassStop") { Compass.stop() }

    /** Where the person is, for the gap between magnetic and true north there. */
    Function("compassPlace") { lat: Double, lng: Double -> Compass.place(lat, lng) }

    OnDestroy {
      Motion.stop()
      Compass.stop()
    }
  }
}

// The phone's compass, for the beam on a run's map (ROADMAP Stage 5 item 37p), as Strava's and Google Maps' beam turns
// with the phone. Android's rotation vector, which fuses the compass with the gyroscope and the accelerometer (smooth,
// where the compass alone jumps); on a phone with no gyroscope, its compass with the accelerometer alone. Neither needs
// a permission. Nothing here works out which way the phone points: each reading is handed over as Android gives it (the
// rotation matrix, Android's own estimate of its error, the screen's turn from the phone's natural way up, and how far
// magnetic north lies from true north at the person's place), and the app's own code works it out, where every way of
// holding a phone is tested (src/screens/running/compassHeading.ts). Read only while the map is on screen; nothing is kept.
object Compass : SensorEventListener {
  /** About 20 readings a second, and never handed over more often than LEAST_MS however Android batches them. */
  private const val SAMPLE_US = 50_000
  private const val LEAST_MS = 45L
  /** The gap to true north is worked out again once the person is this far from where it was. */
  private const val REPLACE_M = 1_000f
  /** The screen's turn is read again at most this often (a folding phone opened during a run). */
  private const val ROTATION_MS = 1_000L

  private var manager: SensorManager? = null
  private var thread: HandlerThread? = null
  private var send: ((Map<String, Any>) -> Unit)? = null
  private var displays: DisplayManager? = null
  private val matrix = FloatArray(9)
  private var declination = 0.0
  private var placeLat = Double.NaN
  private var placeLng = Double.NaN
  private var rotation = 0
  private var rotationAt = Long.MIN_VALUE
  private var lastAt = Long.MIN_VALUE

  @Synchronized
  fun start(ctx: Context, onReading: (Map<String, Any>) -> Unit): Boolean {
    send = onReading
    if (manager != null) return true
    var started: HandlerThread? = null
    return try {
      val sensors = ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return false
      val compass = sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
        ?: sensors.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR)
        ?: return false
      displays = ctx.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
      started = HandlerThread("run-compass").also { it.start() }
      if (!sensors.registerListener(this, compass, SAMPLE_US, Handler(started.looper))) {
        started.quitSafely()
        return false
      }
      manager = sensors
      thread = started
      true
    } catch (e: Exception) {
      // A compass that fails leaves the beam showing the way travelled.
      started?.quitSafely()
      false
    }
  }

  @Synchronized
  fun stop() {
    try {
      manager?.unregisterListener(this)
    } catch (e: Exception) {
      // Already let go by Android.
    }
    try {
      thread?.quitSafely()
    } catch (e: Exception) {
      // Already ended.
    }
    manager = null
    thread = null
    send = null
    displays = null
    lastAt = Long.MIN_VALUE
    rotationAt = Long.MIN_VALUE
  }

  @Synchronized
  fun place(lat: Double, lng: Double) {
    if (!lat.isFinite() || !lng.isFinite() || lat < -90 || lat > 90 || lng < -180 || lng > 180) return
    try {
      if (placeLat.isFinite()) {
        val apart = FloatArray(1)
        Location.distanceBetween(placeLat, placeLng, lat, lng, apart)
        if (apart[0] < REPLACE_M) return
      }
      declination = GeomagneticField(lat.toFloat(), lng.toFloat(), 0f, System.currentTimeMillis()).declination.toDouble()
      placeLat = lat
      placeLng = lng
    } catch (e: Exception) {
      // The gap stays as it was.
    }
  }

  /** The screen's turn from the phone's natural way up, in quarter turns (Surface.ROTATION_0 to ROTATION_270): a
   *  tablet whose natural way up is landscape runs this portrait app turned a quarter. */
  private fun screenTurn(now: Long): Int {
    if (rotationAt != Long.MIN_VALUE && now - rotationAt < ROTATION_MS) return rotation
    rotationAt = now
    rotation = try {
      (displays?.getDisplay(Display.DEFAULT_DISPLAY)?.rotation ?: 0).coerceIn(0, 3)
    } catch (e: Exception) {
      rotation
    }
    return rotation
  }

  @Synchronized
  override fun onSensorChanged(event: SensorEvent) {
    // A reading already on its way when the map closed is nobody's.
    if (manager == null) return
    try {
      val now = SystemClock.elapsedRealtime()
      if (lastAt != Long.MIN_VALUE && now - lastAt < LEAST_MS) return
      val values = event.values
      // Android's own estimate of the heading's error, in radians, where the phone gives one; -1 where not.
      val accuracy = if (values.size >= 5 && values[4].isFinite()) values[4].toDouble() else -1.0
      // Some phones refuse more than four numbers here.
      SensorManager.getRotationMatrixFromVector(matrix, if (values.size > 4) values.copyOf(4) else values)
      if (!matrix.all { it.isFinite() }) return
      lastAt = now
      send?.invoke(
        mapOf(
          "r" to matrix.map { it.toDouble() },
          "rotation" to screenTurn(now),
          "declination" to declination,
          "accuracy" to accuracy,
          "status" to event.accuracy.coerceIn(-1, 3),
        ),
      )
    } catch (e: Exception) {
      // One reading that cannot be read is left out.
    }
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
}

object Motion : SensorEventListener {
  /** 25 readings a second, handed over at least once a second. */
  private const val SAMPLE_US = 40_000
  private const val LATENCY_US = 1_000_000
  /** At most this many seconds wait to be taken (15 minutes), then the oldest go. */
  private const val MOST_WAITING = 900
  /** A second with fewer readings than this was not reported: not known, never still. */
  private const val LEAST_READINGS = 10
  /** The sensor's clock is set against the phone's over this long. */
  private const val CLOCK_WINDOW_NS = 10_000_000_000L

  private var manager: SensorManager? = null
  private var thread: HandlerThread? = null
  private val waiting = ArrayDeque<Map<String, Any>>()

  /** The second being summed (ms since 1970 / 1000), and its sums, taken from its first size so the sum of the
   *  squares loses nothing to the size of gravity. */
  private var second = Long.MIN_VALUE
  private var count = 0
  private var first = 0.0
  private var sum = 0.0
  private var sumSquares = 0.0

  /** A sensor's time is since the phone started, on a clock that differs between phones, so it is never a time of
   *  day by itself. The phone's clock less the sensor's is smallest for the reading handed over soonest: kept
   *  here over the last CLOCK_WINDOW_NS, smallest first, as [sensor ns, phone ms less sensor ms]. */
  private val offsets = ArrayDeque<Pair<Long, Double>>()

  @Synchronized
  fun start(ctx: Context): Boolean {
    if (manager != null) return true
    var started: HandlerThread? = null
    return try {
      val sensors = ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return false
      // The ordinary one, which never wakes the phone by itself. The one that does (`getDefaultSensor(type, true)`)
      // wakes it every second for the whole run and did not bring the readings back with the screen off (37i);
      // Whether it is needed with the screen off is not measured: Kd's phone closed the development copy within seconds (37l).
      val accelerometer = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return false
      started = HandlerThread("run-motion").also { it.start() }
      if (!sensors.registerListener(this, accelerometer, SAMPLE_US, LATENCY_US, Handler(started.looper))) {
        started.quitSafely()
        return false
      }
      manager = sensors
      thread = started
      true
    } catch (e: Exception) {
      // A sensor that fails leaves the run with no motion; it never stops the run.
      started?.quitSafely()
      false
    }
  }

  @Synchronized
  fun stop() {
    try {
      manager?.unregisterListener(this)
    } catch (e: Exception) {
      // Already let go by Android.
    }
    try {
      thread?.quitSafely()
    } catch (e: Exception) {
      // Already ended.
    }
    manager = null
    thread = null
    waiting.clear()
    offsets.clear()
    second = Long.MIN_VALUE
    count = 0
  }

  @Synchronized
  fun take(): List<Map<String, Any>> {
    val out = waiting.toList()
    waiting.clear()
    return out
  }

  @Synchronized
  override fun onSensorChanged(event: SensorEvent) {
    // A reading already on its way when the run stopped is no run's.
    if (manager == null) return
    try {
      val values = event.values
      if (values.size < 3) return
      val x = values[0].toDouble()
      val y = values[1].toDouble()
      val z = values[2].toDouble()
      val size = sqrt(x * x + y * y + z * z)
      if (!size.isFinite()) return
      val ns = event.timestamp
      val offset = System.currentTimeMillis() - ns / 1e6
      while (offsets.isNotEmpty() && offsets.last().second >= offset) offsets.removeLast()
      offsets.addLast(ns to offset)
      while (offsets.size > 1 && ns - offsets.first().first > CLOCK_WINDOW_NS) offsets.removeFirst()
      val at = ns / 1e6 + offsets.first().second
      val its = floor(at / 1000.0).toLong()
      if (its > second) {
        close()
        second = its
      }
      if (count == 0) first = size
      val d = size - first
      count += 1
      sum += d
      sumSquares += d * d
    } catch (e: Exception) {
      // One reading that cannot be read is left out.
    }
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  /** The second summed so far is finished: kept if the sensor reported it. */
  private fun close() {
    if (second != Long.MIN_VALUE && count >= LEAST_READINGS) {
      val mean = sum / count
      val sd = sqrt(maxOf(0.0, sumSquares / count - mean * mean))
      waiting.addLast(mapOf("at" to (second + 1) * 1000.0, "sd" to sd, "n" to count))
      while (waiting.size > MOST_WAITING) waiting.removeFirst()
    }
    count = 0
    sum = 0.0
    sumSquares = 0.0
  }
}
