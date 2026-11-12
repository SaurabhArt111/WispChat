package com.wispchat.app.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Restores background delivery after a reboot or an app update. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = RealtimeService.startIfWanted(context)
}
