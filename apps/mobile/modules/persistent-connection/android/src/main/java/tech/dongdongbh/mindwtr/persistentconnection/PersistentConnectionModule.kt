package tech.dongdongbh.mindwtr.persistentconnection

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PersistentConnectionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PersistentConnection")

    // Starts (or, on a second call, re-notifies in place — same content id,
    // no flicker) the foreground service that keeps N-05 visible while the
    // JS WebSocket client is meant to be connected.
    Function("startForegroundConnection") { title: String, text: String, channelName: String ->
      val context = appContext.reactContext ?: return@Function
      val intent = PersistentConnectionForegroundService.buildStartIntent(context, title, text, channelName)
      startServiceCompat(context, intent)
    }

    // Updates the notification text in place (e.g. "conectado" ->
    // "reconectando…") without stopping/restarting the foreground service.
    Function("updateForegroundConnectionStatus") { title: String, text: String, channelName: String ->
      val context = appContext.reactContext ?: return@Function
      val intent = PersistentConnectionForegroundService.buildUpdateIntent(context, title, text, channelName)
      startServiceCompat(context, intent)
    }

    Function("stopForegroundConnection") {
      val context = appContext.reactContext ?: return@Function
      context.startService(PersistentConnectionForegroundService.buildStopIntent(context))
    }

    Function("isIgnoringBatteryOptimizations") {
      val context = appContext.reactContext ?: return@Function false
      val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return@Function false
      powerManager.isIgnoringBatteryOptimizations(context.packageName)
    }

    // Fires the OS's own exemption-request dialog once (spec Always: "ofrece
    // pedir el permiso una sola vez más" — the *offering* is UI-side; this
    // just launches the system flow whenever asked). Some OEM builds block
    // ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS outright, so this falls
    // back to the general exemption list rather than crashing.
    Function("requestIgnoreBatteryOptimizations") {
      val context = appContext.reactContext ?: return@Function
      try {
        val intent = Intent(
          Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
          Uri.parse("package:${context.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
      } catch (_: Throwable) {
        try {
          val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          context.startActivity(fallback)
        } catch (_: Throwable) {
          // No recovery path on this OEM build — the JS-side chip stays
          // visible (spec: "NUNCA bloquea el Modo TDAH"), it just can't open
          // system settings from here.
        }
      }
    }
  }

  private fun startServiceCompat(context: Context, intent: Intent) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(intent)
    } else {
      context.startService(intent)
    }
  }
}
