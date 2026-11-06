package expo.modules.runvoice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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

    /** "ok", "off" (no text-to-speech that starts) or "noEnglish", for the Running page's line. */
    AsyncFunction("check") { promise: Promise -> check(promise) }

    OnDestroy { quiet() }
  }

  @Synchronized
  private fun say(text: String) {
    val ctx = context ?: return
    if (engine == null) {
      engineNo += 1
      val mine = engineNo
      ready = false
      earlyStatus = null
      val made = TextToSpeech(ctx) { status -> started(mine, status) }
      engine = made
      earlyStatus?.let { started(mine, it) }
      // It failed inside its constructor: nothing is kept to be said later.
      if (engine == null) return
    }
    if (ready) speakNow(text) else waiting.add(text)
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
    tts.setAudioAttributes(speech)
    tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) = Unit
      override fun onDone(utteranceId: String?) = lineEnded(utteranceId)
      override fun onStop(utteranceId: String?, interrupted: Boolean) = lineEnded(utteranceId)

      @Deprecated("Deprecated in Java")
      override fun onError(utteranceId: String?) = lineEnded(utteranceId)
      override fun onError(utteranceId: String?, errorCode: Int) = lineEnded(utteranceId)
    })
    ready = true
    for (line in waiting) speakNow(line)
    waiting.clear()
  }

  private fun speakNow(text: String) {
    val tts = engine ?: return
    // Refused focus is a phone call or another app that may not be talked over: the line is let go.
    if (pending.isEmpty() && !takeFocus()) return
    lineNo += 1
    val id = "run-$lineNo"
    if (tts.speak(text, TextToSpeech.QUEUE_ADD, Bundle(), id) == TextToSpeech.SUCCESS) {
      pending.add(id)
      // An engine that dies mid-line calls nothing back: the music is given back all the same, well
      // after the line, and those before it, would have ended (a voice says about 15 letters a second).
      queueEnds = maxOf(SystemClock.uptimeMillis(), queueEnds) + text.length * MS_PER_LETTER * 2
      main.postAtTime({ lineEnded(id) }, queueEnds + LINE_GRACE_MS)
    } else if (pending.isEmpty()) {
      dropFocus()
    }
  }

  @Synchronized
  private fun lineEnded(id: String?) {
    if (id == null || !pending.remove(id)) return
    if (pending.isEmpty()) dropFocus()
  }

  @Synchronized
  private fun quiet() {
    engineNo += 1
    waiting.clear()
    engine?.stop()
    engine?.shutdown()
    engine = null
    ready = false
    pending.clear()
    main.removeCallbacksAndMessages(null)
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
  }
}
