package com.wispchat.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationManagerCompat;

/** Handles notification buttons that don't need to open the app: Decline and Mark as read. */
public class CallActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(final Context ctx, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        // goAsync keeps the process alive until the network request finishes.
        final PendingResult result = goAsync();

        if (NotificationHelper.ACTION_CALL_DECLINE.equals(action)) {
            String callId = intent.getStringExtra(NotificationHelper.EXTRA_CALL_ID);
            NotificationHelper.cancelCall(ctx, callId);
            CallApi.declineCall(ctx, callId, result::finish);
        } else if (NotificationHelper.ACTION_MARK_READ.equals(action)) {
            String conversationId = intent.getStringExtra(NotificationHelper.EXTRA_CONVERSATION_ID);
            NotificationManagerCompat.from(ctx).cancel(intent.getIntExtra("notificationId", 0));
            CallApi.markRead(ctx, conversationId, result::finish);
        } else {
            result.finish();
        }
    }
}
