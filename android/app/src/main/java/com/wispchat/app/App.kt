package com.wispchat.app

import android.app.Application
import com.wispchat.app.call.CallEngine
import com.wispchat.app.data.Api
import com.wispchat.app.data.LocalDb
import com.wispchat.app.data.MediaCache
import com.wispchat.app.data.Net
import com.wispchat.app.data.Settings
import com.wispchat.app.data.Repo
import com.wispchat.app.data.Store
import com.wispchat.app.notify.Notifier

class App : Application() {
    companion object {
        lateinit var instance: App
            private set
    }

    lateinit var repo: Repo
        private set

    lateinit var calls: CallEngine
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        Notifier.createChannels(this)
        val store = Store(this)
        val settings = Settings(this)
        val net = Net(this)
        val api = Api(store, Net.Counter(settings))
        val db = LocalDb(this)
        val media = MediaCache(this, db, api, settings)
        repo = Repo(this, store, api, db, media, net, settings)
        calls = CallEngine(this, repo)
    }
}

val android.content.Context.repo: Repo get() = (applicationContext as App).repo
val android.content.Context.calls: CallEngine get() = (applicationContext as App).calls
