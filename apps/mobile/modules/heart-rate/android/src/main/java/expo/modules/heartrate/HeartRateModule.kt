package expo.modules.heartrate

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

// Heart rate from a strap or a watch (ROADMAP Stage 5 item 37f-i): Android's own Bluetooth, and the one
// Heart Rate service every strap and broadcasting watch speaks (0x180D, its measurement 0x2A37).
//
// Written here rather than taken from a package, as the run's voice is (modules/run-voice): the monitor is
// held by the app's process, not by its screen, so its readings go on being kept with the screen locked or
// the app swiped away while a run's location service keeps the app alive. Each reading is kept here as it
// comes, with its monitor's address and the phone's time, and the app takes them when it next looks
// (`take`): with each location point during a run, each second on a page that shows the heart rate. The
// bytes are read by the app's own code (packages/shared/src/heartRate.ts), where they are tested; nothing
// here decides what is a heart rate.
//
// Only the monitor the person picked is ever connected (`watch`, by its Bluetooth address). Looking for
// monitors (`scan`) connects to none.
//
// A monitor whose address changes (most watches, a laptop) is paired once (37f-ii-b): `pair` asks Android,
// which shows its own pairing box; each paired-or-not change Android tells the app of is sent as "bond";
// `bonded` is the phone's list of paired devices. The app's own code works out from that list which lasting
// address to keep (packages/shared/src/heartRate.ts, `pairedAddress`), where it is tested.
class HeartRateModule : Module() {
  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("HeartRate")
    Events("found", "bond")

    /** "on", "off" (Bluetooth switched off) or "none" (no Bluetooth Low Energy on this phone). */
    Function("radio") { radio(context) }

    /** Whether the app may look for and connect to monitors (Android's "Nearby devices"). */
    Function("allowed") { allowed(context) }

    /** Look for heart rate monitors for SCAN_MS; each one heard is sent as "found". */
    Function("scan") { scan() }
    Function("stopScan") { stopScan() }

    /** Connect to this monitor, and keep connecting to it whenever it is in reach, until `unwatch`. */
    Function("watch") { address: String -> context?.let { Strap.watch(it, address) } ?: false }
    Function("unwatch") { Strap.unwatch() }

    /** Every reading since the last take, and forgets them. */
    Function("take") { Strap.take() }

    /** The monitor watched and whether it is connected now. */
    Function("status") { Strap.status() }

    /** Android's own "Turn on Bluetooth?" box. */
    Function("askRadio") { askRadio() }

    /** The addresses of the devices paired with this phone. */
    Function("bonded") { bonded(context) }

    /** Pair with this monitor: "started" (Android asks the person), "already" (paired before), "failed". */
    Function("pair") { address: String -> pair(address) }

    OnCreate { listenForBonds() }
    OnDestroy {
      stopScan()
      stopListeningForBonds()
    }
  }

  // ── Pairing (37f-ii-b) ──────────────────────────────────────────────────────────────────────────

  /** The devices heard while looking, as Android handed them over: pairing one uses the object Android made,
   *  which knows what kind of address it has. */
  private val heardDevices = HashMap<String, BluetoothDevice>()

  @SuppressLint("MissingPermission")
  private fun pair(address: String): String {
    val ctx = context ?: return "failed"
    if (!BluetoothAdapter.checkBluetoothAddress(address) || !allowed(ctx) || radio(ctx) != "on") return "failed"
    val device = synchronized(heardDevices) { heardDevices[address] } ?: adapter(ctx)?.getRemoteDevice(address) ?: return "failed"
    return try {
      when {
        device.bondState == BluetoothDevice.BOND_BONDED -> "already"
        device.bondState == BluetoothDevice.BOND_BONDING -> "started"
        device.createBond() -> "started"
        else -> "failed"
      }
    } catch (e: SecurityException) {
      "failed"
    }
  }

  private var bondListener: BroadcastReceiver? = null

  private fun listenForBonds() {
    val ctx = context ?: return
    val listener = object : BroadcastReceiver() {
      override fun onReceive(c: Context, intent: Intent) {
        val device: BluetoothDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
        } else {
          @Suppress("DEPRECATION")
          intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
        }
        val state = when (intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.ERROR)) {
          BluetoothDevice.BOND_BONDED -> "bonded"
          BluetoothDevice.BOND_BONDING -> "bonding"
          BluetoothDevice.BOND_NONE -> "none"
          else -> return
        }
        val at = device?.address ?: return
        sendEvent("bond", mapOf("device" to at, "state" to state))
      }
    }
    val filter = IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
    try {
      // Android's own message: none from another app is taken.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        ctx.registerReceiver(listener, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        ctx.registerReceiver(listener, filter)
      }
      bondListener = listener
    } catch (e: Exception) {
      // Not listening: a pairing is then seen when the app next reads the list.
    }
  }

  private fun stopListeningForBonds() {
    val listener = bondListener ?: return
    bondListener = null
    try {
      context?.unregisterReceiver(listener)
    } catch (e: IllegalArgumentException) {
      // Already let go.
    }
  }

  // ── Looking for monitors ────────────────────────────────────────────────────────────────────────

  private val main = Handler(Looper.getMainLooper())
  private var scanning: ScanCallback? = null
  private val stopLater = Runnable { stopScan() }

  @SuppressLint("MissingPermission")
  @Synchronized
  private fun scan(): Boolean {
    val ctx = context ?: return false
    if (!allowed(ctx) || radio(ctx) != "on") return false
    val scanner = adapter(ctx)?.bluetoothLeScanner ?: return false
    stopScan()
    synchronized(heardDevices) { heardDevices.clear() }
    val callback = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) = heard(result)
      override fun onBatchScanResults(results: MutableList<ScanResult>) = results.forEach { heard(it) }
    }
    val filters = listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(HEART_SERVICE)).build())
    val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
    return try {
      scanner.startScan(filters, settings, callback)
      scanning = callback
      main.postDelayed(stopLater, SCAN_MS)
      true
    } catch (e: SecurityException) {
      false
    }
  }

  @SuppressLint("MissingPermission")
  private fun heard(result: ScanResult) {
    val name = try {
      result.device.name ?: result.scanRecord?.deviceName ?: ""
    } catch (e: SecurityException) {
      ""
    }
    // Android 15 and later say whether the address is a public one (it never changes) or a random one.
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
      when (result.device.addressType) {
        BluetoothDevice.ADDRESS_TYPE_PUBLIC -> "public"
        BluetoothDevice.ADDRESS_TYPE_RANDOM -> "random"
        else -> "unknown"
      }
    } else {
      "unknown"
    }
    synchronized(heardDevices) {
      if (heardDevices.size < HEARD_MOST) heardDevices[result.device.address] = result.device
    }
    sendEvent("found", mapOf("id" to result.device.address, "name" to name, "rssi" to result.rssi, "type" to type))
  }

  @SuppressLint("MissingPermission")
  @Synchronized
  private fun stopScan() {
    main.removeCallbacks(stopLater)
    val callback = scanning ?: return
    scanning = null
    val ctx = context ?: return
    try {
      adapter(ctx)?.bluetoothLeScanner?.stopScan(callback)
    } catch (e: SecurityException) {
      // Permission taken away while looking: nothing is looking now.
    } catch (e: IllegalStateException) {
      // Bluetooth switched off while looking: the same.
    }
  }

  private fun askRadio(): Boolean {
    val activity = appContext.currentActivity ?: return false
    return try {
      activity.startActivity(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
      true
    } catch (e: SecurityException) {
      false
    } catch (e: android.content.ActivityNotFoundException) {
      false
    }
  }

  companion object {
    val HEART_SERVICE: UUID = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
    val HEART_MEASUREMENT: UUID = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
    /** The descriptor a phone writes to be sent a characteristic's changes (Bluetooth's own). */
    val NOTIFY_SWITCH: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    const val SCAN_MS = 30_000L
    /** At most this many devices heard while looking are kept for pairing. */
    const val HEARD_MOST = 200

    /** The addresses of the devices paired with this phone; none without "Nearby devices". */
    @SuppressLint("MissingPermission")
    fun bonded(ctx: Context?): List<String> {
      if (ctx == null || !allowed(ctx)) return emptyList()
      return try {
        adapter(ctx)?.bondedDevices?.map { it.address } ?: emptyList()
      } catch (e: SecurityException) {
        emptyList()
      }
    }

    fun adapter(ctx: Context): BluetoothAdapter? = (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    fun radio(ctx: Context?): String {
      if (ctx == null || !ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) return "none"
      val adapter = adapter(ctx) ?: return "none"
      return if (adapter.isEnabled) "on" else "off"
    }

    fun allowed(ctx: Context?): Boolean {
      if (ctx == null) return false
      val needs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
      } else {
        listOf(Manifest.permission.ACCESS_FINE_LOCATION)
      }
      return needs.all { ctx.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
    }
  }
}

/** The one monitor the app is connected to, held by the app's process so a run keeps it with the screen
 *  locked. It is only ever called at the address the person picked, so every reading kept here is that
 *  monitor's. A monitor whose address changes (a watch's or a phone's private address) is followed only once
 *  it is paired (37f-ii-b): it is then watched at its lasting address, which Android finds whatever address
 *  it shows. Unpaired, after a change the person finds it again in the box. A stranger's of the same name is
 *  never connected (round one of 37f-i, H1). */
@SuppressLint("MissingPermission")
object Strap {
  /** At most this many readings wait to be taken: hours of them at one a second, then the oldest go. */
  private const val MOST_WAITING = 20_000

  private val main = Handler(Looper.getMainLooper())
  private var address: String? = null
  private var gatt: BluetoothGatt? = null
  private var connected = false
  /** Connections that read the monitor's services and found no heart rate: after NO_HEART_MOST the phone stops
   *  calling it until it is watched again (round one's re-check, L5). */
  private var noHeart = 0
  private const val NO_HEART_MOST = 3
  private val waiting = ArrayDeque<Map<String, Any>>()

  @Synchronized
  fun watch(ctx: Context, to: String): Boolean {
    if (!BluetoothAdapter.checkBluetoothAddress(to)) return false
    if (address == to && gatt != null) return true
    unwatch()
    if (!HeartRateModule.allowed(ctx)) return false
    val device = deviceAt(ctx, to) ?: return false
    address = to
    noHeart = 0
    return connect(ctx.applicationContext, device, again = false)
  }

  @Synchronized
  fun unwatch() {
    address = null
    connected = false
    val was = gatt ?: return
    gatt = null
    try {
      was.disconnect()
      was.close()
    } catch (e: SecurityException) {
      // Permission taken away: Android has let it go itself.
    }
  }

  @Synchronized
  fun take(): List<Map<String, Any>> {
    val out = waiting.toList()
    waiting.clear()
    return out
  }

  @Synchronized
  fun status(): Map<String, Any?> = mapOf("device" to address, "connected" to connected)

  /** The device at this address: the paired one Android keeps where it is paired (it knows its kind of
   *  address and finds it whatever address it shows), else one made from the address. */
  private fun deviceAt(ctx: Context, to: String): BluetoothDevice? {
    val adapter = HeartRateModule.adapter(ctx) ?: return null
    val paired = try {
      adapter.bondedDevices?.firstOrNull { it.address.equals(to, ignoreCase = true) }
    } catch (e: SecurityException) {
      null
    }
    return paired ?: adapter.getRemoteDevice(to)
  }

  /** The first time straight away; after a drop, Android's own reconnect, whenever it is in reach. */
  private fun connect(ctx: Context, device: BluetoothDevice, again: Boolean): Boolean {
    return try {
      gatt = device.connectGatt(ctx, again, callback(ctx), BluetoothDevice.TRANSPORT_LE)
      gatt != null
    } catch (e: SecurityException) {
      false
    }
  }

  private fun callback(ctx: Context) = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
      synchronized(Strap) {
        if (g !== gatt) return
        // Connected with a fault: let it drop, and the drop below connects again (round one, L2).
        if (newState == BluetoothProfile.STATE_CONNECTED && status != BluetoothGatt.GATT_SUCCESS) {
          try {
            g.disconnect()
          } catch (e: SecurityException) {
            // Already let go.
          }
          return
        }
        if (newState == BluetoothProfile.STATE_CONNECTED) {
          connected = true
          main.post {
            try {
              g.discoverServices()
            } catch (e: SecurityException) {
              // Permission taken away: no readings.
            }
          }
          return
        }
        connected = false
        // Dropped (out of reach, switched off): let this one go, and connect again whenever it comes back.
        val to = address ?: return
        val givenUp = noHeart >= NO_HEART_MOST
        try {
          g.close()
        } catch (e: SecurityException) {
          // Already let go.
        }
        gatt = null
        if (givenUp) return
        val device = deviceAt(ctx, to) ?: return
        connect(ctx, device, again = true)
      }
    }

    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
      val measurement = if (status == BluetoothGatt.GATT_SUCCESS) {
        g.getService(HeartRateModule.HEART_SERVICE)?.getCharacteristic(HeartRateModule.HEART_MEASUREMENT)
      } else {
        null
      }
      // Its services not read, or no heart rate among them: let it drop and connect again, never sit
      // connected with no readings (round one, L2).
      if (measurement == null) {
        if (status == BluetoothGatt.GATT_SUCCESS) synchronized(Strap) { noHeart += 1 }
        try {
          g.disconnect()
        } catch (e: SecurityException) {
          // Already let go.
        }
        return
      }
      try {
        g.setCharacteristicNotification(measurement, true)
        val switch = measurement.getDescriptor(HeartRateModule.NOTIFY_SWITCH) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          g.writeDescriptor(switch, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
        } else {
          @Suppress("DEPRECATION")
          switch.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
          @Suppress("DEPRECATION")
          g.writeDescriptor(switch)
        }
      } catch (e: SecurityException) {
        // Permission taken away: no readings.
      }
    }

    // The monitor says its services moved (a laptop serving a strap restarts it; seen on 37f-ii-b's walk, the
    // readings stopping though still connected): read them again, and ask for the heart rate again.
    override fun onServiceChanged(g: BluetoothGatt) {
      synchronized(Strap) { if (g !== gatt) return }
      main.post {
        try {
          g.discoverServices()
        } catch (e: SecurityException) {
          // Permission taken away: no readings.
        }
      }
    }

    // Android 13 and later call this one alone.
    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      keep(g, characteristic, value)
    }

    // Before Android 13.
    @Deprecated("Android 12 and before")
    override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return
      @Suppress("DEPRECATION")
      keep(g, characteristic, characteristic.value ?: return)
    }
  }

  private fun keep(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
    if (characteristic.uuid != HeartRateModule.HEART_MEASUREMENT) return
    val at = System.currentTimeMillis()
    synchronized(Strap) {
      if (g !== gatt) return
      val from = address ?: return
      waiting.addLast(mapOf("device" to from, "at" to at.toDouble(), "bytes" to value.map { it.toInt() and 0xff }))
      while (waiting.size > MOST_WAITING) waiting.removeFirst()
    }
  }
}
