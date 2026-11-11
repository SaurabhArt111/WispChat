package com.pingo.app.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

enum class AutoDownload { NONE, PHOTOS, ALL }
enum class ThemeMode { SYSTEM, DARK, LIGHT }

/** Non-sensitive preferences (secrets live in [Store]). Exposed as flows so the UI reacts instantly. */
class Settings(context: Context) {
    private val p = context.getSharedPreferences("pingo_settings", Context.MODE_PRIVATE)

    private val _theme = MutableStateFlow(ThemeMode.valueOf(p.getString("theme", ThemeMode.SYSTEM.name)!!))
    val theme: StateFlow<ThemeMode> = _theme
    fun setTheme(v: ThemeMode) { p.edit().putString("theme", v.name).apply(); _theme.value = v }

    private val _fontScale = MutableStateFlow(p.getFloat("font", 1f))
    val fontScale: StateFlow<Float> = _fontScale
    fun setFontScale(v: Float) { p.edit().putFloat("font", v).apply(); _fontScale.value = v }

    private val _enterIsSend = MutableStateFlow(p.getBoolean("enterSend", false))
    val enterIsSend: StateFlow<Boolean> = _enterIsSend
    fun setEnterIsSend(v: Boolean) { p.edit().putBoolean("enterSend", v).apply(); _enterIsSend.value = v }

    /** WhatsApp's "Media visibility": copy newly downloaded media into the phone gallery automatically. */
    private val _saveToGallery = MutableStateFlow(p.getBoolean("autoGallery", false))
    val saveToGallery: StateFlow<Boolean> = _saveToGallery
    fun setSaveToGallery(v: Boolean) { p.edit().putBoolean("autoGallery", v).apply(); _saveToGallery.value = v }

    private val _mobile = MutableStateFlow(AutoDownload.valueOf(p.getString("adMobile", AutoDownload.PHOTOS.name)!!))
    val onMobile: StateFlow<AutoDownload> = _mobile
    fun setOnMobile(v: AutoDownload) { p.edit().putString("adMobile", v.name).apply(); _mobile.value = v }

    private val _wifi = MutableStateFlow(AutoDownload.valueOf(p.getString("adWifi", AutoDownload.ALL.name)!!))
    val onWifi: StateFlow<AutoDownload> = _wifi
    fun setOnWifi(v: AutoDownload) { p.edit().putString("adWifi", v.name).apply(); _wifi.value = v }

    private val _roaming = MutableStateFlow(AutoDownload.valueOf(p.getString("adRoam", AutoDownload.NONE.name)!!))
    val onRoaming: StateFlow<AutoDownload> = _roaming
    fun setOnRoaming(v: AutoDownload) { p.edit().putString("adRoam", v.name).apply(); _roaming.value = v }

    private val _msgNotif = MutableStateFlow(p.getBoolean("notifMsg", true))
    val messageNotifications: StateFlow<Boolean> = _msgNotif
    fun setMessageNotifications(v: Boolean) { p.edit().putBoolean("notifMsg", v).apply(); _msgNotif.value = v }

    // Network usage counters (bytes), shown in Storage and data.
    var bytesSent: Long
        get() = p.getLong("sent", 0)
        set(v) = p.edit().putLong("sent", v).apply()
    var bytesReceived: Long
        get() = p.getLong("recv", 0)
        set(v) = p.edit().putLong("recv", v).apply()
}
