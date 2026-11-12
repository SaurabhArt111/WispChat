package com.wispchat.app.service

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
import com.wispchat.app.R
import com.wispchat.app.net.Realtime
import com.wispchat.app.notify.Notifier
import com.wispchat.app.notify.PushRegistrar
import com.wispchat.app.repo
import com.wispchat.app.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * FALLBACK delivery for phones without Firebase push (no google-services.json in the build, or no Google
 * Play services). It holds a lightweight "background" socket so messages and calls still arrive while the
 * app is closed. When Firebase push is registered this service is never started, so there is no
 * persistent notification at all. Android requires a notification for any always-on service, so while
 * it runs it is the quietest possible one (silent, minimised, hidden on the lock screen).
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
        if (repo.store.token == null || !repo.store.backgroundDelivery || PushRegistrar.active(applicationContext, repo)) {
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
            .setSmallIcon(R.drawable.ic_stat_wisp).setContentTitle(getString(R.string.app_name))
            .setContentText("Waiting for new messages").setOngoing(true).setSilent(true).setShowWhen(false).setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET).setCategory(NotificationCompat.CATEGORY_SERVICE).setContentIntent(open)
            .setPriority(NotificationCompat.PRIORITY_MIN).setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE).build()
        try {
            if (Build.VERSION.SDK_INT >= 34) ServiceCompat.startForeground(this, Notifier.SERVICE_NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(Notifier.SERVICE_NOTIFICATION_ID, n)
        } catch (_: Exception) { /* background start refused by the OS: the socket still works while the process lives */ }
    }

    private suspend fun onPush(d: org.json.JSONObject) {
        val map = HashMap<String, String>()
        d.keys().forEach { k -> map[k] = d.optString(k) }
        com.wispchat.app.notify.PushHandler.handle(applicationContext, map)
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
            if (PushRegistrar.active(ctx, ctx.repo)) return // Firebase push handles background delivery: no service, no notification
            try { ContextCompat.startForegroundService(ctx, Intent(ctx, RealtimeService::class.java)) } catch (_: Exception) {}
        }
        fun stop(ctx: Context) { ctx.stopService(Intent(ctx, RealtimeService::class.java)) }
    }
}
