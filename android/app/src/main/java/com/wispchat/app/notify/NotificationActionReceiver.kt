package com.wispchat.app.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import com.wispchat.app.calls
import com.wispchat.app.repo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Handles the buttons on notifications: inline Reply, Mark read, and Decline (works with the app closed). */
class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val repo = context.repo
        val pending = goAsync()
        repo.scope.launch {
            try {
                when (intent.action) {
                    ACTION_REPLY -> {
                        val conv = intent.getStringExtra("conv") ?: return@launch
                        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Notifier.KEY_REPLY)?.toString().orEmpty()
                        if (text.isNotBlank()) {
                            if (repo.conversations.value.isEmpty()) repo.refreshConversations()
                            repo.conversation(conv)?.let { repo.sendText(it, text) }
                        }
                        Notifier.clearConversation(context, conv) // clears the "sending" spinner on the notification
                    }
                    ACTION_READ -> intent.getStringExtra("conv")?.let { repo.markRead(it) }
                    ACTION_HANGUP -> withContext(Dispatchers.Main) { context.calls.hangUp() }
                    ACTION_MUTE -> withContext(Dispatchers.Main) { context.calls.toggleMute() }
                    ACTION_SPEAKER -> withContext(Dispatchers.Main) { context.calls.toggleSpeaker() }
                    ACTION_DECLINE -> {
                        val callId = intent.getStringExtra("callId") ?: return@launch
                        Notifier.cancelIncomingCall(context)
                        val engine = context.calls
                        if (engine.state.value.callId == callId) withContext(Dispatchers.Main) { engine.decline() } // stops the ringing too
                        else try { repo.api.request("POST", "/calls/$callId/decline", org.json.JSONObject(), 1) } catch (_: Exception) {}
                    }
                }
            } finally { pending.finish() }
        }
    }

    companion object {
        const val ACTION_REPLY = "com.wispchat.app.REPLY"
        const val ACTION_READ = "com.wispchat.app.MARK_READ"
        const val ACTION_HANGUP = "com.wispchat.app.HANGUP_CALL"
        const val ACTION_DECLINE = "com.wispchat.app.DECLINE_CALL"
        const val ACTION_MUTE = "com.wispchat.app.MUTE_CALL"
        const val ACTION_SPEAKER = "com.wispchat.app.SPEAKER_CALL"
    }
}
