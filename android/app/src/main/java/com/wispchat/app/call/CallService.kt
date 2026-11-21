package com.wispchat.app.call

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import com.wispchat.app.R
import com.wispchat.app.calls
import com.wispchat.app.notify.NotificationActionReceiver
import com.wispchat.app.notify.Notifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The call's foreground service — what makes a WispChat call behave like a phone call:
 *  - while **ringing** it owns the custom incoming-call notification (caller photo, Answer / Decline, full screen over the
 *    lock screen) and keeps the app alive so the ringtone keeps playing even if WispChat was closed;
 *  - during the **call** it shows the ongoing-call notification (photo, timer, Mute · Speaker · Hang up) and keeps the
 *    microphone / camera running when you leave the call screen.
 * It follows [CallEngine.state] on its own, so callers only start / stop it.
 */
class CallService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var watcher: Job? = null
    private var avatar: Bitmap? = null
    private var avatarKey = ""
    private var lastType = -1
    private var lastSig = ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val st = calls.state.value
        // startForegroundService() must be answered with startForeground() quickly — always, even if we stop right after.
        post(st, force = true)
        if (st.phase == Phase.IDLE || st.phase == Phase.ENDED) { stopNow(); return START_NOT_STICKY }
        if (watcher == null) watcher = scope.launch {
            calls.state.collect { s ->
                if (s.phase == Phase.IDLE || s.phase == Phase.ENDED) stopNow() else { loadAvatar(s); post(s, force = false) }
            }
        }
        loadAvatar(st)
        return START_NOT_STICKY
    }

    private fun loadAvatar(s: CallState) {
        val key = "${s.peerId}|${s.peerAvatar}"
        if (key == avatarKey) return
        avatarKey = key
        avatar = CallAvatar.initials(s.peerName, s.peerColor)
        scope.launch {
            val b = runCatching { CallAvatar.load(applicationContext, s.peerName, s.peerColor, s.peerAvatar) }.getOrNull() ?: return@launch
            if (avatarKey == key) { avatar = b; lastSig = ""; post(calls.state.value, force = false) }
        }
    }

    private fun post(s: CallState, force: Boolean) {
        val incoming = s.phase == Phase.INCOMING
        // Re-post only when something visible changed (state updates are frequent: audio routes, video tracks…).
        val sig = listOf(s.phase, s.callId, s.muted, s.route, s.ringing, s.unstable, s.connectedAt, avatar?.hashCode()).joinToString()
        if (!force && sig == lastSig) return
        lastSig = sig
        val n = if (incoming) incomingNotification(s) else ongoingNotification(s)
        var type = 0
        if (Build.VERSION.SDK_INT >= 29) {
            type = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
            // Only declare a type whose permission is actually granted, otherwise Android 14+ throws.
            if (!incoming && granted(Manifest.permission.RECORD_AUDIO)) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            if (!incoming && s.kind == "video" && granted(Manifest.permission.CAMERA)) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        }
        if (force || type != lastType) {
            try {
                if (Build.VERSION.SDK_INT >= 29) ServiceCompat.startForeground(this, Notifier.ONGOING_CALL_ID, n, type) else startForeground(Notifier.ONGOING_CALL_ID, n)
                lastType = type
            } catch (_: Exception) {
                try { startForeground(Notifier.ONGOING_CALL_ID, n); lastType = type } catch (_: Exception) {
                    // The OS refused a foreground service (rare OEM restriction): still show the ringing notification.
                    if (incoming) Notifier.showIncomingCall(this, s.callId, s.convId, s.kind, s.peerName, s.peerId)
                }
            }
        } else {
            @Suppress("MissingPermission")
            runCatching { NotificationManagerCompat.from(this).notify(Notifier.ONGOING_CALL_ID, n) }
        }
    }

    private fun person(s: CallState): Person = Person.Builder().setName(s.peerName.ifEmpty { "WispChat" }).setImportant(true)
        .apply { avatar?.let { setIcon(IconCompat.createWithBitmap(it)) } }.build()

    private fun piFlags() = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT

    /** Custom incoming call: caller photo, "WispChat voice/video call", Answer / Decline, full screen on the lock screen. */
    private fun incomingNotification(s: CallState): Notification {
        val video = s.kind == "video"
        val full = PendingIntent.getActivity(this, 11, Notifier.callIntent(this, s.callId, s.convId, s.kind, s.peerName, s.peerId, null), piFlags())
        val answer = PendingIntent.getActivity(this, 12, Notifier.callIntent(this, s.callId, s.convId, s.kind, s.peerName, s.peerId, "answer"), piFlags())
        val decline = PendingIntent.getBroadcast(this, 13, Intent(this, NotificationActionReceiver::class.java)
            .setAction(NotificationActionReceiver.ACTION_DECLINE).putExtra("callId", s.callId), piFlags())
        return NotificationCompat.Builder(this, Notifier.CH_CALLS)
            .setSmallIcon(if (video) R.drawable.ic_stat_videocall else R.drawable.ic_stat_call)
            .setContentTitle(s.peerName)
            .setContentText(if (video) "Incoming video call" else "Incoming voice call")
            .setSubText("WispChat · end-to-end encrypted")
            .setLargeIcon(avatar)
            .setCategory(NotificationCompat.CATEGORY_CALL).setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true).setAutoCancel(false).setOnlyAlertOnce(true)
            .setFullScreenIntent(full, true).setContentIntent(full)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setColor(0xFF0FA67A.toInt()).setColorized(true)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(person(s), decline, answer).setIsVideo(video))
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build().apply { flags = flags or Notification.FLAG_NO_CLEAR }
    }

    /** Ongoing call: photo, live timer, Mute · Speaker · Hang up. Tapping it returns to the call screen. */
    private fun ongoingNotification(s: CallState): Notification {
        val video = s.kind == "video"
        val connected = s.phase == Phase.CONNECTED
        val open = PendingIntent.getActivity(this, 21, Intent(this, CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK), piFlags())
        fun action(a: String, code: Int) = PendingIntent.getBroadcast(this, code, Intent(this, NotificationActionReceiver::class.java).setAction(a), piFlags())
        val text = when (s.phase) {
            Phase.OUTGOING -> if (s.ringing) "Ringing…" else "Calling…"
            Phase.CONNECTING -> "Connecting…"
            Phase.CONNECTED -> when { s.unstable -> "Reconnecting…"; video -> "Ongoing video call"; else -> "Ongoing voice call" }
            else -> ""
        }
        return NotificationCompat.Builder(this, Notifier.CH_ONGOING)
            .setSmallIcon(if (video) R.drawable.ic_stat_videocall else R.drawable.ic_stat_call)
            .setContentTitle(s.peerName).setContentText(text)
            .setSubText("End-to-end encrypted")
            .setLargeIcon(avatar)
            .setOngoing(true).setOnlyAlertOnce(true).setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_CALL).setContentIntent(open)
            .setUsesChronometer(connected).setShowWhen(connected).setWhen(if (connected && s.connectedAt > 0) s.connectedAt else System.currentTimeMillis())
            .setColor(0xFF0FA67A.toInt()).setColorized(true)
            .setStyle(NotificationCompat.CallStyle.forOngoingCall(person(s), action(NotificationActionReceiver.ACTION_HANGUP, 22)).setIsVideo(video))
            .addAction(if (s.muted) R.drawable.ic_call_mic_off else R.drawable.ic_call_mic, if (s.muted) "Unmute" else "Mute", action(NotificationActionReceiver.ACTION_MUTE, 23))
            .addAction(R.drawable.ic_call_speaker, if (s.route == AudioRoute.SPEAKER) "Speaker off" else "Speaker", action(NotificationActionReceiver.ACTION_SPEAKER, 24))
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun stopNow() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        scope.cancel()
        runCatching { NotificationManagerCompat.from(this).cancel(Notifier.ONGOING_CALL_ID) }
        super.onDestroy()
    }

    companion object {
        /** Starts (or refreshes) the service for the current call — ringing or live; it works out which itself. */
        fun start(ctx: Context) {
            try { ContextCompat.startForegroundService(ctx, Intent(ctx, CallService::class.java)) }
            catch (_: Exception) {
                // e.g. background-start refused: keep at least the ringing notification
                val s = ctx.calls.state.value
                if (s.phase == Phase.INCOMING) Notifier.showIncomingCall(ctx, s.callId, s.convId, s.kind, s.peerName, s.peerId)
            }
        }
        fun stop(ctx: Context) { ctx.stopService(Intent(ctx, CallService::class.java)) }
    }
}
