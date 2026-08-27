package tech.dongdongbh.mindwtr.persistentconnection

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * The Android foreground service that keeps process priority high enough for
 * the JS-side WebSocket client (apps/mobile/lib/persistent-connection.ts) to
 * stay connected while Modo TDAH is active (spec Always: "foreground service
 * Android ... mientras el Modo TDAH está activo"). This service does not open
 * the socket itself — JS drives connect/reconnect — it only owns the
 * mandatory N-05 notification lifecycle so the OS keeps the process alive.
 */
class PersistentConnectionForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        return START_NOT_STICKY
      }
      else -> {
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: return START_NOT_STICKY
        val text = intent.getStringExtra(EXTRA_TEXT) ?: return START_NOT_STICKY
        val channelName = intent.getStringExtra(EXTRA_CHANNEL_NAME) ?: return START_NOT_STICKY
        val notification = PersistentConnectionNotifier.buildNotification(this, title, text, channelName)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          startForeground(
            PersistentConnectionNotifier.NOTIFICATION_ID,
            notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
          )
        } else {
          startForeground(PersistentConnectionNotifier.NOTIFICATION_ID, notification)
        }
      }
    }
    // Deliberately not START_STICKY: if the OS kills this process outright,
    // JS re-arms the connection (and this service) on the next AppState
    // 'active' transition, same re-pin idiom as
    // keepPersistentCaptureNotificationArmed — a system-initiated restart of
    // a bare service with no JS driving the socket would be a foreground
    // service showing a notification for a connection that isn't real.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    super.onDestroy()
  }

  companion object {
    const val ACTION_START = "tech.dongdongbh.mindwtr.persistentconnection.action.START"
    const val ACTION_UPDATE = "tech.dongdongbh.mindwtr.persistentconnection.action.UPDATE"
    const val ACTION_STOP = "tech.dongdongbh.mindwtr.persistentconnection.action.STOP"
    const val EXTRA_TITLE = "tech.dongdongbh.mindwtr.persistentconnection.extra.TITLE"
    const val EXTRA_TEXT = "tech.dongdongbh.mindwtr.persistentconnection.extra.TEXT"
    const val EXTRA_CHANNEL_NAME = "tech.dongdongbh.mindwtr.persistentconnection.extra.CHANNEL_NAME"

    fun buildStartIntent(context: Context, title: String, text: String, channelName: String): Intent =
      Intent(context, PersistentConnectionForegroundService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_TITLE, title)
        putExtra(EXTRA_TEXT, text)
        putExtra(EXTRA_CHANNEL_NAME, channelName)
      }

    fun buildUpdateIntent(context: Context, title: String, text: String, channelName: String): Intent =
      buildStartIntent(context, title, text, channelName).apply { action = ACTION_UPDATE }

    fun buildStopIntent(context: Context): Intent =
      Intent(context, PersistentConnectionForegroundService::class.java).apply { action = ACTION_STOP }
  }
}
