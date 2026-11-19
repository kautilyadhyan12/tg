package expo.modules.phonetest

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Size
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.camera.view.PreviewView

/** The live camera test's screen (ROADMAP Stage 5 item 51b-ii): opened by the laptop's `phone-live` over the USB cable,
 *  it shows the camera and the skeleton the model sees, as the camera screen will, keeps the screen on, starts the test
 *  once and says where it is. Only a folder's copy has it. */
class PhoneTestLiveActivity : ComponentActivity() {
  private val looper = Handler(Looper.getMainLooper())
  internal lateinit var preview: PreviewView
  internal lateinit var skeleton: SkeletonView
  private lateinit var words: TextView

  private val show = object : Runnable {
    override fun run() {
      words.text = PhoneTestLive.status
      looper.postDelayed(this, 500)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    // The camera's picture is fitted whole, so the skeleton, fitted the same way, lies on the body.
    preview = PreviewView(this).apply { scaleType = PreviewView.ScaleType.FIT_CENTER }
    skeleton = SkeletonView(this)
    words = TextView(this).apply {
      setTextColor(Color.WHITE)
      setBackgroundColor(Color.argb(170, 0, 0, 0))
      textSize = 18f
      setPadding(40, 96, 40, 32)
    }
    setContentView(
      FrameLayout(this).apply {
        setBackgroundColor(Color.BLACK)
        addView(preview, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        addView(skeleton, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        addView(words, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
      },
    )
    PhoneTestLive.startOnce(this)
  }

  override fun onResume() {
    super.onResume()
    looper.post(show)
  }

  override fun onPause() {
    looper.removeCallbacks(show)
    super.onPause()
  }

  override fun onDestroy() {
    PhoneTestLive.screenGone = true
    super.onDestroy()
  }
}

/** The skeleton over the camera's picture, from the model's newest answer: the drawing the camera screen will do. */
class SkeletonView(context: Context) : View(context) {
  private val lines = Paint().apply {
    color = Color.rgb(255, 140, 40)
    strokeWidth = 8f
    isAntiAlias = true
  }
  private val joints = Paint().apply {
    color = Color.WHITE
    isAntiAlias = true
  }

  @Volatile private var points: FloatArray? = null
  @Volatile private var size: Size? = null

  /** The model's picture's shape, once it has answered. */
  fun pictureSize(): Size? = size

  /** Any thread: the newest answer's points (x, y as shares of the picture), or null for nobody. */
  fun show(points: FloatArray?, width: Int, height: Int) {
    this.points = points
    if (width > 0 && height > 0) size = Size(width, height)
    postInvalidate()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val p = points ?: return
    val picture = size ?: return
    val scale = minOf(width.toFloat() / picture.width, height.toFloat() / picture.height)
    val w = picture.width * scale
    val h = picture.height * scale
    val left = (width - w) / 2
    val top = (height - h) / 2
    fun x(k: Int) = left + p[2 * k] * w
    fun y(k: Int) = top + p[2 * k + 1] * h
    for (k in BONES.indices step 2) canvas.drawLine(x(BONES[k]), y(BONES[k]), x(BONES[k + 1]), y(BONES[k + 1]), lines)
    for (k in 0 until p.size / 2) canvas.drawCircle(x(k), y(k), 7f, joints)
  }

  private companion object {
    /** The pose model's 35 bones, as Google's own drawing joins its 33 points. */
    val BONES = intArrayOf(
      0, 1, 1, 2, 2, 3, 3, 7, 0, 4, 4, 5, 5, 6, 6, 8, 9, 10,
      11, 12, 11, 13, 13, 15, 15, 17, 15, 19, 15, 21, 17, 19,
      12, 14, 14, 16, 16, 18, 16, 20, 16, 22, 18, 20,
      11, 23, 12, 24, 23, 24,
      23, 25, 24, 26, 25, 27, 26, 28, 27, 29, 28, 30, 29, 31, 30, 32, 27, 31, 28, 32,
    )
  }
}
