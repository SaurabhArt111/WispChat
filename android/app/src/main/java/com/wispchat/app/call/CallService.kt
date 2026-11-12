package com.wispchat.app.call

import android.Manifest
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.wispchat.app.R
import com.wispchat.app.notify.Notifier
import com.wispchat.app.notify.NotificationActionReceiver

/** Foreground service that keeps the microphone/camera (and the socket) alive while a call is minimised. */
class CallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val name = intent?.getStringExtra("name") ?: "Call"
        val video = intent?.getStringExtra("kind") == "video"
        val open = PendingIntent.getActivity(this, 0, Intent(this, CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        // WhatsApp-style ongoing call: the system draws the caller, a running timer and a red "Hang up" button.
        val hangUp = PendingIntent.getBroadcast(this, 7, Intent(this, NotificationActionReceiver::class.java).setAction(NotificationActionReceiver.ACTION_HANGUP), PendingIntent.FLAG_IMMUTABLE)
        val person = Person.Builder().setName(name).setImportant(true).build()
        val n = NotificationCompat.Builder(this, Notifier.CH_ONGOING)
            .setSmallIcon(R.drawable.ic_stat_wisp).setContentTitle(name).setContentText(if (video) "Video call in progress" else "Voice call in progress")
            .setOngoing(true).setCategory(NotificationCompat.CATEGORY_CALL).setContentIntent(open).setUsesChronometer(true).setWhen(System.currentTimeMillis())
            .setStyle(NotificationCompat.CallStyle.forOngoingCall(person, hangUp)).setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE).build()
        var type = 0
        if (Build.VERSION.SDK_INT >= 29) {
            // Only declare a type whose permission is actually granted, otherwise Android 14+ throws.
            if (granted(Manifest.permission.RECORD_AUDIO)) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            if (video && granted(Manifest.permission.CAMERA)) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        }
        try {
            if (type != 0) ServiceCompat.startForeground(this, Notifier.ONGOING_CALL_ID, n, type) else startForeground(Notifier.ONGOING_CALL_ID, n)
        } catch (_: Exception) {
            try { startForeground(Notifier.ONGOING_CALL_ID, n) } catch (_: Exception) {}
        }
        return START_NOT_STICKY
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    companion object {
        fun start(ctx: Context, name: String, kind: String) {
            try { ContextCompat.startForegroundService(ctx, Intent(ctx, CallService::class.java).putExtra("name", name).putExtra("kind", kind)) } catch (_: Exception) {}
        }
        fun stop(ctx: Context) { ctx.stopService(Intent(ctx, CallService::class.java)) }
    }
}
