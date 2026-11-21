package com.wispchat.app.call

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.ToneGenerator
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings

/** Where call audio goes. */
enum class AudioRoute { EARPIECE, SPEAKER, BLUETOOTH, WIRED }

/**
 * Makes a WispChat call sound and behave like a phone call:
 * audio focus (music pauses), communication mode, earpiece ⇄ speaker ⇄ Bluetooth ⇄ wired headset routing
 * that follows headsets being plugged in, and the proximity sensor turning the screen off at your ear.
 */
class CallAudio(private val ctx: Context, private val onRoutes: (current: AudioRoute, available: Set<AudioRoute>) -> Unit) {
    private val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val main = Handler(Looper.getMainLooper())
    private var focus: AudioFocusRequest? = null
    private var active = false
    private var video = false
    private var userPicked: AudioRoute? = null
    var route: AudioRoute = AudioRoute.EARPIECE
        private set
    private var proximity: PowerManager.WakeLock? = null

    private val deviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>?) { if (active) { userPicked = null; applyBest() } }
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>?) { if (active) { if (userPicked != null && userPicked !in available()) userPicked = null; applyBest() } }
    }

    fun start(isVideo: Boolean) {
        if (active) { video = isVideo; applyBest(); return }
        active = true; video = isVideo; userPicked = null
        val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
        focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attrs).setAcceptsDelayedFocusGain(false)
            .setOnAudioFocusChangeListener { }.build().also { runCatching { am.requestAudioFocus(it) } }
        runCatching { am.mode = AudioManager.MODE_IN_COMMUNICATION }
        runCatching { am.registerAudioDeviceCallback(deviceCallback, main) }
        applyBest()
    }

    fun stop() {
        if (!active) return
        active = false
        runCatching { am.unregisterAudioDeviceCallback(deviceCallback) }
        releaseProximity()
        if (Build.VERSION.SDK_INT >= 31) runCatching { am.clearCommunicationDevice() }
        else {
            @Suppress("DEPRECATION") runCatching { if (am.isBluetoothScoOn) { am.isBluetoothScoOn = false; am.stopBluetoothSco() } }
            @Suppress("DEPRECATION") runCatching { am.isSpeakerphoneOn = false }
        }
        runCatching { am.mode = AudioManager.MODE_NORMAL }
        focus?.let { runCatching { am.abandonAudioFocusRequest(it) } }; focus = null
    }

    /** Speaker button: earpiece/headset ⇄ speaker. */
    fun toggleSpeaker() = select(if (route == AudioRoute.SPEAKER) bestPrivate() else AudioRoute.SPEAKER)

    fun select(r: AudioRoute) { if (r !in available()) return; userPicked = r; apply(r) }

    fun available(): Set<AudioRoute> {
        val out = linkedSetOf(AudioRoute.SPEAKER)
        val devices = if (Build.VERSION.SDK_INT >= 31) am.availableCommunicationDevices.map { it.type } else am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).map { it.type }
        var hasWired = false
        for (t in devices) when (t) {
            AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> out += AudioRoute.EARPIECE
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> out += AudioRoute.BLUETOOTH
            AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_USB_HEADSET -> { out += AudioRoute.WIRED; hasWired = true }
        }
        if (devices.contains(26 /* TYPE_BLE_HEADSET (API 31) */)) out += AudioRoute.BLUETOOTH
        if (hasWired) out -= AudioRoute.EARPIECE // a plugged-in headset replaces the earpiece
        else if (Build.VERSION.SDK_INT < 31) out += AudioRoute.EARPIECE
        return out
    }

    private fun bestPrivate(): AudioRoute {
        val a = available()
        return when { AudioRoute.BLUETOOTH in a -> AudioRoute.BLUETOOTH; AudioRoute.WIRED in a -> AudioRoute.WIRED; AudioRoute.EARPIECE in a -> AudioRoute.EARPIECE; else -> AudioRoute.SPEAKER }
    }

    /** Headset if there is one; otherwise speaker for video, earpiece for voice — unless the person chose something. */
    private fun applyBest() {
        val a = available()
        val pick = userPicked?.takeIf { it in a } ?: run {
            val p = bestPrivate()
            if (video && (p == AudioRoute.EARPIECE)) AudioRoute.SPEAKER else p
        }
        apply(pick)
    }

    private fun apply(r: AudioRoute) {
        if (Build.VERSION.SDK_INT >= 31) {
            val want = when (r) {
                AudioRoute.SPEAKER -> listOf(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
                AudioRoute.EARPIECE -> listOf(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)
                AudioRoute.BLUETOOTH -> listOf(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, 26 /* TYPE_BLE_HEADSET */)
                AudioRoute.WIRED -> listOf(AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_USB_HEADSET)
            }
            val dev = am.availableCommunicationDevices.firstOrNull { it.type in want }
            if (dev != null) runCatching { am.setCommunicationDevice(dev) } else if (r == AudioRoute.EARPIECE) runCatching { am.clearCommunicationDevice() }
        } else {
            @Suppress("DEPRECATION")
            runCatching {
                when (r) {
                    AudioRoute.BLUETOOTH -> { am.isSpeakerphoneOn = false; am.startBluetoothSco(); am.isBluetoothScoOn = true }
                    AudioRoute.SPEAKER -> { if (am.isBluetoothScoOn) { am.isBluetoothScoOn = false; am.stopBluetoothSco() }; am.isSpeakerphoneOn = true }
                    else -> { if (am.isBluetoothScoOn) { am.isBluetoothScoOn = false; am.stopBluetoothSco() }; am.isSpeakerphoneOn = false }
                }
            }
        }
        route = r
        updateProximity()
        onRoutes(r, available())
    }

    // -------------------------------------------------------------- proximity (screen off at the ear)
    private fun updateProximity() {
        if (active && !video && route == AudioRoute.EARPIECE) acquireProximity() else releaseProximity()
    }

    private fun acquireProximity() {
        if (proximity?.isHeld == true) return
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return
        proximity = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "wisp:call-proximity").also { runCatching { it.acquire(3 * 60 * 60 * 1000L) } }
    }

    private fun releaseProximity() {
        proximity?.let { if (it.isHeld) runCatching { it.release(PowerManager.RELEASE_FLAG_WAIT_FOR_NO_PROXIMITY) } }
        proximity = null
    }
}

/**
 * Ringing and call tones: the phone's own ringtone + vibration for incoming calls (respecting silent / vibrate mode),
 * the ring-back tone while the other phone rings, and short busy / ended tones.
 */
class Ringer(private val ctx: Context) {
    private val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val main = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var ringtone: android.media.Ringtone? = null
    private var tone: ToneGenerator? = null
    private var vibrating = false

    private val vibrator: Vibrator? get() =
        if (Build.VERSION.SDK_INT >= 31) (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        else @Suppress("DEPRECATION") (ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)

    fun ringIncoming() {
        stop()
        when (am.ringerMode) {
            AudioManager.RINGER_MODE_SILENT -> return
            AudioManager.RINGER_MODE_VIBRATE -> vibrate()
            else -> { vibrate(); playRingtone() }
        }
    }

    private fun playRingtone() {
        val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        try {
            player = MediaPlayer().apply {
                setAudioAttributes(attrs)
                setDataSource(ctx, Settings.System.DEFAULT_RINGTONE_URI)
                isLooping = true
                setOnPreparedListener { runCatching { it.start() } }
                setOnErrorListener { _, _, _ -> fallbackRingtone(); true }
                prepareAsync()
            }
        } catch (_: Exception) { player?.release(); player = null; fallbackRingtone() }
    }

    private fun fallbackRingtone() {
        runCatching { player?.release() }; player = null
        runCatching {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            ringtone = RingtoneManager.getRingtone(ctx, uri)?.apply {
                audioAttributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build()
                if (Build.VERSION.SDK_INT >= 28) isLooping = true
                play()
            }
        }
    }

    private fun vibrate() {
        val v = vibrator ?: return
        if (!v.hasVibrator()) return
        vibrating = true
        runCatching {
            val effect = VibrationEffect.createWaveform(longArrayOf(0, 700, 900, 700, 1400), 1)
            @Suppress("DEPRECATION")
            v.vibrate(effect, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build())
        }
    }

    /** "Ringing…" tone heard by the caller. */
    fun ringBack() {
        stopTone()
        runCatching { tone = ToneGenerator(AudioManager.STREAM_VOICE_CALL, 55).also { it.startTone(ToneGenerator.TONE_SUP_RINGTONE) } }
    }

    fun busy() = shortTone(ToneGenerator.TONE_SUP_BUSY, 2200)
    fun ended() = shortTone(ToneGenerator.TONE_PROP_PROMPT, 400)
    fun connected() {
        runCatching { vibrator?.vibrate(VibrationEffect.createOneShot(40, VibrationEffect.DEFAULT_AMPLITUDE)) }
    }

    private fun shortTone(type: Int, ms: Int) {
        stopTone()
        runCatching {
            val g = ToneGenerator(AudioManager.STREAM_VOICE_CALL, 50)
            tone = g
            g.startTone(type, ms)
            main.postDelayed({ runCatching { g.release() }; if (tone === g) tone = null }, ms + 200L)
        }
    }

    private fun stopTone() { tone?.let { runCatching { it.stopTone(); it.release() } }; tone = null }

    fun stop() {
        runCatching { player?.stop() }; runCatching { player?.release() }; player = null
        runCatching { ringtone?.stop() }; ringtone = null
        if (vibrating) { runCatching { vibrator?.cancel() }; vibrating = false }
        stopTone()
    }
}
