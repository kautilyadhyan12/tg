package expo.modules.runmotion

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.floor
import kotlin.math.sqrt

// The phone's motion during a run (ROADMAP Stage 5 item 37i): Android's own accelerometer, which needs no
// permission. A phone on somebody who walks or runs is shaken at every step; one on somebody who stands is not,
// however unsure the GPS is of where it is.
//
// Held by the app's process, not by its screen, as the heart rate monitor is (modules/heart-rate): the readings
// go on being summed with the screen locked while a run's location service keeps the app alive. For each second
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

    OnDestroy { Motion.stop() }
  }
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
      // The one that wakes the phone to hand its readings over: Android drops the other's readings while the phone
      // sleeps once its small store is full (100 readings, 4 s, on Kd's moto g35; this one keeps 200 and wakes it).
      val accelerometer = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER, true)
        ?: sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        ?: return false
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
