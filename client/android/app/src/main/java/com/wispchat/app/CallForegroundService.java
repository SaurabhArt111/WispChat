package com.wispchat.app;

import android.Manifest;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Keeps the process (and the microphone / camera) alive while a call is in
 * progress and the app is in the background — Android stops capturing audio
 * for background apps unless a foreground service of the right type is running.
 */
public class CallForegroundService extends Service {
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_VIDEO = "video";
    private static final int NOTIFICATION_ID = 7_999_999;

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        boolean video = intent != null && intent.getBooleanExtra(EXTRA_VIDEO, false);

        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));

        Notification n = new NotificationCompat.Builder(this, NotificationHelper.CH_ONGOING)
                .setSmallIcon(R.drawable.ic_stat_wisp)
                .setContentTitle(title == null ? "WispChat call" : title)
                .setContentText("Call in progress — tap to return")
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setOngoing(true)
                .setColor(0xFF3DDBA7)
                .setContentIntent(pi)
                .build();

        int type = 0;
        if (Build.VERSION.SDK_INT >= 29) {
            // A type may only be declared if its runtime permission is held (Android 14+ throws otherwise).
            if (granted(Manifest.permission.RECORD_AUDIO)) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            if (video && granted(Manifest.permission.CAMERA)) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
        }
        try {
            if (type != 0) ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type);
            else startForeground(NOTIFICATION_ID, n);
        } catch (Exception e) {
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private boolean granted(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }
}
