package com.wispchat.app.notify

import android.content.Context
import com.wispchat.app.repo

/**
 * One place that turns a push (from Firebase or from the fallback background socket) into a
 * notification. Both paths can deliver the same event, so every message / call is shown only once.
 */
object PushHandler {
    private val seen = object : LinkedHashMap<String, Boolean>() {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Boolean>?) = size > 300
    }
    private fun firstTime(key: String) = synchronized(seen) { if (seen.containsKey(key)) false else { seen[key] = true; true } }

    suspend fun handle(ctx: Context, d: Map<String, String>) {
        val repo = ctx.applicationContext.repo
        if (repo.store.token == null || !repo.store.backgroundDelivery) return // signed out, or "Alerts when the app is closed" is off
        when (d["type"]) {
            "message" -> {
                if (!repo.settings.messageNotifications.value) return
                val conv = d["conversationId"].orEmpty(); val msgId = d["messageId"].orEmpty()
                if (conv.isEmpty() || !firstTime("m:$msgId")) return
                if (repo.appVisible && repo.store.activeConversation == conv) return // that chat is open on screen
                if (repo.conversation(conv)?.muted == true) return
                // The server can't read end-to-end encrypted text, so fetch and decrypt it here.
                val decrypted = repo.fetchForNotification(conv, msgId)
                val text = decrypted?.let { repo.previewText(it) }?.takeIf { it.isNotBlank() } ?: d["preview"].orEmpty().ifEmpty { "New message" }
                val group = if (d["isGroup"] == "true") d["groupName"].orEmpty().ifEmpty { "Group" } else null
                Notifier.showMessage(ctx.applicationContext, conv, msgId, d["senderName"].orEmpty().ifEmpty { "New message" }, text, group, d["ts"]?.toLongOrNull() ?: System.currentTimeMillis())
            }
            "call" -> {
                if (repo.appVisible) return // the app's own call UI handles it while open
                val callId = d["callId"].orEmpty()
                if (callId.isEmpty() || !firstTime("c:$callId")) return
                Notifier.showIncomingCall(ctx.applicationContext, callId, d["conversationId"].orEmpty(), d["kind"].orEmpty().ifEmpty { "audio" },
                    d["callerName"].orEmpty().ifEmpty { "Someone" }, d["callerId"].orEmpty())
            }
            "call-end" -> Notifier.cancelIncomingCall(ctx.applicationContext)
        }
    }
}
