package com.wispchat.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import androidx.activity.EdgeToEdge;
import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(WispNativePlugin.class); // must be before super.onCreate
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
        handleLaunch(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleLaunch(intent);
    }

    private void handleLaunch(Intent intent) {
        if (intent != null && NotificationHelper.ACTION_CALL_ACCEPT.equals(intent.getAction())) {
            setShowOverLockScreen(true); // show the call even though the phone is locked
        }
        WispNativePlugin.onLaunchIntent(intent);
    }

    /** Lets the call UI appear over the lock screen; turned off again when the call ends. */
    public void setShowOverLockScreen(boolean on) {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= 27) {
                setShowWhenLocked(on);
                setTurnScreenOn(on);
            } else if (on) {
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
            } else {
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
            }
        });
    }
}
