package expo.modules.runvoice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

// The run's voice (ROADMAP Stage 5 item 37a-ii): the phone's own text-to-speech, in English.
//
// Written here rather than taken from expo-speech (57.0.3, read 2026-11-06), which asks Android for
// no audio focus, so music plays on at full volume over it, and shuts its voice down when the screen's
// activity ends, so a run goes quiet once the app is swiped away. Here the music is lowered while a
// line is said (Android's transient focus that lets others duck) and comes back after; the voice
// lives on the app's own context until the run ends (`quiet`). A voice on the phone is taken over
// one that needs the internet, so a run with no signal is still spoken.
//
// A planned run's steps by the clock (37d-ii) are handed over ahead (`sayAt`), so "Now walk" is said on
// the second with the screen locked, or with no GPS point coming to wake the app (a treadmill). The
// phone is kept awake (a partial wake lock: the screen stays off) only until the last of them. Android
// closes its own speech service when memory is short and nothing is being said (measured 2026-11-11: a
// line after 5 quiet minutes came 6 s late while it started again), so the engine is made afresh 15 s
// before each of them, and each minute of a run. The fresh one is made beside the one in use and taken
// in once it is ready and nothing is being said, so a line never waits for it (37n, the bug hunt's C7).
class RunVoiceModule : Module() {
  private var engine: TextToSpeech? = null
  /** Which engine is the current one: an answer from one let go, or replaced, is not listened to. */
  private var engineNo = 0
  private var ready = false
  /** An engine can answer inside its own constructor, before it is kept: its answer waits here. */
  private var earlyStatus: Int? = null
  private val waiting = ArrayList<String>()
  /** Lines given to the engine and not yet ended. The focus is held while there are any. */
  private val pending = HashSet<String>()
  private var lineNo = 0
  private var focus: AudioFocusRequest? = null
  private val focusChanged = AudioManager.OnAudioFocusChangeListener { }
  private val main = Handler(Looper.getMainLooper())
  /** When the lines given so far should all have been said, on the uptime clock. */
  private var queueEnds = 0L
  /** The lines handed over ahead are posted with this, so a new list takes their place alone. */
  private val timed = Any()
  private var awake: PowerManager.WakeLock? = null
  /** A fresh engine made beside the one in use (`warm`), taken in once ready and nothing is being said. */
  private var spare: TextToSpeech? = null
  private var spareNo = 0
  private var spareReady = false
  private var spareEarly: Int? = null
  /** When the fresh engine was made, on the uptime clock: one not ready WARM_AHEAD_MS later is let go (round one, L4). */
  private var spareMadeAt = 0L
  /** The last line said of those handed over ahead, and when, on the uptime clock (`hush`). */
  private var timedLine: String? = null
  private var timedAt = 0L

  private val speech: AudioAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()

  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("RunVoice")

    /** Say one line after any still being said. */
    AsyncFunction("say") { text: String -> say(text) }

    /** Stop at once, and let the phone's voice go: the run has ended. */
    AsyncFunction("quiet") { quiet() }

    /** Say each line this many ms from now, in place of the lines handed over before; none, to say
     *  none of them (a pause). */
    AsyncFunction("sayAt") { texts: List<String>, inMs: List<Double> -> sayAt(texts, inMs) }

    /** The engine made ready now, so the next line is said at once (Run paused, a kilometre). */
    AsyncFunction("warm") { warm() }

    /** The run paused: a line handed over ahead that began a moment ago, and is the only one being said, stops,
     *  since the step it starts has not begun for the person (37n, C9). */
    AsyncFunction("hush") { hush() }

    /** "ok", "off" (no text-to-speech that starts) or "noEnglish", for the Running page's line. */
    AsyncFunction("check") { promise: Promise -> check(promise) }

    OnDestroy { quiet() }
  }

  @Synchronized
  private fun say(text: String, timedOne: Boolean = false) {
    val ctx = context ?: return
    if (engine == null) {
      makeEngine(ctx)
      // It failed inside its constructor: nothing is kept to be said later.
      if (engine == null) return
    }
    if (!ready) {
      waiting.add(text)
      return
    }
    val id = speakNow(text) ?: return
    if (timedOne) {
      timedLine = id
      timedAt = SystemClock.uptimeMillis()
    }
  }

  private fun makeEngine(ctx: Context) {
    engineNo += 1
    val mine = engineNo
    ready = false
    earlyStatus = null
    val made = TextToSpeech(ctx) { status -> started(mine, status) }
    engine = made
    earlyStatus?.let { started(mine, it) }
  }

  /** A fresh engine, its speech service started again if Android closed it: before a line handed
   *  over ahead, at Go and each minute of a run. Made beside the one in use, which says every line until
   *  the fresh one is ready and nothing is being said (`takeSpare`). */
  @Synchronized
  private fun warm() {
    val ctx = context ?: return
    if (engine == null) {
      makeEngine(ctx)
      return
    }
    // A fresh one that never answered is let go, so the next one is made (round one, L4).
    if (spare != null && !spareReady && SystemClock.uptimeMillis() - spareMadeAt > WARM_AHEAD_MS) dropSpare()
    // One starting already, or a fresh one waiting to be taken in.
    if (!ready || spare != null) return
    spareNo += 1
    spareMadeAt = SystemClock.uptimeMillis()
    val mine = spareNo
    spareReady = false
    spareEarly = null
    val made = TextToSpeech(ctx) { status -> spareStarted(mine, status) }
    spare = made
    spareEarly?.let { spareStarted(mine, it) }
  }

  @Synchronized
  private fun spareStarted(id: Int, status: Int) {
    if (id != spareNo) return
    val tts = spare
    if (tts == null) {
      spareEarly = status
      return
    }
    if (spareReady) return
    if (status != TextToSpeech.SUCCESS || useEnglish(tts) != "ok") {
      // Not started: the engine in use goes on, and the next warm tries again.
      spare = null
      tts.shutdown()
      return
    }
    listenTo(tts)
    spareReady = true
    takeSpare()
  }

  /** The fresh engine takes the place of the one in use, once nothing is being said or waits; `now` takes it
   *  at once (the one in use refused a line). */
  private fun takeSpare(now: Boolean = false): Boolean {
    val fresh = spare ?: return false
    if (!spareReady || (!now && (pending.isNotEmpty() || waiting.isNotEmpty()))) return false
    val old = engine
    engineNo += 1
    engine = fresh
    ready = true
    spare = null
    spareReady = false
    old?.shutdown()
    return true
  }

  private fun dropSpare() {
    spareNo += 1
    spare?.shutdown()
    spare = null
    spareReady = false
  }

  @Synchronized
  private fun hush() {
    val id = timedLine ?: return
    timedLine = null
    if (SystemClock.uptimeMillis() - timedAt > LATE_MS || pending.size != 1 || !pending.contains(id)) return
    engine?.stop()
    pending.clear()
    dropFocus()
    takeSpare()
  }

  @Synchronized
  private fun started(id: Int, status: Int) {
    if (id != engineNo) return
    val tts = engine
    if (tts == null) {
      earlyStatus = status
      return
    }
    if (ready) return
    if (status != TextToSpeech.SUCCESS || useEnglish(tts) != "ok") {
      // No voice on this phone: the lines are let go, and the next one tries again.
      waiting.clear()
      tts.shutdown()
      engine = null
      return
    }
    listenTo(tts)
    ready = true
    val lines = waiting.toList()
    waiting.clear()
    for (line in lines) speakNow(line)
  }

  private fun listenTo(tts: TextToSpeech) {
    tts.setAudioAttributes(speech)
    tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) = Unit
      override fun onDone(utteranceId: String?) = lineEnded(utteranceId)
      override fun onStop(utteranceId: String?, interrupted: Boolean) = lineEnded(utteranceId)

      @Deprecated("Deprecated in Java")
      override fun onError(utteranceId: String?) = lineEnded(utteranceId)
      override fun onError(utteranceId: String?, errorCode: Int) = lineEnded(utteranceId)
    })
  }

  /** The line's id once the engine has it; null when it was let go. */
  private fun speakNow(text: String): String? {
    val tts = engine ?: return null
    // Refused focus is a phone call or another app that may not be talked over: the line is let go.
    if (pending.isEmpty() && !takeFocus()) return null
    lineNo += 1
    val id = "run-$lineNo"
    var said = tts.speak(text, TextToSpeech.QUEUE_ADD, Bundle(), id) == TextToSpeech.SUCCESS
    // The engine in use refused it (its speech service gone): a fresh one ready says it.
    if (!said && takeSpare(now = true)) said = engine?.speak(text, TextToSpeech.QUEUE_ADD, Bundle(), id) == TextToSpeech.SUCCESS
    if (said) {
      pending.add(id)
      // An engine that dies mid-line calls nothing back: the music is given back all the same, well
      // after the line, and those before it, would have ended (a voice says about 15 letters a second).
      queueEnds = maxOf(SystemClock.uptimeMillis(), queueEnds) + text.length * MS_PER_LETTER * 2
      main.postAtTime({ lineEnded(id) }, queueEnds + LINE_GRACE_MS)
      return id
    }
    if (pending.isEmpty()) dropFocus()
    return null
  }

  @Synchronized
  private fun lineEnded(id: String?) {
    if (id == null || !pending.remove(id)) return
    if (pending.isEmpty()) {
      dropFocus()
      takeSpare()
    }
  }

  @Synchronized
  private fun sayAt(texts: List<String>, inMs: List<Double>) {
    main.removeCallbacksAndMessages(timed)
    letSleep()
    if (texts.isEmpty() || texts.size != inMs.size) return
    val now = SystemClock.uptimeMillis()
    var last = 0L
    for (i in texts.indices) {
      val wait = maxOf(0L, inMs[i].toLong())
      val text = texts[i]
      main.postAtTime({ say(text, timedOne = true) }, timed, now + wait)
      if (wait > WARM_AHEAD_MS) main.postAtTime({ warm() }, timed, now + wait - WARM_AHEAD_MS)
      last = maxOf(last, wait)
    }
    // Without it the uptime clock stops while the phone sleeps, and the line waits with it.
    val power = context?.getSystemService(PowerManager::class.java) ?: return
    awake = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "kwazo:run-steps").apply {
      setReferenceCounted(false)
      acquire(last + AWAKE_AFTER_MS)
    }
  }

  private fun letSleep() {
    awake?.let { if (it.isHeld) it.release() }
    awake = null
  }

  @Synchronized
  private fun quiet() {
    engineNo += 1
    waiting.clear()
    engine?.stop()
    engine?.shutdown()
    engine = null
    ready = false
    dropSpare()
    timedLine = null
    pending.clear()
    main.removeCallbacksAndMessages(null)
    letSleep()
    dropFocus()
  }

  /** A Western English voice whatever English the phone itself speaks (Kd, 2026-11-06: a phone in
   *  Indian English said the run in a thick Indian accent; "it should be western"): American English,
   *  then British, and the phone's own English only where neither is on it. Of that English, a voice
   *  kept on the phone over one that needs the internet. American and British count only when that
   *  country's English is there (LANG_AVAILABLE alone means some English, perhaps the Indian one);
   *  any English at all is the last try. */
  private fun useEnglish(tts: TextToSpeech): String {
    val own = Locale.getDefault()
    val country = TextToSpeech.LANG_COUNTRY_AVAILABLE
    val some = TextToSpeech.LANG_AVAILABLE
    val tries = listOf(Locale.US to country, Locale.UK to country) +
      (if (own.language == Locale.ENGLISH.language) listOf(own to some) else emptyList()) +
      listOf(Locale.US to some)
    val picked = tries.firstOrNull { (locale, least) -> tts.setLanguage(locale) >= least }?.first ?: return "noEnglish"
    val current: Voice? = tts.voice
    val sameEnglish = { v: Voice -> v.locale.language == picked.language && v.locale.country == picked.country }
    if (current == null || current.isNetworkConnectionRequired || !sameEnglish(current)) {
      val onPhone = tts.voices.orEmpty()
        .filter { sameEnglish(it) && !it.isNetworkConnectionRequired && !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) }
        .maxByOrNull { it.quality }
      if (onPhone != null) tts.voice = onPhone
    }
    return "ok"
  }

  private fun check(promise: Promise) {
    val ctx = context
    if (ctx == null) {
      promise.resolve("off")
      return
    }
    synchronized(this) {
      if (ready && engine != null) {
        promise.resolve("ok")
        return
      }
    }
    // A voice made only to ask, and let go at once.
    val asked = arrayOfNulls<TextToSpeech>(1)
    var answered = false
    val answer = { status: Int ->
      val tts = asked[0]
      if (!answered) {
        answered = true
        val said = if (status == TextToSpeech.SUCCESS && tts != null) useEnglish(tts) else "off"
        tts?.shutdown()
        promise.resolve(said)
      }
    }
    var early: Int? = null
    asked[0] = TextToSpeech(ctx) { status -> if (asked[0] == null) early = status else answer(status) }
    early?.let { answer(it) }
  }

  private fun takeFocus(): Boolean {
    val audio = context?.getSystemService(AudioManager::class.java) ?: return false
    val got = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(speech)
        .setOnAudioFocusChangeListener(focusChanged)
        .build()
      audio.requestAudioFocus(request).also { if (it == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) focus = request }
    } else {
      @Suppress("DEPRECATION")
      audio.requestAudioFocus(focusChanged, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
    }
    return got == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
  }

  private fun dropFocus() {
    val audio = context?.getSystemService(AudioManager::class.java) ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focus?.let { audio.abandonAudioFocusRequest(it) }
      focus = null
    } else {
      @Suppress("DEPRECATION")
      audio.abandonAudioFocus(focusChanged)
    }
  }

  private companion object {
    const val LINE_GRACE_MS = 5_000L
    const val MS_PER_LETTER = 70L
    /** Awake this long past the last line handed over: time for it to be said. */
    const val AWAKE_AFTER_MS = 30_000L
    /** The engine made again this long before a line handed over ahead: a cold start measured 7 s. */
    const val WARM_AHEAD_MS = 15_000L
    /** A line handed over ahead stops at a pause this soon after it began (`hush`). */
    const val LATE_MS = 1_500L
  }
}
