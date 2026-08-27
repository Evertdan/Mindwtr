package tech.dongdongbh.mindwtr.persistentconnection

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

/**
 * N-05 — the persistent connection notification (spec Boundaries: "sigue el
 * patrón exacto ya existente de persistent-capture-notification.ts +
 * PersistentCaptureNotifier.kt": own channel, IMPORTANCE_LOW, no
 * lights/vibration/sound, ongoing). Unlike the capture notification, this one
 * is posted from inside a real foreground Service via `startForeground()`
 * (PersistentConnectionForegroundService), so the platform itself refuses to
 * let the user swipe it away while the service is running — spec's "no
 * deslizable" requirement — with no dismiss-receiver workaround needed.
 */
object PersistentConnectionNotifier {
  const val CHANNEL_ID = "mindwtr-persistent-connection"
  const val NOTIFICATION_ID = 41140

  // T-01 route (apps/mobile/app/(drawer)/tdah-today.tsx resolves to
  // "/tdah-today"); resolved by Expo Router's default scheme handling, same
  // MainActivity-targeted ACTION_VIEW shape as PersistentCaptureNotifier's
  // CAPTURE_URI.
  private const val TDAH_TODAY_URI = "mindwtr:///tdah-today"
  private const val CONTENT_REQUEST_CODE = NOTIFICATION_ID

  fun buildNotification(context: Context, title: String, text: String, channelName: String): Notification {
    ensureChannel(context, channelName)

    val openIntent = Intent(Intent.ACTION_VIEW, Uri.parse(TDAH_TODAY_URI)).apply {
      setClassName(context.packageName, "${context.packageName}.MainActivity")
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    } else {
      PendingIntent.FLAG_UPDATE_CURRENT
    }
    val contentIntent = PendingIntent.getActivity(context, CONTENT_REQUEST_CODE, openIntent, pendingFlags)

    val smallIcon = context.resources.getIdentifier("ic_quick_settings_capture", "drawable", context.packageName)
      .takeIf { it != 0 }
      ?: context.applicationInfo.icon

    @Suppress("DEPRECATION")
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, CHANNEL_ID)
    } else {
      Notification.Builder(context).setPriority(Notification.PRIORITY_MIN)
    }
    builder
      .setSmallIcon(smallIcon)
      .setContentTitle(title)
      .setContentText(text)
      .setContentIntent(contentIntent)
      .setOngoing(true)
      .setShowWhen(false)
      .setOnlyAlertOnce(true)
      .setVisibility(Notification.VISIBILITY_PUBLIC)

    return builder.build()
  }

  private fun ensureChannel(context: Context, channelName: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val notificationManager =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    // Recreated unconditionally, same as PersistentCaptureNotifier: only the
    // safe fields (name/description) change on an existing channel, keeping
    // the label in sync with the app language while preserving the user's
    // own per-channel overrides.
    val channel = NotificationChannel(CHANNEL_ID, channelName, NotificationManager.IMPORTANCE_LOW)
    channel.description = channelName
    channel.enableLights(false)
    channel.enableVibration(false)
    channel.setSound(null, null)
    channel.setShowBadge(false)
    channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    notificationManager.createNotificationChannel(channel)
  }
}
