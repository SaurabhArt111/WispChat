package com.wispchat.app;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Receives Firebase data messages — also while the app is closed or swiped out
 * of Recents — and turns them into message notifications or a ringing call.
 */
public class WispMessagingService extends FirebaseMessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        String type = data.get("type");
        if (type == null) return;
        switch (type) {
            case "message":
                NotificationHelper.showMessage(this, data);
                break;
            case "call":
                NotificationHelper.showIncomingCall(this, data);
                break;
            case "call-end":
                // answered elsewhere, declined, cancelled by the caller, or timed out
                NotificationHelper.cancelCall(this, data.get("callId"));
                break;
            default:
                break;
        }
    }

    @Override
    public void onNewToken(@NonNull String token) {
        WispPrefs.setPushToken(this, token);
        // Re-register right away if somebody is logged in (works with the app closed).
        if (WispPrefs.token(this) != null) CallApi.registerPushToken(this, token);
        WispNativePlugin.onPushToken(token);
    }
}
