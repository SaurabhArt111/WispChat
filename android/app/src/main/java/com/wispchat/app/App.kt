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

class App : Application(), coil.ImageLoaderFactory {
    /** One Coil loader for the whole app: animated GIFs / stickers and video thumbnails. */
    override fun newImageLoader(): coil.ImageLoader = coil.ImageLoader.Builder(this)
        .components {
            if (android.os.Build.VERSION.SDK_INT >= 28) add(coil.decode.ImageDecoderDecoder.Factory()) else add(coil.decode.GifDecoder.Factory())
            add(coil.decode.VideoFrameDecoder.Factory())
        }
        .crossfade(true)
        // bigger in-memory + on-disk image caches: avatars, GIF previews and thumbnails come back instantly
        .memoryCache { coil.memory.MemoryCache.Builder(this).maxSizePercent(0.25).build() }
        .diskCache { coil.disk.DiskCache.Builder().directory(cacheDir.resolve("image_cache")).maxSizeBytes(150L * 1024 * 1024).build() }
        .respectCacheHeaders(false)
        .build()

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
