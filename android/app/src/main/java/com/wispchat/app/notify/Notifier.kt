package com.wispchat.app.notify

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import com.wispchat.app.R
import com.wispchat.app.call.IncomingCallActivity
import com.wispchat.app.ui.MainActivity

object Notifier {
    const val CH_MESSAGES = "wisp_messages"
    const val CH_CALLS = "wisp_calls_v1"
    const val CH_ONGOING = "wisp_ongoing"
    const val CH_SERVICE = "wisp_service"
    const val KEY_REPLY = "reply_text"
    const val CALL_NOTIFICATION_ID = 4001
    const val SERVICE_NOTIFICATION_ID = 4002
    const val ONGOING_CALL_ID = 4003
    private const val GROUP = "wisp_messages_group"

    // Lines already shown per chat so the notification keeps its recent history.
    private val history = HashMap<String, MutableList<NotificationCompat.MessagingStyle.Message>>()

    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "New messages"; enableVibration(true); lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        })
        val ring = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        nm.createNotificationChannel(NotificationChannel(CH_CALLS, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Rings for incoming voice and video calls"
            setSound(ring, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            enableVibration(true); vibrationPattern = longArrayOf(0, 700, 500, 700, 500, 700)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        })
        nm.createNotificationChannel(NotificationChannel(CH_ONGOING, "Ongoing call", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
        nm.createNotificationChannel(NotificationChannel(CH_SERVICE, "Background connection (only without push)", NotificationManager.IMPORTANCE_MIN).apply { setShowBadge(false); description = "Only used on phones without push notifications. You can turn this channel off in Android settings to hide it."; lockscreenVisibility = Notification.VISIBILITY_SECRET })
    }

    fun canNotify(ctx: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 || ActivityCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    private fun immutable() = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT

    @Suppress("MissingPermission")
    fun showMessage(ctx: Context, convId: String, messageId: String, sender: String, text: String, group: String?, ts: Long) {
        if (!canNotify(ctx)) return
        val me = Person.Builder().setName("Me").build()
        val style = NotificationCompat.MessagingStyle(me)
        if (!group.isNullOrEmpty()) { style.conversationTitle = group; style.isGroupConversation = true }
        val lines = history.getOrPut(convId) { mutableListOf() }
        lines += NotificationCompat.MessagingStyle.Message(text, ts, Person.Builder().setName(sender).setKey(sender).build())
        while (lines.size > 8) lines.removeAt(0)
        lines.forEach { style.addMessage(it) }

        val open = PendingIntent.getActivity(ctx, convId.hashCode(), Intent(ctx, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_CONVERSATION, convId).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), immutable())
        val replyInput = RemoteInput.Builder(KEY_REPLY).setLabel("Reply").build()
        val replyPi = PendingIntent.getBroadcast(ctx, convId.hashCode() + 1,
            Intent(ctx, NotificationActionReceiver::class.java).setAction(NotificationActionReceiver.ACTION_REPLY).putExtra("conv", convId),
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) // must be mutable: the system fills in the typed text
        val readPi = PendingIntent.getBroadcast(ctx, convId.hashCode() + 2,
            Intent(ctx, NotificationActionReceiver::class.java).setAction(NotificationActionReceiver.ACTION_READ).putExtra("conv", convId), immutable())

        val n = NotificationCompat.Builder(ctx, CH_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_wisp).setStyle(style).setContentIntent(open).setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE).setPriority(NotificationCompat.PRIORITY_HIGH)
            .setGroup(GROUP).setWhen(ts).setShowWhen(true).setColor(0xFF38BDF8.toInt())
            .addAction(NotificationCompat.Action.Builder(R.drawable.ic_stat_wisp, "Reply", replyPi).addRemoteInput(replyInput).setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY).setAllowGeneratedReplies(true).build())
            .addAction(NotificationCompat.Action.Builder(R.drawable.ic_stat_wisp, "Mark read", readPi).setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ).build())
            .build()
        val summary = NotificationCompat.Builder(ctx, CH_MESSAGES).setSmallIcon(R.drawable.ic_stat_wisp)
            .setGroup(GROUP).setGroupSummary(true).setAutoCancel(true).build()
        val nm = NotificationManagerCompat.from(ctx)
        nm.notify(convId.hashCode(), n)
        nm.notify(0, summary)
    }

    fun clearConversation(ctx: Context, convId: String) {
        history.remove(convId)
        NotificationManagerCompat.from(ctx).cancel(convId.hashCode())
    }

    /** Full-screen incoming-call alert: rings and takes over the lock screen; also shows as a heads-up with Answer / Decline. */
    @Suppress("MissingPermission")
    fun showIncomingCall(ctx: Context, callId: String, convId: String, kind: String, callerName: String, callerId: String) {
        if (!canNotify(ctx)) { // no notification permission: still try to open the call screen directly
            runCatching { ctx.startActivity(callIntent(ctx, callId, convId, kind, callerName, callerId, null)) }
            return
        }
        val person = Person.Builder().setName(callerName).setImportant(true).build()
        val full = PendingIntent.getActivity(ctx, 1, callIntent(ctx, callId, convId, kind, callerName, callerId, null), immutable())
        val answer = PendingIntent.getActivity(ctx, 2, callIntent(ctx, callId, convId, kind, callerName, callerId, "answer"), immutable())
        val decline = PendingIntent.getBroadcast(ctx, 3,
            Intent(ctx, NotificationActionReceiver::class.java).setAction(NotificationActionReceiver.ACTION_DECLINE).putExtra("callId", callId), immutable())
        val b = NotificationCompat.Builder(ctx, CH_CALLS)
            .setSmallIcon(R.drawable.ic_stat_wisp).setContentTitle(callerName)
            .setContentText(if (kind == "video") "Incoming video call" else "Incoming voice call")
            .setCategory(NotificationCompat.CATEGORY_CALL).setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true).setAutoCancel(false).setTimeoutAfter(45_000).setFullScreenIntent(full, true)
            .setContentIntent(full).setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, answer))
        val n = b.build().apply { flags = flags or Notification.FLAG_INSISTENT }
        NotificationManagerCompat.from(ctx).notify(CALL_NOTIFICATION_ID, n)
    }

    fun callIntent(ctx: Context, callId: String, convId: String, kind: String, name: String, callerId: String, action: String?): Intent =
        Intent(ctx, IncomingCallActivity::class.java)
            .putExtra("callId", callId).putExtra("convId", convId).putExtra("kind", kind)
            .putExtra("name", name).putExtra("callerId", callerId).putExtra("action", action)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

    fun cancelIncomingCall(ctx: Context) = NotificationManagerCompat.from(ctx).cancel(CALL_NOTIFICATION_ID)
}
