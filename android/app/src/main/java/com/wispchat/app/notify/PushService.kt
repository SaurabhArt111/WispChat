package com.wispchat.app.notify

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.wispchat.app.repo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull

/** Receives Firebase pushes — also while the app is closed or swiped away — and shows the notification / call screen. */
class PushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) { PushRegistrar.send(applicationContext.repo, token) }

    override fun onMessageReceived(message: RemoteMessage) {
        // Android gives this callback ~20 s; decrypting needs one quick request, so cap it well below that.
        runBlocking(Dispatchers.IO) { withTimeoutOrNull(12_000) { PushHandler.handle(applicationContext, message.data) } }
    }
}
