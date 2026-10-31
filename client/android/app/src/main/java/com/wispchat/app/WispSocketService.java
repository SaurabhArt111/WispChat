package com.wispchat.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.Random;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Keeps a small, presence-less connection to YOUR WispChat server so messages
 * and incoming calls notify even with the app closed — with no Firebase and no
 * Google Play services. (Same idea as the "background connection" mode of other
 * self-hosted chat apps.)
 *
 * Speaks just enough of the Socket.IO v4 protocol over a plain WebSocket:
 *   server → "0{sid,pingInterval,pingTimeout}"   we → "40{token,background:true}"
 *   server → "40{sid}" (connected)               server → "2" (ping)  we → "3"
 *   server → "42[\"push\",{...}]"                 → NotificationHelper
 *
 * It is a foreground service (Android requires that for a long-lived
 * connection), restarted after a reboot or app update by BootReceiver, and it
 * reconnects immediately when the network returns.
 */
public class WispSocketService extends Service {
    private static final int NOTIFICATION_ID = 7_000_001;

    /** Read by the plugin to show status in Settings. */
    public static volatile boolean connected = false;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Random random = new Random();
    private OkHttpClient http;
    private WebSocket socket;
    private ConnectivityManager cm;
    private ConnectivityManager.NetworkCallback networkCallback;
    private int attempt = 0;
    private boolean stopped = false;
    private long lastActivity = 0;
    private long idleLimitMs = 60_000;
    private boolean watchdogOn = false;

    public static void start(Context c) {
        Intent i = new Intent(c, WispSocketService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (Exception ignored) {
            // Android 12+ refuses to start a foreground service from the background; the
            // app will start it the next time it is opened, and BootReceiver on reboot.
        }
    }

    public static void stop(Context c) {
        c.stopService(new Intent(c, WispSocketService.class));
    }

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        http = new OkHttpClient.Builder()
                .readTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS) // long-lived
                .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
                .build();
        cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) {
                // wifi ↔ mobile data switch, or coming back from a tunnel: don't wait for the backoff
                handler.post(() -> { if (!connected && !stopped) { attempt = 0; connect(); } });
            }
        };
        try { cm.registerDefaultNetworkCallback(networkCallback); } catch (Exception ignored) { }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!WispPrefs.backgroundEnabled(this) || WispPrefs.token(this) == null || WispPrefs.apiBase(this) == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        goForeground("Connecting…");
        if (socket == null) connect();
        if (!watchdogOn) { watchdogOn = true; scheduleWatchdog(); }
        return START_STICKY; // the system brings us back if it kills the process
    }

    @Override
    public void onDestroy() {
        stopped = true;
        connected = false;
        handler.removeCallbacksAndMessages(null);
        try { if (socket != null) socket.close(1000, "bye"); } catch (Exception ignored) { }
        try { cm.unregisterNetworkCallback(networkCallback); } catch (Exception ignored) { }
        super.onDestroy();
    }

    // ------------------------------------------------------------ foreground

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        return new NotificationCompat.Builder(this, NotificationHelper.CH_BACKGROUND)
                .setSmallIcon(R.drawable.ic_stat_wisp)
                .setContentTitle("WispChat")
                .setContentText(text)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setOngoing(true)
                .setShowWhen(false)
                .setContentIntent(pi)
                .build();
    }

    private void goForeground(String text) {
        Notification n = buildNotification(text);
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(NOTIFICATION_ID, n);
        } catch (Exception e) {
            stopSelf();
        }
    }

    private void updateStatus(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification(text));
    }

    // ------------------------------------------------------------ connection

    private void connect() {
        if (stopped) return;
        String base = WispPrefs.apiBase(this);
        final String token = WispPrefs.token(this);
        if (base == null || token == null) { stopSelf(); return; }
        try { if (socket != null) socket.cancel(); } catch (Exception ignored) { }

        String wsUrl = base.replaceFirst("^http", "ws") + "/socket.io/?EIO=4&transport=websocket";
        Request req = new Request.Builder().url(wsUrl).build();
        socket = http.newWebSocket(req, new WebSocketListener() {
            @Override public void onMessage(WebSocket ws, String text) { handler.post(() -> handleFrame(ws, text, token)); }
            @Override public void onClosed(WebSocket ws, int code, String reason) { handler.post(() -> lost(ws)); }
            @Override public void onFailure(WebSocket ws, Throwable t, Response r) { handler.post(() -> lost(ws)); }
        });
    }

    private void lost(WebSocket ws) {
        if (ws != socket || stopped) return; // an old socket we already replaced
        connected = false;
        socket = null;
        updateStatus("Reconnecting…");
        long delay = Math.min(60_000L, 1000L << Math.min(attempt, 6)) + random.nextInt(800);
        attempt++;
        handler.postDelayed(this::connect, delay);
    }

    private void handleFrame(WebSocket ws, String text, String token) {
        if (ws != socket || text.isEmpty()) return;
        lastActivity = System.currentTimeMillis();
        char type = text.charAt(0);
        try {
            if (type == '0') { // Engine.IO open → authenticate as a background (presence-less) client
                JSONObject open = new JSONObject(text.substring(1));
                idleLimitMs = open.optLong("pingInterval", 25_000) + open.optLong("pingTimeout", 20_000) + 5_000;
                JSONObject auth = new JSONObject().put("token", token).put("background", true);
                ws.send("40" + auth);
            } else if (type == '2') { // ping
                ws.send("3");
            } else if (text.startsWith("40")) { // namespace connected
                connected = true;
                attempt = 0;
                updateStatus("Connected — ready for messages and calls");
            } else if (text.startsWith("44")) { // connect error
                String msg = text.length() > 2 ? text.substring(2) : "";
                if (msg.contains("Auth failed") || msg.contains("No token") || msg.contains("User not found")) {
                    // the saved login is no longer valid: stop until the app logs in again
                    WispPrefs.clearSession(this);
                    stopSelf();
                }
            } else if (text.startsWith("42")) { // event
                JSONArray arr = new JSONArray(text.substring(2));
                if ("push".equals(arr.optString(0))) handlePush(arr.optJSONObject(1));
            } else if (type == '1') { // close
                ws.close(1000, null);
            }
        } catch (Exception ignored) {
            // a malformed frame must never take the service down
        }
    }

    private void handlePush(JSONObject o) {
        if (o == null) return;
        Map<String, String> data = new HashMap<>();
        Iterator<String> keys = o.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            data.put(k, o.optString(k, ""));
        }
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock lock = pm != null ? pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "wispchat:push") : null;
        if (lock != null) lock.acquire(10_000);
        try {
            String type = data.get("type");
            if ("message".equals(type)) NotificationHelper.showMessage(this, data);
            else if ("call".equals(type)) NotificationHelper.showIncomingCall(this, data);
            else if ("call-end".equals(type)) NotificationHelper.cancelCall(this, data.get("callId"));
        } finally {
            if (lock != null && lock.isHeld()) lock.release();
        }
    }

    /** A half-dead connection (NAT timeout, tunnel) looks open but is silent: replace it. */
    private void scheduleWatchdog() {
        handler.postDelayed(new Runnable() {
            @Override public void run() {
                if (stopped) return;
                if (connected && lastActivity > 0 && System.currentTimeMillis() - lastActivity > idleLimitMs) {
                    WebSocket old = socket;
                    if (old != null) { try { old.cancel(); } catch (Exception ignored) { } }
                    lost(old);
                }
                handler.postDelayed(this, 15_000);
            }
        }, 15_000);
    }
}
