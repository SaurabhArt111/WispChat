package com.wispchat.app;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Base64;
import android.graphics.Color;
import android.view.HapticFeedbackConstants;
import android.view.View;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Bridge between the web app and Android: push token, notification permission,
 * the WispChat storage folder, call foreground service and "what opened the app".
 * JS wrapper: client/src/native/wispNative.js
 */
@CapacitorPlugin(
        name = "WispNative",
        permissions = {
                @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
                @Permission(alias = "legacyStorage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
        }
)
public class WispNativePlugin extends Plugin {
    private static WispNativePlugin instance;
    private static JSObject pendingLaunchAction;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override
    public void load() { instance = this; }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        io.shutdown();
    }

    // ------------------------------------------------ called by native code

    /** MainActivity: the app was opened from a notification or the call screen. */
    public static void onLaunchIntent(Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        JSObject a = new JSObject();
        switch (intent.getAction()) {
            case NotificationHelper.ACTION_CALL_ACCEPT:
                a.put("type", "call-accept");
                a.put("callId", intent.getStringExtra(NotificationHelper.EXTRA_CALL_ID));
                a.put("conversationId", intent.getStringExtra(NotificationHelper.EXTRA_CONVERSATION_ID));
                break;
            case NotificationHelper.ACTION_OPEN_CHAT:
                a.put("type", "open-chat");
                a.put("conversationId", intent.getStringExtra(NotificationHelper.EXTRA_CONVERSATION_ID));
                break;
            default:
                return;
        }
        intent.setAction(null); // don't replay on rotation / recreate
        pendingLaunchAction = a;
        if (instance != null) instance.notifyListeners("launchAction", new JSObject());
    }

    public static void onPushToken(String token) {
        if (instance == null) return;
        JSObject o = new JSObject();
        o.put("token", token);
        instance.notifyListeners("pushToken", o);
    }

    // ---------------------------------------------------------- session

    /** The web app hands over its login so native buttons (Decline, Mark as read) can call the API. */
    @PluginMethod
    public void setSession(PluginCall call) {
        String token = call.getString("token");
        String apiBase = call.getString("apiBase");
        if (token == null || apiBase == null) { call.reject("token and apiBase required"); return; }
        WispPrefs.setSession(getContext(), token, apiBase);
        if (WispPrefs.backgroundEnabled(getContext())) WispSocketService.start(getContext());
        call.resolve();
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        WispPrefs.clearSession(getContext());
        WispSocketService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void setActiveConversation(PluginCall call) {
        String id = call.getString("id");
        WispPrefs.setActiveConversation(getContext(), id);
        if (id != null) NotificationHelper.clearConversation(getContext(), id);
        call.resolve();
    }

    @PluginMethod
    public void clearNotifications(PluginCall call) {
        String conversationId = call.getString("conversationId");
        if (conversationId != null) NotificationHelper.clearConversation(getContext(), conversationId);
        else NotificationManagerCompat.from(getContext()).cancelAll();
        call.resolve();
    }

    @PluginMethod
    public void getLaunchAction(PluginCall call) {
        JSObject ret = new JSObject();
        if (pendingLaunchAction != null) ret.put("action", pendingLaunchAction);
        pendingLaunchAction = null;
        call.resolve(ret);
    }

    // ------------------------------------------------- background connection

    /** On/off for the Firebase-free background connection (Settings). */
    @PluginMethod
    public void setBackgroundEnabled(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        WispPrefs.setBackgroundEnabled(getContext(), on);
        if (on && WispPrefs.token(getContext()) != null) WispSocketService.start(getContext());
        else WispSocketService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void getBackgroundStatus(PluginCall call) {
        Context c = getContext();
        JSObject ret = new JSObject();
        ret.put("enabled", WispPrefs.backgroundEnabled(c));
        ret.put("connected", WispSocketService.connected);
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        ret.put("ignoringBatteryOptimizations", pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        call.resolve(ret);
    }

    /** Asks Android to exempt WispChat from battery optimisation (needed for reliable delivery in Doze). */
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't open battery settings");
        }
    }

    // ----------------------------------------------------- native feel

    /** kind: tick | click | heavy | success | reject — a small vibration like a native control. */
    @PluginMethod
    public void haptic(PluginCall call) {
        final String kind = call.getString("kind", "tick");
        getBridge().executeOnMainThread(() -> {
            View v = getBridge().getWebView();
            int f;
            switch (kind) {
                case "heavy": f = HapticFeedbackConstants.LONG_PRESS; break;
                case "click": f = HapticFeedbackConstants.VIRTUAL_KEY; break;
                case "success": f = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY; break;
                case "reject": f = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS; break;
                default: f = Build.VERSION.SDK_INT >= 27 ? HapticFeedbackConstants.CLOCK_TICK : HapticFeedbackConstants.KEYBOARD_TAP;
            }
            v.performHapticFeedback(f);
        });
        call.resolve();
    }

    /** Colour behind the status/navigation bars, e.g. "#0b0e12". */
    @PluginMethod
    public void setSystemBarColor(PluginCall call) {
        try {
            int color = Color.parseColor(call.getString("color", "#0B0E12"));
            MainActivity a = (MainActivity) getActivity();
            if (a != null) a.setSystemBarBackground(color);
            call.resolve();
        } catch (Exception e) {
            call.reject("Bad colour");
        }
    }

    // ------------------------------------------------------------- push

    @PluginMethod
    public void getPushToken(final PluginCall call) {
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (task.isSuccessful() && task.getResult() != null) {
                    WispPrefs.setPushToken(getContext(), task.getResult());
                    JSObject ret = new JSObject();
                    ret.put("token", task.getResult());
                    call.resolve(ret);
                } else {
                    call.reject("Couldn't get a push token");
                }
            });
        } catch (IllegalStateException e) {
            // google-services.json missing from the build → Firebase never initialised
            call.reject("Firebase isn't configured in this build (add google-services.json)", "NOT_CONFIGURED");
        }
    }

    @PluginMethod
    public void getNotificationStatus(PluginCall call) {
        Context c = getContext();
        JSObject ret = new JSObject();
        ret.put("granted", NotificationManagerCompat.from(c).areNotificationsEnabled());
        boolean fsi = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            fsi = nm.canUseFullScreenIntent();
        }
        ret.put("fullScreenIntent", fsi);
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        ret.put("ignoringBatteryOptimizations", pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            resolveNotificationStatus(call);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionResult");
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        resolveNotificationStatus(call);
    }

    private void resolveNotificationStatus(PluginCall call) { getNotificationStatus(call); }

    /** kind: "notifications" | "fullscreen" | "battery" | "app" — opens the right system settings page. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        String kind = call.getString("kind", "app");
        Context c = getContext();
        Intent i;
        switch (kind) {
            case "notifications":
                i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, c.getPackageName());
                break;
            case "fullscreen":
                i = Build.VERSION.SDK_INT >= 34
                        ? new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + c.getPackageName()))
                        : new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, c.getPackageName());
                break;
            case "battery":
                i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                break;
            default:
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + c.getPackageName()));
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { c.startActivity(i); call.resolve(); } catch (Exception e) { call.reject("Couldn't open settings"); }
    }

    // ------------------------------------------------------------ calls

    @PluginMethod
    public void startCallService(PluginCall call) {
        Intent i = new Intent(getContext(), CallForegroundService.class)
                .putExtra(CallForegroundService.EXTRA_TITLE, call.getString("title", "WispChat call"))
                .putExtra(CallForegroundService.EXTRA_VIDEO, call.getBoolean("video", false));
        try {
            if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(i);
            else getContext().startService(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't start the call service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopCallService(PluginCall call) {
        getContext().stopService(new Intent(getContext(), CallForegroundService.class));
        MainActivity a = (MainActivity) getActivity();
        if (a != null) a.setShowOverLockScreen(false);
        call.resolve();
    }

    @PluginMethod
    public void dismissIncomingCall(PluginCall call) {
        NotificationHelper.cancelCall(getContext(), call.getString("callId"));
        call.resolve();
    }

    // ---------------------------------------------------------- storage

    @PluginMethod
    public void ensureStorage(PluginCall call) {
        // Android 9 and older need the classic permission for a top-level folder.
        if (Build.VERSION.SDK_INT <= 28 && getPermissionState("legacyStorage") != PermissionState.GRANTED) {
            requestPermissionForAlias("legacyStorage", call, "storagePermissionResult");
            return;
        }
        resolveStorageInfo(call);
    }

    @PermissionCallback
    private void storagePermissionResult(PluginCall call) { resolveStorageInfo(call); }

    @PluginMethod
    public void getStorageInfo(PluginCall call) { resolveStorageInfo(call); }

    private void resolveStorageInfo(final PluginCall call) {
        io.execute(() -> {
            try {
                JSONObject info = WispStorage.info(getContext());
                call.resolve(new JSObject(info.toString()));
            } catch (Exception e) {
                call.reject("Storage unavailable: " + e.getMessage());
            }
        });
    }

    /** One base64 chunk of a file; the last chunk finalises it into the right folder. */
    @PluginMethod
    public void saveFileChunk(final PluginCall call) {
        final String key = call.getString("key");
        final String data = call.getString("data", "");
        if (key == null) { call.reject("key required"); return; }
        io.execute(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                boolean first = Boolean.TRUE.equals(call.getBoolean("first", false));
                boolean last = Boolean.TRUE.equals(call.getBoolean("last", false));
                String existing = first ? WispStorage.lookup(getContext(), key) : null;
                if (existing != null) { // already saved earlier
                    JSObject r = new JSObject(); r.put("path", existing); r.put("skipped", true); call.resolve(r); return;
                }
                String path = WispStorage.saveChunk(getContext(), key, call.getString("kind", "file"),
                        Boolean.TRUE.equals(call.getBoolean("sent", false)), call.getString("name", ""),
                        call.getString("mime", ""), bytes, first, last);
                JSObject r = new JSObject();
                if (path != null) r.put("path", path);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Couldn't save file: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void saveFromUrl(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null) { call.reject("url required"); return; }
        io.execute(() -> {
            try {
                String path = WispStorage.saveFromUrl(getContext(), url, call.getString("key", url),
                        call.getString("kind", "file"), Boolean.TRUE.equals(call.getBoolean("sent", false)),
                        call.getString("name", ""), call.getString("mime", ""));
                JSObject r = new JSObject();
                r.put("path", path);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Download failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void hasSavedFile(PluginCall call) {
        JSObject r = new JSObject();
        String p = WispStorage.lookup(getContext(), call.getString("key"));
        r.put("saved", p != null);
        if (p != null) r.put("path", p);
        call.resolve(r);
    }

    @PluginMethod
    public void writeText(final PluginCall call) {
        io.execute(() -> {
            try {
                WispStorage.writeText(getContext(), call.getString("dir", "Databases"), call.getString("name", "file.json"), call.getString("content", ""));
                call.resolve();
            } catch (Exception e) {
                call.reject("Couldn't write: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void readText(final PluginCall call) {
        io.execute(() -> {
            try {
                JSObject r = new JSObject();
                r.put("content", WispStorage.readText(getContext(), call.getString("dir", "Databases"), call.getString("name", "")));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Couldn't read: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void listFiles(final PluginCall call) {
        io.execute(() -> {
            try {
                JSObject r = new JSObject();
                r.put("files", new JSArray(WispStorage.listFiles(getContext(), call.getString("dir", "Backups")).toString()));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Couldn't list: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void openFile(PluginCall call) { launchFile(call, false); }

    @PluginMethod
    public void shareFile(PluginCall call) { launchFile(call, true); }

    private void launchFile(PluginCall call, boolean share) {
        String path = call.getString("path");
        if (path == null) { call.reject("path required"); return; }
        File f = new File(path);
        if (!f.exists() || !WispStorage.isInsideRoot(getContext(), f)) { call.reject("File not found"); return; }
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            String mime = WispStorage.mimeOf(f);
            Intent i;
            if (share) {
                i = new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri);
                i = Intent.createChooser(i, "Share");
            } else {
                i = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime);
            }
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("No app can open this file");
        }
    }
}
