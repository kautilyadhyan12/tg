package expo.modules.runbattery

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The phone's battery limit on this app (ROADMAP Stage 5 item 37l). Measured on Kd's phone, 2026-11-24: an app set to
// "Restricted" (Settings > Apps > the app > Battery > "Allow background usage" off) has its run's foreground service
// taken off foreground by Android a few seconds after Start, and a run then stops recording when the screen turns off;
// set to unrestricted, the same build recorded every second for 8 minutes with the screen off. The app cannot lift the
// limit: it can tell the person, and open the page where they do. Neither needs a permission.
class RunBatteryModule : Module() {
  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("RunBattery")

    /** True when Android holds this app back in the background (the "Restricted" battery setting). */
    Function("restricted") {
      val ctx = context ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return@Function false
      (ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)?.isBackgroundRestricted ?: false
    }

    /** Opens this app's battery page ("App battery usage"), or its App info page where a phone has none by that name,
     *  only ever from an app that came with the phone: the first page's name is not a public one, and an app installed
     *  later could claim it. False when neither opened. */
    Function("open") {
      val ctx = context ?: return@Function false
      val app = Uri.parse("package:" + ctx.packageName)
      val pages = listOf(
        Intent("android.settings.VIEW_ADVANCED_POWER_USAGE_DETAIL", app),
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, app),
      )
      for (page in pages) {
        try {
          val phones = phoneOwn(ctx, page) ?: continue
          ctx.startActivity(page.setClassName(phones.packageName, phones.name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          return@Function true
        } catch (e: Exception) {
          // This page is not on this phone: the next one.
        }
      }
      false
    }
  }

  /** The page of an app that came with the phone that opens this, if any. */
  private fun phoneOwn(ctx: Context, page: Intent): ActivityInfo? {
    val pm = ctx.packageManager
    val found = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      pm.queryIntentActivities(page, PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong()))
    } else {
      @Suppress("DEPRECATION")
      pm.queryIntentActivities(page, PackageManager.MATCH_DEFAULT_ONLY)
    }
    return found.firstOrNull { (it.activityInfo.applicationInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0 }?.activityInfo
  }
}
