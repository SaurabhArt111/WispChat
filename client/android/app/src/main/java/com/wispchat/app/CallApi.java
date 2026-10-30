package com.wispchat.app;

import android.content.Context;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * The few REST calls the native side makes on its own, so the notification
 * buttons work while the web app (and its socket) isn't running.
 * Uses the session the web app handed over via WispNative.setSession().
 */
public final class CallApi {
    private CallApi() {}

    /** Blocking — call from a background thread. */
    public static boolean post(Context ctx, String path, String jsonBody) {
        String token = WispPrefs.token(ctx);
        String base = WispPrefs.apiBase(ctx);
        if (token == null || base == null || base.isEmpty()) return false;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(base + path).openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            c.setRequestProperty("Authorization", "Bearer " + token);
            c.setRequestProperty("Content-Type", "application/json");
            c.setDoOutput(true);
            byte[] body = (jsonBody == null ? "{}" : jsonBody).getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = c.getOutputStream()) { os.write(body); }
            int code = c.getResponseCode();
            return code >= 200 && code < 300;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    public static void declineCall(final Context ctx, final String callId, final Runnable done) {
        new Thread(() -> {
            post(ctx, "/api/calls/" + callId + "/decline", "{}");
            if (done != null) done.run();
        }, "wisp-decline").start();
    }

    public static void markRead(final Context ctx, final String conversationId, final Runnable done) {
        new Thread(() -> {
            post(ctx, "/api/messages/" + conversationId + "/read", "{}");
            if (done != null) done.run();
        }, "wisp-read").start();
    }

    public static void registerPushToken(final Context ctx, final String fcmToken) {
        new Thread(() -> {
            String json = "{\"token\":\"" + fcmToken.replace("\\", "\\\\").replace("\"", "\\\"") + "\"}";
            post(ctx, "/api/users/push-token", json);
        }, "wisp-token").start();
    }
}
