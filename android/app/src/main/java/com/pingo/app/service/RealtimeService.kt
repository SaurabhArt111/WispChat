package com.pingo.app.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.pingo.app.R
import com.pingo.app.net.Realtime
import com.pingo.app.notify.Notifier
import com.pingo.app.repo
import com.pingo.app.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Holds a lightweight "background" socket so new messages and incoming calls arrive while the app is
 * closed — no Google/Firebase account needed. The server pushes `push` events to this socket only.
 */
class RealtimeService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var rt: Realtime? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // startForegroundService() demands startForeground() within seconds or Android kills the app,
        // so this always happens first — before any decision to stop again.
        goForeground()
        val repo = applicationContext.repo
        if (repo.store.token == null || !repo.store.backgroundDelivery) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        if (rt == null) {
            rt = Realtime(repo.api.base, { repo.store.token }, background = true).also { r ->
                r.onAuthInvalid = { stopSelf() }
                scope.launch { r.events.collect { if (it.name == "push") onPush(it.data) } }
                r.connect()
            }
        }
        return START_STICKY
    }

    private fun goForeground() {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(this, Notifier.CH_SERVICE)
            .setSmallIcon(R.drawable.ic_stat_pingo).setContentTitle(getString(R.string.app_name))
            .setContentText("Connected").setOngoing(true).setSilent(true).setContentIntent(open)
            .setPriority(NotificationCompat.PRIORITY_MIN).setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE).build()
        try {
            if (Build.VERSION.SDK_INT >= 34) ServiceCompat.startForeground(this, Notifier.SERVICE_NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(Notifier.SERVICE_NOTIFICATION_ID, n)
        } catch (_: Exception) { /* background start refused by the OS: the socket still works while the process lives */ }
    }

    private suspend fun onPush(d: org.json.JSONObject) {
        val repo = applicationContext.repo
        when (d.optString("type")) {
            "message" -> {
                if (!repo.settings.messageNotifications.value) return
                val conv = d.optString("conversationId"); val msgId = d.optString("messageId")
                if (repo.appVisible && repo.store.activeConversation == conv) return // the chat is open on screen
                val decrypted = repo.fetchForNotification(conv, msgId)
                val text = decrypted?.let { repo.previewText(it) }?.takeIf { it.isNotBlank() } ?: d.optString("preview", "New message")
                val group = if (d.optBoolean("isGroup")) d.optString("groupName", "Group") else null
                Notifier.showMessage(applicationContext, conv, msgId, d.optString("senderName", "New message"), text, group, d.optLong("ts", System.currentTimeMillis()))
            }
            "call" -> {
                if (repo.appVisible) return // the app's own call UI handles it while open
                Notifier.showIncomingCall(applicationContext, d.optString("callId"), d.optString("conversationId"),
                    d.optString("kind", "audio"), d.optString("callerName", "Someone"), d.optString("callerId"))
            }
            "call-end" -> Notifier.cancelIncomingCall(applicationContext)
        }
    }

    override fun onDestroy() {
        rt?.disconnect(); rt = null
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        fun startIfWanted(ctx: Context) {
            val s = ctx.repo.store
            if (s.token == null || !s.backgroundDelivery) return
            try { ContextCompat.startForegroundService(ctx, Intent(ctx, RealtimeService::class.java)) } catch (_: Exception) {}
        }
        fun stop(ctx: Context) { ctx.stopService(Intent(ctx, RealtimeService::class.java)) }
    }
}
