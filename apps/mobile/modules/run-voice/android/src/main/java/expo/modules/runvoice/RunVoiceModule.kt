package expo.modules.runvoice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
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
  private var ready = false
  /** An engine can answer inside its own constructor, before it is kept: its answer waits here. */
  private var earlyStatus: Int? = null
  private val waiting = ArrayList<String>()
  private var queued = 0
  private var lineNo = 0
  private var focus: AudioFocusRequest? = null
  private val focusChanged = AudioManager.OnAudioFocusChangeListener { }

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

    /** Whether this phone can speak English at all, for the Running page's line. */
    AsyncFunction("check") { promise: Promise -> check(promise) }

    OnDestroy { quiet() }
  }

  @Synchronized
  private fun say(text: String) {
    val ctx = context ?: return
    if (engine == null) {
      ready = false
      earlyStatus = null
      val made = TextToSpeech(ctx) { status -> started(status) }
      engine = made
      earlyStatus?.let { started(it) }
    }
    if (ready) speakNow(text) else waiting.add(text)
  }

  @Synchronized
  private fun started(status: Int) {
    val tts = engine
    if (tts == null) {
      earlyStatus = status
      return
    }
    if (ready) return
    if (status != TextToSpeech.SUCCESS || !useEnglish(tts)) {
      // No voice on this phone: the lines are let go, and the next one tries again.
      waiting.clear()
      tts.shutdown()
      engine = null
      return
    }
    tts.setAudioAttributes(speech)
    tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) = Unit
      override fun onDone(utteranceId: String?) = lineEnded()
      override fun onStop(utteranceId: String?, interrupted: Boolean) = lineEnded()

      @Deprecated("Deprecated in Java")
      override fun onError(utteranceId: String?) = lineEnded()
      override fun onError(utteranceId: String?, errorCode: Int) = lineEnded()
    })
    ready = true
    for (line in waiting) speakNow(line)
    waiting.clear()
  }

  private fun speakNow(text: String) {
    val tts = engine ?: return
    if (queued == 0) takeFocus()
    lineNo += 1
    if (tts.speak(text, TextToSpeech.QUEUE_ADD, Bundle(), "run-$lineNo") == TextToSpeech.SUCCESS) {
      queued += 1
    } else if (queued == 0) {
      dropFocus()
    }
  }

  @Synchronized
  private fun lineEnded() {
    queued = maxOf(0, queued - 1)
    if (queued == 0) dropFocus()
  }

  @Synchronized
  private fun quiet() {
    waiting.clear()
    engine?.stop()
    engine?.shutdown()
    engine = null
    ready = false
    queued = 0
    dropFocus()
  }

  /** The phone's own English, or American English; a voice kept on the phone where there is one. */
  private fun useEnglish(tts: TextToSpeech): Boolean {
    val own = Locale.getDefault()
    val wanted = if (own.language == Locale.ENGLISH.language) own else Locale.US
    if (tts.setLanguage(wanted) < TextToSpeech.LANG_AVAILABLE && (wanted == Locale.US || tts.setLanguage(Locale.US) < TextToSpeech.LANG_AVAILABLE)) {
      return false
    }
    val current: Voice? = tts.voice
    if (current != null && current.isNetworkConnectionRequired) {
      val onPhone = tts.voices.orEmpty()
        .filter { it.locale.language == Locale.ENGLISH.language && !it.isNetworkConnectionRequired && !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) }
        .sortedWith(compareByDescending<Voice> { it.locale == current.locale }.thenByDescending { it.quality })
        .firstOrNull()
      if (onPhone != null) tts.voice = onPhone
    }
    return true
  }

  private fun check(promise: Promise) {
    val ctx = context
    if (ctx == null) {
      promise.resolve(false)
      return
    }
    synchronized(this) {
      if (ready && engine != null) {
        promise.resolve(true)
        return
      }
    }
    // A voice made only to ask, and let go at once.
    val asked = arrayOfNulls<TextToSpeech>(1)
    var answered = false
    val answer = { status: Int ->
      val tts = asked[0]
      if (!answered && tts != null) {
        answered = true
        val can = status == TextToSpeech.SUCCESS && useEnglish(tts)
        tts.shutdown()
        promise.resolve(can)
      }
    }
    var early: Int? = null
    asked[0] = TextToSpeech(ctx) { status -> if (asked[0] == null) early = status else answer(status) }
    early?.let { answer(it) }
  }

  private fun takeFocus() {
    val audio = context?.getSystemService(AudioManager::class.java) ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(speech)
        .setOnAudioFocusChangeListener(focusChanged)
        .build()
      audio.requestAudioFocus(request)
      focus = request
    } else {
      @Suppress("DEPRECATION")
      audio.requestAudioFocus(focusChanged, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
    }
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
}
