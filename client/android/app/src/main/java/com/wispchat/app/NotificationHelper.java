package com.wispchat.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;

import java.util.Map;

/** Builds every notification the app shows: chat messages and incoming calls. */
public final class NotificationHelper {
    public static final String CH_MESSAGES = "wisp_messages";
    public static final String CH_CALLS = "wisp_calls_v1";
    public static final String CH_ONGOING = "wisp_ongoing";
    public static final String CH_BACKGROUND = "wisp_background";

    public static final String ACTION_OPEN_CHAT = "com.wispchat.app.OPEN_CHAT";
    public static final String ACTION_CALL_ACCEPT = "com.wispchat.app.CALL_ACCEPT";
    public static final String ACTION_CALL_DECLINE = "com.wispchat.app.CALL_DECLINE";
    public static final String ACTION_MARK_READ = "com.wispchat.app.MARK_READ";
    public static final String ACTION_CALL_CANCELLED = "com.wispchat.app.CALL_CANCELLED";

    public static final String EXTRA_CALL_ID = "callId";
    public static final String EXTRA_CONVERSATION_ID = "conversationId";
    public static final String EXTRA_CALLER_NAME = "callerName";
    public static final String EXTRA_CALL_KIND = "callKind";

    private static final int CALL_ID_BASE = 7_000_000;
    private static final int MAX_LINES = 8;

    private NotificationHelper() {}

    // ------------------------------------------------------------ channels

    public static void createChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);

        NotificationChannel messages = new NotificationChannel(CH_MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH);
        messages.setDescription("New chat messages");
        messages.enableLights(true);
        messages.enableVibration(true);
        messages.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(messages);

        // Rings like a phone call: ringtone sound, repeating vibration, shows on the lock screen.
        NotificationChannel calls = new NotificationChannel(CH_CALLS, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
        calls.setDescription("Ringing for voice and video calls");
        Uri ring = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        calls.setSound(ring, new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
        calls.enableVibration(true);
        calls.setVibrationPattern(new long[] { 0, 800, 600, 800, 600, 800, 600 });
        calls.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(calls);

        NotificationChannel ongoing = new NotificationChannel(CH_ONGOING, "Ongoing call", NotificationManager.IMPORTANCE_LOW);
        ongoing.setDescription("Shown while a call is in progress so Android keeps it alive");
        ongoing.setShowBadge(false);
        nm.createNotificationChannel(ongoing);

        // The small permanent entry Android requires for an app that stays connected (no sound, no badge).
        NotificationChannel bg = new NotificationChannel(CH_BACKGROUND, "Background connection", NotificationManager.IMPORTANCE_MIN);
        bg.setDescription("Keeps WispChat connected so messages and calls arrive without Google services. You can hide this in system settings.");
        bg.setShowBadge(false);
        bg.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
        nm.createNotificationChannel(bg);
    }

    // The same message can reach us twice (background connection + Firebase): show it once.
    private static final java.util.LinkedHashMap<String, Boolean> SEEN = new java.util.LinkedHashMap<String, Boolean>() {
        @Override protected boolean removeEldestEntry(java.util.Map.Entry<String, Boolean> e) { return size() > 300; }
    };

    /** True the first time `key` is seen (per process). Empty keys are never de-duplicated. */
    public static synchronized boolean firstTime(String key) {
        if (key == null || key.isEmpty()) return true;
        return SEEN.put(key, Boolean.TRUE) == null;
    }

    // ------------------------------------------------------------ messages

    private static int messageNotificationId(String conversationId) {
        return conversationId == null ? 1 : conversationId.hashCode();
    }

    public static void showMessage(Context ctx, Map<String, String> d) {
        if (WispApplication.isForeground()) return; // the open app already shows it live
        if (!firstTime("m:" + d.get("messageId"))) return;
        String conversationId = d.get("conversationId");
        String sender = nonEmpty(d.get("senderName"), "New message");
        String preview = nonEmpty(d.get("preview"), "New message");
        boolean isGroup = "true".equals(d.get("isGroup"));
        String groupName = d.get("groupName");
        long ts = parseLong(d.get("ts"), System.currentTimeMillis());
        int id = messageNotificationId(conversationId);

        Person senderPerson = new Person.Builder().setName(sender).setKey(nonEmpty(d.get("senderId"), sender)).build();
        Person me = new Person.Builder().setName("You").build();

        // Continue the existing stack for this chat (survives process death: read it back from the system).
        NotificationCompat.MessagingStyle style = null;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        try {
            for (StatusBarNotification sbn : nm.getActiveNotifications()) {
                if (sbn.getId() == id) {
                    style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(sbn.getNotification());
                    break;
                }
            }
        } catch (Throwable ignored) { /* some OEMs throw — start a fresh stack */ }
        if (style == null) style = new NotificationCompat.MessagingStyle(me);
        if (isGroup) {
            style.setConversationTitle(nonEmpty(groupName, "Group"));
            style.setGroupConversation(true);
        }
        style.addMessage(new NotificationCompat.MessagingStyle.Message(preview, ts, senderPerson));
        while (style.getMessages().size() > MAX_LINES) style.getMessages().remove(0);

        Intent open = new Intent(ctx, MainActivity.class)
                .setAction(ACTION_OPEN_CHAT)
                .putExtra(EXTRA_CONVERSATION_ID, conversationId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentPi = PendingIntent.getActivity(ctx, id, open, immutable(PendingIntent.FLAG_UPDATE_CURRENT));

        Intent read = new Intent(ctx, CallActionReceiver.class)
                .setAction(ACTION_MARK_READ)
                .putExtra(EXTRA_CONVERSATION_ID, conversationId)
                .putExtra("notificationId", id);
        PendingIntent readPi = PendingIntent.getBroadcast(ctx, id, read, immutable(PendingIntent.FLAG_UPDATE_CURRENT));

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CH_MESSAGES)
                .setSmallIcon(R.drawable.ic_stat_wisp)
                .setStyle(style)
                .setContentTitle(isGroup ? nonEmpty(groupName, "Group") : sender)
                .setContentText(isGroup ? sender + ": " + preview : preview)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setColor(0xFF3DDBA7)
                .setWhen(ts)
                .setShowWhen(true)
                .setAutoCancel(true)
                .setOnlyAlertOnce(false)
                .setGroup("wisp_messages")
                .setContentIntent(contentPi)
                .addAction(new NotificationCompat.Action.Builder(0, "Mark as read", readPi).build());

        NotificationManagerCompat nmc = NotificationManagerCompat.from(ctx);
        if (!nmc.areNotificationsEnabled()) return;
        try {
            nmc.notify(id, b.build());
            // Summary lets Android bundle 4+ chats under one heading.
            Notification summary = new NotificationCompat.Builder(ctx, CH_MESSAGES)
                    .setSmallIcon(R.drawable.ic_stat_wisp)
                    .setContentTitle("WispChat")
                    .setGroup("wisp_messages")
                    .setGroupSummary(true)
                    .setAutoCancel(true)
                    .setColor(0xFF3DDBA7)
                    .build();
            nmc.notify(0, summary);
        } catch (SecurityException e) { /* POST_NOTIFICATIONS revoked between the check and notify */ }
    }

    public static void clearConversation(Context ctx, String conversationId) {
        if (conversationId == null) return;
        NotificationManagerCompat.from(ctx).cancel(messageNotificationId(conversationId));
    }

    // --------------------------------------------------------------- calls

    public static int callNotificationId(String callId) {
        return CALL_ID_BASE + (callId == null ? 0 : (callId.hashCode() & 0xFFFFF));
    }

    public static void showIncomingCall(Context ctx, Map<String, String> d) {
        if (WispApplication.isForeground()) return; // in-app ringing UI handles it
        if (!firstTime("c:" + d.get("callId"))) return;
        String callId = d.get("callId");
        String caller = nonEmpty(d.get("callerName"), "Someone");
        boolean video = "video".equals(d.get("kind"));
        String conversationId = d.get("conversationId");
        int id = callNotificationId(callId);

        Intent full = new Intent(ctx, IncomingCallActivity.class)
                .putExtra(EXTRA_CALL_ID, callId)
                .putExtra(EXTRA_CONVERSATION_ID, conversationId)
                .putExtra(EXTRA_CALLER_NAME, caller)
                .putExtra(EXTRA_CALL_KIND, video ? "video" : "audio")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent fullPi = PendingIntent.getActivity(ctx, id, full, immutable(PendingIntent.FLAG_UPDATE_CURRENT));

        PendingIntent acceptPi = PendingIntent.getActivity(ctx, id + 1, acceptIntent(ctx, callId, conversationId),
                immutable(PendingIntent.FLAG_UPDATE_CURRENT));

        Intent decline = new Intent(ctx, CallActionReceiver.class)
                .setAction(ACTION_CALL_DECLINE)
                .putExtra(EXTRA_CALL_ID, callId);
        PendingIntent declinePi = PendingIntent.getBroadcast(ctx, id + 2, decline, immutable(PendingIntent.FLAG_UPDATE_CURRENT));

        Person person = new Person.Builder().setName(caller).setImportant(true).build();

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CH_CALLS)
                .setSmallIcon(R.drawable.ic_stat_wisp)
                .setContentTitle(caller)
                .setContentText(video ? "Incoming video call" : "Incoming voice call")
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setColor(0xFF3DDBA7)
                .setTimeoutAfter(45_000) // same as the server's ring-out
                .setFullScreenIntent(fullPi, true)
                .setContentIntent(fullPi)
                .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, declinePi, acceptPi));

        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT; // keep ringing until answered, declined or timed out

        NotificationManagerCompat nmc = NotificationManagerCompat.from(ctx);
        if (!nmc.areNotificationsEnabled()) return;
        try {
            nmc.notify(id, n);
        } catch (SecurityException ignored) { /* permission revoked */ }
    }

    public static Intent acceptIntent(Context ctx, String callId, String conversationId) {
        return new Intent(ctx, MainActivity.class)
                .setAction(ACTION_CALL_ACCEPT)
                .putExtra(EXTRA_CALL_ID, callId)
                .putExtra(EXTRA_CONVERSATION_ID, conversationId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    /** Stop the ringing notification and close the full-screen call screen. */
    public static void cancelCall(Context ctx, String callId) {
        NotificationManagerCompat.from(ctx).cancel(callNotificationId(callId));
        ctx.sendBroadcast(new Intent(ACTION_CALL_CANCELLED).setPackage(ctx.getPackageName()).putExtra(EXTRA_CALL_ID, callId));
    }

    // ------------------------------------------------------------- helpers

    private static int immutable(int flags) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? flags | PendingIntent.FLAG_IMMUTABLE : flags;
    }

    static String nonEmpty(String s, String fallback) { return s == null || s.trim().isEmpty() ? fallback : s; }

    static long parseLong(String s, long fallback) {
        try { return Long.parseLong(s); } catch (Exception e) { return fallback; }
    }
}
