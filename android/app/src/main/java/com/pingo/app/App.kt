package com.pingo.app

import android.app.Application
import com.pingo.app.call.CallEngine
import com.pingo.app.data.Api
import com.pingo.app.data.LocalDb
import com.pingo.app.data.MediaCache
import com.pingo.app.data.Net
import com.pingo.app.data.Settings
import com.pingo.app.data.Repo
import com.pingo.app.data.Store
import com.pingo.app.notify.Notifier

class App : Application() {
    lateinit var repo: Repo
        private set

    lateinit var calls: CallEngine
        private set

    override fun onCreate() {
        super.onCreate()
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
