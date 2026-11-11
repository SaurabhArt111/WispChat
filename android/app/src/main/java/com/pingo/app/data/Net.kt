package com.pingo.app.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.Interceptor
import okhttp3.Response

/** Is the phone online, and on what kind of network? Drives the offline banner, the outbox flush and media auto-download. */
class Net(ctx: Context) {
    enum class Kind { NONE, WIFI, MOBILE, ROAMING }

    private val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val _kind = MutableStateFlow(current())
    val kind: StateFlow<Kind> = _kind
    val online: Boolean get() = _kind.value != Kind.NONE
    /** Called when connectivity returns, so queued messages can be sent. */
    var onBackOnline: (() -> Unit)? = null

    init {
        try {
            cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) = update()
                override fun onLost(network: Network) = update()
                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = update()
            })
        } catch (_: Exception) {}
    }

    private fun update() {
        val was = _kind.value
        _kind.value = current()
        if (was == Kind.NONE && _kind.value != Kind.NONE) onBackOnline?.invoke()
    }

    private fun current(): Kind {
        val n = cm.activeNetwork ?: return Kind.NONE
        val c = cm.getNetworkCapabilities(n) ?: return Kind.NONE
        if (!c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return Kind.NONE
        return when {
            c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || c.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> Kind.WIFI
            !c.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING) -> Kind.ROAMING
            else -> Kind.MOBILE
        }
    }

    /** Counts bytes in/out for "Network usage". */
    class Counter(private val s: Settings) : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val req = chain.request()
            val sent = req.body?.contentLength()?.takeIf { it > 0 } ?: 0
            val res = chain.proceed(req)
            val recv = res.body?.contentLength()?.takeIf { it > 0 } ?: 0
            s.bytesSent += sent; s.bytesReceived += recv
            return res
        }
    }
}
