package com.wispchat.app.notify

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.wispchat.app.data.Repo
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Registers this phone's Firebase (FCM) token with the WispChat server so new messages and calls are
 * delivered even when the app is closed — with no always-on "connected" notification.
 *
 * Firebase only exists when `android/app/google-services.json` was added at build time. Without it
 * [available] is false, nothing here does anything, and the app falls back to the quiet background
 * connection (see RealtimeService).
 */
object PushRegistrar {
    /** True when Firebase was configured at build time (google-services.json present). */
    fun available(ctx: Context): Boolean = try { FirebaseApp.getApps(ctx).isNotEmpty() } catch (_: Throwable) { false }

    /** True once a token is known to be registered with the server — the background service is then not needed. */
    fun active(ctx: Context, repo: Repo): Boolean = available(ctx) && !repo.store.pushToken.isNullOrEmpty()

    fun register(repo: Repo) {
        val ctx = repo.appContext
        if (!available(ctx)) return
        try {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token -> send(repo, token) }
        } catch (_: Throwable) {}
    }

    /** Called by the FCM service when Firebase rotates the token. */
    fun send(repo: Repo, token: String?) {
        if (token.isNullOrEmpty() || repo.store.token == null) return
        repo.scope.launch {
            try {
                repo.api.request("POST", "/users/push-token", JSONObject().put("token", token), 2)
                repo.store.pushToken = token
                // Push is working: the fallback background connection (and its notification) is no longer needed.
                com.wispchat.app.service.RealtimeService.stop(repo.appContext)
            } catch (_: Exception) { /* retried at the next launch / sign-in */ }
        }
    }

    /** On sign-out: stop pushes for this account on this phone. */
    suspend fun unregister(repo: Repo) {
        val token = repo.store.pushToken ?: return
        repo.store.pushToken = null
        try { repo.api.request("DELETE", "/users/push-token?token=" + java.net.URLEncoder.encode(token, "UTF-8"), null, 0) } catch (_: Exception) {}
        try { if (available(repo.appContext)) FirebaseMessaging.getInstance().deleteToken() } catch (_: Throwable) {}
    }
}
