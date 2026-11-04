package com.pingo.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Everything sensitive lives here: the login token, the profile and — most importantly — the private
 * end-to-end key. It is encrypted at rest with a key held in the Android Keystore (hardware-backed
 * where the device supports it), is excluded from cloud backup, and never leaves the device.
 */
class Store(context: Context) {
    private val prefs: SharedPreferences = try {
        open(context)
    } catch (e: Exception) {
        // A corrupted keystore entry (restored phone, OS bug) must not brick the app: start clean.
        context.deleteSharedPreferences(FILE)
        open(context)
    }

    private fun open(context: Context): SharedPreferences {
        val master = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        return EncryptedSharedPreferences.create(
            context, FILE, master,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    var token: String?
        get() = prefs.getString("token", null)
        set(v) = prefs.edit().apply { if (v == null) remove("token") else putString("token", v) }.apply()

    /** JSON of the signed-in user (public profile + public key). */
    var userJson: String?
        get() = prefs.getString("user", null)
        set(v) = prefs.edit().apply { if (v == null) remove("user") else putString("user", v) }.apply()

    /** Private EC scalar (base64url) of the E2EE identity. */
    var privateD: String?
        get() = prefs.getString("privd", null)
        set(v) = prefs.edit().apply { if (v == null) remove("privd") else putString("privd", v) }.apply()

    /** Chat currently on screen — lets the notifier skip a notification for it. */
    var activeConversation: String
        get() = prefs.getString("active", "") ?: ""
        set(v) = prefs.edit().putString("active", v).apply()

    var backgroundDelivery: Boolean
        get() = prefs.getBoolean("bg", true)
        set(v) = prefs.edit().putBoolean("bg", v).apply()

    fun clearSession() = prefs.edit().remove("token").remove("user").remove("privd").putString("active", "").apply()

    companion object { private const val FILE = "pingo_secure" }
}
