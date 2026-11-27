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
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.os.SystemClock
import android.provider.Settings
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

    /** True on Android 11 and older with Location off, where no monitor can be heard (Android's own rule). */
    Function("locationOff") { locationOff(context) }

    /** Look for heart rate monitors for SCAN_MS; each one heard is sent as "found". */
    Function("scan") { scan() }
    Function("stopScan") { stopScan() }

    /** Connect to this monitor, and keep connecting to it whenever it is in reach, until `unwatch`. */
    Function("watch") { address: String -> context?.let { Strap.watch(it, address, synchronized(heardDevices) { heardDevices[address] }) } ?: false }
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

    /** Whether Android has this monitor paired now: "bonded", "bonding", "none", or "unknown". Read each second
     *  while pairing, so Cancel is seen even where Android's own message does not reach the app. */
    Function("bondState") { address: String -> bondState(address) }

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
  private fun bondState(address: String): String {
    val ctx = context ?: return "unknown"
    if (!BluetoothAdapter.checkBluetoothAddress(address) || !allowed(ctx)) return "unknown"
    val device = synchronized(heardDevices) { heardDevices[address] } ?: adapter(ctx)?.getRemoteDevice(address) ?: return "unknown"
    return try {
      when (device.bondState) {
        BluetoothDevice.BOND_BONDED -> "bonded"
        BluetoothDevice.BOND_BONDING -> "bonding"
        else -> "none"
      }
    } catch (e: SecurityException) {
      "unknown"
    }
  }

  @SuppressLint("MissingPermission")
  private fun pair(address: String): String {
    val ctx = context ?: return "failed"
    if (!BluetoothAdapter.checkBluetoothAddress(address) || !allowed(ctx) || radio(ctx) != "on") return "failed"
    // Listening from here too: when the module was made, the app's context may not have been there yet.
    if (bondListener == null) listenForBonds()
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
      // Exported: the message comes from Android's Bluetooth app, not from the system itself, and a receiver that is
      // not exported does not hear it (round one, H1). It is a protected message: no other app can send it.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        ctx.registerReceiver(listener, filter, Context.RECEIVER_EXPORTED)
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

    /** Android 11 and older hear no Bluetooth device while Location is off; 12 and later need no Location. */
    fun locationOff(ctx: Context?): Boolean {
      if (ctx == null || Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        val manager = ctx.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
        return !manager.isLocationEnabled
      }
      @Suppress("DEPRECATION")
      return Settings.Secure.getInt(ctx.contentResolver, Settings.Secure.LOCATION_MODE, Settings.Secure.LOCATION_MODE_OFF) == Settings.Secure.LOCATION_MODE_OFF
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
 *  never connected (round one of 37f-i, H1).
 *
 *  37n: a monitor not paired and not heard since the app started is listened for first, and connected as it
 *  was heard: Android then knows what kind of address it has, which a strap with a random address needs (C4).
 *  Bluetooth switched on again connects it afresh (C1). Connected and sending nothing for QUIET_MS, it is
 *  let go and connected again, which asks it for its heart rate again (C3). */
@SuppressLint("MissingPermission")
object Strap {
  /** At most this many readings wait to be taken: hours of them at one a second, then the oldest go. */
  private const val MOST_WAITING = 20_000
  /** Connected and asked, with no reading for this long: let go and connected again. */
  private const val QUIET_MS = 15_000L
  /** Listening for the monitor is started again this often: Android turns a long scan down to almost nothing
   *  after 30 minutes. */
  private const val FIND_AGAIN_MS = 5 * 60_000L
  /** Let go for being quiet and Android has said nothing this long after: closed here and connected afresh. */
  private const val LET_GO_MS = 5_000L

  private val main = Handler(Looper.getMainLooper())
  private var address: String? = null
  private var gatt: BluetoothGatt? = null
  /** The monitor as Android last handed it over (paired, or heard): connecting again uses it. */
  private var device: BluetoothDevice? = null
  private var connected = false
  /** Whether the monitor has been asked for its heart rate on this connection. */
  private var asked = false
  /** When the last reading came, on the uptime clock. */
  private var heardAt = 0L
  /** Listening for the monitor before connecting (C4); null when not. */
  private var finding: ScanCallback? = null
  private var radioListener: BroadcastReceiver? = null
  private var appContext: Context? = null
  /** Connections that read the monitor's services and found no heart rate: after NO_HEART_MOST the phone stops
   *  calling it until it is watched again (round one's re-check, L5). */
  private var noHeart = 0
  private const val NO_HEART_MOST = 3
  private val waiting = ArrayDeque<Map<String, Any>>()

  private val quietCheck = Runnable { checkQuiet() }
  private val findAgain = Runnable { restartFind() }

  /** Watch this address; `heard` is the device Android handed over while the person looked, if it was. True
   *  while it is watched (Bluetooth off included: it connects when Bluetooth is on); false when the app may
   *  not (Nearby devices refused), so the app asks again later. */
  @Synchronized
  fun watch(ctx: Context, to: String, heard: BluetoothDevice?): Boolean {
    if (!BluetoothAdapter.checkBluetoothAddress(to)) return false
    if (address == to && (gatt != null || finding != null || HeartRateModule.radio(ctx) != "on")) return true
    unwatch()
    if (!HeartRateModule.allowed(ctx)) return false
    val app = ctx.applicationContext
    appContext = app
    listenForRadio(app)
    address = to
    noHeart = 0
    device = heard?.takeIf { it.address.equals(to, ignoreCase = true) }
    start(app)
    return true
  }

  @Synchronized
  fun unwatch() {
    address = null
    device = null
    connected = false
    asked = false
    main.removeCallbacks(quietCheck)
    stopFind()
    letGo()
  }

  @Synchronized
  fun take(): List<Map<String, Any>> {
    val out = waiting.toList()
    waiting.clear()
    return out
  }

  @Synchronized
  fun status(): Map<String, Any?> = mapOf("device" to address, "connected" to connected, "finding" to (finding != null))

  /** Connect to the watched monitor now: the paired one, or the one heard; otherwise listen for it first.
   *  With Bluetooth off nothing is done: Bluetooth coming on starts it. */
  private fun start(ctx: Context) {
    val to = address ?: return
    if (HeartRateModule.radio(ctx) != "on") return
    val known = paired(ctx, to) ?: device
    if (known != null) {
      device = known
      connect(ctx, known, again = false)
    } else {
      find(ctx)
    }
  }

  private fun paired(ctx: Context, to: String): BluetoothDevice? {
    val adapter = HeartRateModule.adapter(ctx) ?: return null
    return try {
      adapter.bondedDevices?.firstOrNull { it.address.equals(to, ignoreCase = true) }
    } catch (e: SecurityException) {
      null
    }
  }

  /** Listen for heart rate monitors until the watched one is heard; every other one heard is passed by. */
  private fun find(ctx: Context) {
    stopFind()
    val scanner = HeartRateModule.adapter(ctx)?.bluetoothLeScanner ?: return
    val callback = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) = heard(ctx, this, result.device)
      override fun onBatchScanResults(results: MutableList<ScanResult>) = results.forEach { heard(ctx, this, it.device) }
    }
    val filters = listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(HeartRateModule.HEART_SERVICE)).build())
    // Low power: a strap says it is there each second, so it is still heard in a few seconds, and a strap left at
    // home costs little for as long as the run holds it (round one, L3).
    val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_POWER).build()
    try {
      scanner.startScan(filters, settings, callback)
      finding = callback
      main.postDelayed(findAgain, FIND_AGAIN_MS)
    } catch (e: SecurityException) {
      // Nearby devices taken away: nothing listens; the app asks again when it is allowed.
    } catch (e: IllegalStateException) {
      // Bluetooth switched off as it began: Bluetooth coming on starts it again.
    }
  }

  private fun heard(ctx: Context, from: ScanCallback, heard: BluetoothDevice) {
    synchronized(this) {
      // Only the address picked is ever connected: a stranger's strap near by is passed by.
      if (finding !== from || !heard.address.equals(address, ignoreCase = true)) return
      stopFind()
      device = heard
      connect(ctx, heard, again = false)
    }
  }

  @Synchronized
  private fun restartFind() {
    val ctx = appContext ?: return
    if (finding == null || address == null) return
    find(ctx)
  }

  private fun stopFind() {
    main.removeCallbacks(findAgain)
    val callback = finding ?: return
    finding = null
    val ctx = appContext ?: return
    try {
      HeartRateModule.adapter(ctx)?.bluetoothLeScanner?.stopScan(callback)
    } catch (e: SecurityException) {
      // Permission taken away: nothing is listening now.
    } catch (e: IllegalStateException) {
      // Bluetooth switched off: the same.
    }
  }

  /** The connection let go, if there is one. */
  private fun letGo() {
    val was = gatt ?: return
    gatt = null
    try {
      was.disconnect()
      was.close()
    } catch (e: SecurityException) {
      // Permission taken away: Android has let it go itself.
    }
  }

  /** Bluetooth switched on connects the watched monitor afresh; switched off, the connection is let go (C1).
   *  Listened for once, for as long as the app runs. */
  private fun listenForRadio(ctx: Context) {
    if (radioListener != null) return
    val listener = object : BroadcastReceiver() {
      override fun onReceive(c: Context, intent: Intent) {
        when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)) {
          BluetoothAdapter.STATE_ON -> radioOn(ctx)
          BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_OFF -> radioOff()
        }
      }
    }
    try {
      // Exported, as the pairing listener is: the message comes from Android's Bluetooth service, and no other
      // app can send it.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        ctx.registerReceiver(listener, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), Context.RECEIVER_EXPORTED)
      } else {
        ctx.registerReceiver(listener, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED))
      }
      radioListener = listener
    } catch (e: Exception) {
      // Not listening: the monitor connects when it is next watched.
    }
  }

  @Synchronized
  private fun radioOn(ctx: Context) {
    if (address == null) return
    connected = false
    asked = false
    main.removeCallbacks(quietCheck)
    stopFind()
    letGo()
    start(ctx)
  }

  @Synchronized
  private fun radioOff() {
    connected = false
    asked = false
    main.removeCallbacks(quietCheck)
    stopFind()
    letGo()
  }

  /** The first time straight away; after a drop, Android's own reconnect, whenever it is in reach. */
  private fun connect(ctx: Context, to: BluetoothDevice, again: Boolean): Boolean {
    return try {
      gatt = to.connectGatt(ctx, again, callback(ctx), BluetoothDevice.TRANSPORT_LE)
      gatt != null
    } catch (e: SecurityException) {
      false
    }
  }

  /** Connected, asked, and nothing sent for QUIET_MS: let go, and the drop connects it again (C3). */
  @Synchronized
  private fun checkQuiet() {
    val g = gatt ?: return
    if (!connected || !asked) return
    if (SystemClock.uptimeMillis() - heardAt < QUIET_MS) {
      main.postDelayed(quietCheck, QUIET_MS)
      return
    }
    asked = false
    try {
      g.disconnect()
    } catch (e: SecurityException) {
      // Permission taken away: no readings.
    }
    // Some phones say nothing after a disconnect from a link half gone: still this connection after LET_GO_MS, it is
    // closed here and connected afresh, never left looking connected with no readings (round one, L2).
    main.postDelayed({ letGoIfStill(g) }, LET_GO_MS)
  }

  @Synchronized
  private fun letGoIfStill(g: BluetoothGatt) {
    if (gatt !== g) return
    connected = false
    asked = false
    letGo()
    appContext?.let { start(it) }
  }

  private fun dropIt(g: BluetoothGatt) {
    try {
      g.disconnect()
    } catch (e: SecurityException) {
      // Already let go.
    }
  }

  private fun callback(ctx: Context) = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
      synchronized(Strap) {
        if (g !== gatt) return
        // Connected with a fault: let it drop, and the drop below connects again (round one, L2).
        if (newState == BluetoothProfile.STATE_CONNECTED && status != BluetoothGatt.GATT_SUCCESS) {
          dropIt(g)
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
        asked = false
        main.removeCallbacks(quietCheck)
        // Dropped (out of reach, switched off): let this one go, and connect again whenever it comes back.
        val to = address ?: return
        val givenUp = noHeart >= NO_HEART_MOST
        try {
          g.close()
        } catch (e: SecurityException) {
          // Already let go.
        }
        gatt = null
        // Bluetooth off: Bluetooth coming on connects it afresh (C1).
        if (givenUp || HeartRateModule.radio(ctx) != "on") return
        val back = paired(ctx, to) ?: device ?: return
        device = back
        connect(ctx, back, again = true)
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
        dropIt(g)
        return
      }
      // No switch to ask with: a monitor with no heart rate to send, which counts towards giving up (round one, L1).
      val switch = measurement.getDescriptor(HeartRateModule.NOTIFY_SWITCH)
      if (switch == null) {
        synchronized(Strap) { noHeart += 1 }
        dropIt(g)
        return
      }
      // Asking for the heart rate refused by this phone (its Bluetooth busy): let it drop and connect again, never sit
      // connected with none (C3). Not counted: the monitor never said no (re-check, N1); its own no comes in
      // onDescriptorWrite.
      val askedNow = try {
        when {
          !g.setCharacteristicNotification(measurement, true) -> false
          Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
            g.writeDescriptor(switch, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == BluetoothStatusCodes.SUCCESS
          else -> {
            @Suppress("DEPRECATION")
            switch.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            @Suppress("DEPRECATION")
            g.writeDescriptor(switch)
          }
        }
      } catch (e: SecurityException) {
        false
      }
      if (!askedNow) dropIt(g)
    }

    // The monitor's answer to being asked for its heart rate: refused is let go and connected again (C3); taken,
    // the quiet check begins.
    override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      if (descriptor.uuid != HeartRateModule.NOTIFY_SWITCH) return
      synchronized(Strap) {
        if (g !== gatt) return
        // The monitor said no: it counts as one with no heart rate, so one that always refuses is given up after
        // NO_HEART_MOST and never dropped and connected again for the whole run (round one, L1).
        if (status != BluetoothGatt.GATT_SUCCESS) {
          noHeart += 1
          dropIt(g)
          return
        }
        asked = true
        heardAt = SystemClock.uptimeMillis()
        main.removeCallbacks(quietCheck)
        main.postDelayed(quietCheck, QUIET_MS)
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
      // A monitor sending its heart rate has its heart rate service: earlier misses no longer count (round one, L3).
      noHeart = 0
      heardAt = SystemClock.uptimeMillis()
      waiting.addLast(mapOf("device" to from, "at" to at.toDouble(), "bytes" to value.map { it.toInt() and 0xff }))
      while (waiting.size > MOST_WAITING) waiting.removeFirst()
    }
  }
}
