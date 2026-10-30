package com.wispchat.app;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Full-screen "incoming call" screen shown over the lock screen (like a phone
 * call). Built in code so it needs no layout resources. Accept opens the chat
 * app and joins the call; Decline tells the server without opening the app.
 */
public class IncomingCallActivity extends Activity {
    private static final int GREEN = 0xFF3DDBA7;
    private static final int RED = 0xFFEF4444;

    private String callId;
    private String conversationId;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final BroadcastReceiver cancelReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (callId != null && callId.equals(i.getStringExtra(NotificationHelper.EXTRA_CALL_ID))) finish();
        }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        showOverLockScreen();
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        callId = getIntent().getStringExtra(NotificationHelper.EXTRA_CALL_ID);
        conversationId = getIntent().getStringExtra(NotificationHelper.EXTRA_CONVERSATION_ID);
        String name = getIntent().getStringExtra(NotificationHelper.EXTRA_CALLER_NAME);
        boolean video = "video".equals(getIntent().getStringExtra(NotificationHelper.EXTRA_CALL_KIND));
        setContentView(buildUi(name == null ? "Someone" : name, video));

        IntentFilter f = new IntentFilter(NotificationHelper.ACTION_CALL_CANCELLED);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(cancelReceiver, f, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(cancelReceiver, f);

        handler.postDelayed(this::finish, 46_000); // the server gives up at 45 s
    }

    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private View buildUi(String name, boolean video) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(0xFF0B0E12);
        int pad = dp(32);
        root.setPadding(pad, dp(96), pad, dp(72));

        TextView label = text(video ? "WispChat video call" : "WispChat voice call", 15, 0xFF98A2B3, false);
        root.addView(label);

        TextView avatar = new TextView(this);
        avatar.setText(name.isEmpty() ? "?" : name.substring(0, 1).toUpperCase());
        avatar.setTextSize(48);
        avatar.setTypeface(Typeface.DEFAULT_BOLD);
        avatar.setTextColor(0xFF04211A);
        avatar.setGravity(Gravity.CENTER);
        GradientDrawable circle = new GradientDrawable();
        circle.setShape(GradientDrawable.OVAL);
        circle.setColor(GREEN);
        avatar.setBackground(circle);
        LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(dp(132), dp(132));
        ap.topMargin = dp(48);
        root.addView(avatar, ap);

        TextView who = text(name, 30, 0xFFF0F3F6, true);
        LinearLayout.LayoutParams wp = new LinearLayout.LayoutParams(-2, -2);
        wp.topMargin = dp(28);
        root.addView(who, wp);
        root.addView(text("Ringing…", 16, GREEN, false));

        View spacer = new View(this);
        root.addView(spacer, new LinearLayout.LayoutParams(0, 0, 1f));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        row.addView(button("Decline", "✕", RED, v -> decline()));
        View gap = new View(this);
        row.addView(gap, new LinearLayout.LayoutParams(dp(72), 1));
        row.addView(button(video ? "Accept" : "Answer", video ? "🎥" : "✆", GREEN, v -> accept()));
        root.addView(row);
        return root;
    }

    private LinearLayout button(String caption, String glyph, int color, View.OnClickListener l) {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        TextView b = new TextView(this);
        b.setText(glyph);
        b.setTextSize(28);
        b.setTextColor(Color.WHITE);
        b.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(color);
        b.setBackground(bg);
        b.setOnClickListener(l);
        b.setContentDescription(caption);
        col.addView(b, new LinearLayout.LayoutParams(dp(72), dp(72)));
        TextView t = text(caption, 14, 0xFF98A2B3, false);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(-2, -2);
        tp.topMargin = dp(10);
        col.addView(t, tp);
        return col;
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private void accept() {
        NotificationHelper.cancelCall(this, callId);
        startActivity(NotificationHelper.acceptIntent(this, callId, conversationId));
        finish();
    }

    private void decline() {
        NotificationHelper.cancelCall(this, callId);
        CallApi.declineCall(getApplicationContext(), callId, null);
        finish();
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        try { unregisterReceiver(cancelReceiver); } catch (Exception ignored) { }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() { /* a ringing call can't be dismissed by Back — use Decline */ }
}
