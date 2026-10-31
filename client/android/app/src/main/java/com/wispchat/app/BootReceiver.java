package com.wispchat.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restarts the background connection after a reboot or an app update. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (WispPrefs.backgroundEnabled(ctx) && WispPrefs.token(ctx) != null) WispSocketService.start(ctx);
    }
}
