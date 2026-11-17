package expo.modules.phonetest

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import android.widget.ScrollView
import android.widget.TextView

/** The phone test's screen (ROADMAP Stage 5 item 51a): opened by the laptop's `phone-test` over the USB cable, it
 *  keeps the screen on, starts the test once and says where it is. Only a folder's copy has it. */
class PhoneTestActivity : Activity() {
  private val looper = Handler(Looper.getMainLooper())
  private lateinit var words: TextView

  private val show = object : Runnable {
    override fun run() {
      words.text = PhoneTest.status
      looper.postDelayed(this, 500)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    words = TextView(this).apply {
      setTextColor(Color.WHITE)
      textSize = 22f
      setPadding(56, 160, 56, 56)
    }
    setContentView(ScrollView(this).apply {
      setBackgroundColor(Color.BLACK)
      addView(words)
    })
    PhoneTest.startOnce(applicationContext)
  }

  override fun onResume() {
    super.onResume()
    looper.post(show)
  }

  override fun onPause() {
    looper.removeCallbacks(show)
    super.onPause()
  }
}
