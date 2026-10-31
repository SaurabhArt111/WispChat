package com.wispchat.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.graphics.Color;
import android.view.View;
import android.view.WindowManager;

import androidx.activity.EdgeToEdge;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(WispNativePlugin.class); // must be before super.onCreate
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
        if (getSupportActionBar() != null) {
            getSupportActionBar().hide();
        }
        applyNativeInsets();
        handleLaunch(getIntent());
        // Messages and calls while the app is closed (no Firebase needed).
        if (WispPrefs.backgroundEnabled(this) && WispPrefs.token(this) != null) WispSocketService.start(this);
    }

    /**
     * Android draws apps edge-to-edge, i.e. UNDER the status bar and navigation
     * bar. WebViews report that to the page inconsistently (env(safe-area-inset-*)
     * is 0 on many devices), which is what made headers sit under the clock and
     * the bottom tabs sit under the nav buttons. Handle it natively instead: pad
     * the content by the bars and — importantly — by the on-screen keyboard, so
     * the WebView simply gets smaller when the keyboard opens (the page re-lays
     * out; nothing is panned off-screen).
     */
    private void applyNativeInsets() {
        final View content = findViewById(android.R.id.content);
        final int bg = Color.parseColor("#0B0E12");
        getWindow().getDecorView().setBackgroundColor(bg);
        content.setBackgroundColor(bg);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), content);
        c.setAppearanceLightStatusBars(false);
        c.setAppearanceLightNavigationBars(false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);

        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(content);
    }

    /** Colour behind the status / navigation bars (the page tells us its theme colour). */
    public void setSystemBarBackground(final int color) {
        runOnUiThread(() -> {
            getWindow().getDecorView().setBackgroundColor(color);
            View content = findViewById(android.R.id.content);
            if (content != null) content.setBackgroundColor(color);
        });
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
