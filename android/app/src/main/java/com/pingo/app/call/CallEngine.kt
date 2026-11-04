package com.pingo.app.call

import android.content.Context
import android.media.AudioManager
import com.pingo.app.data.Conversation
import com.pingo.app.data.Repo
import com.pingo.app.net.Realtime
import com.pingo.app.notify.Notifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import org.webrtc.audio.JavaAudioDeviceModule
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

enum class Phase { IDLE, OUTGOING, INCOMING, CONNECTING, CONNECTED, ENDED }

data class CallState(
    val phase: Phase = Phase.IDLE,
    val callId: String = "",
    val convId: String = "",
    val kind: String = "audio",
    val peerId: String = "",
    val peerName: String = "",
    val outgoing: Boolean = false,
    val muted: Boolean = false,
    val cameraOn: Boolean = true,
    val speaker: Boolean = false,
    val connectedAt: Long = 0,
    val endReason: String = "",
    val remoteVideo: VideoTrack? = null,
    val localVideo: VideoTrack? = null,
    val remoteCameraOff: Boolean = false,
    val unstable: Boolean = false,
)

/**
 * WebRTC call engine. Speaks exactly the signalling the Node server relays
 * (call:invite / answer / ice-candidate / signal / end ...), the same one the web app uses, so native↔native
 * and native↔web calls work.
 */
class CallEngine(private val ctx: Context, private val repo: Repo) {
    private val scope = CoroutineScope(Dispatchers.Main.immediate + kotlinx.coroutines.SupervisorJob())
    private val _state = MutableStateFlow(CallState())
    val state: StateFlow<CallState> = _state

    val egl: EglBase by lazy { EglBase.create() }
    private var factory: PeerConnectionFactory? = null
    private var pc: PeerConnection? = null
    private var audioTrack: AudioTrack? = null
    private var videoSource: VideoSource? = null
    private var capturer: CameraVideoCapturer? = null
    private var helper: SurfaceTextureHelper? = null
    private var localVideoTrack: VideoTrack? = null
    private var frontCamera = true

    private var pendingOffer: JSONObject? = null
    private var answerWanted = false
    private val pendingIce = ArrayList<IceCandidate>()
    private var remoteSet = false
    private var ringTimeout: Job? = null
    private var disconnectJob: Job? = null

    init {
        scope.launch { repo.callEvents.collect { onEvent(it) } }
    }

    // ------------------------------------------------------------------ factory
    private fun ensureFactory(): PeerConnectionFactory {
        factory?.let { return it }
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(ctx.applicationContext).createInitializationOptions())
        val adm = JavaAudioDeviceModule.builder(ctx.applicationContext).setUseHardwareAcousticEchoCanceler(true).setUseHardwareNoiseSuppressor(true).createAudioDeviceModule()
        return PeerConnectionFactory.builder()
            .setAudioDeviceModule(adm)
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
            .createPeerConnectionFactory().also { factory = it }
    }

    private suspend fun iceServers(): List<PeerConnection.IceServer> {
        val fallback = listOf(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
        return try {
            val arr = repo.api.request("GET", "/calls/ice", null, 1).optJSONArray("iceServers") ?: return fallback
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                val urls = when (val u = o.opt("urls")) { is JSONArray -> (0 until u.length()).map { u.getString(it) }; else -> listOf(u.toString()) }
                PeerConnection.IceServer.builder(urls).apply {
                    if (o.has("username")) setUsername(o.getString("username"))
                    if (o.has("credential")) setPassword(o.getString("credential"))
                }.createIceServer()
            }.ifEmpty { fallback }
        } catch (_: Exception) { fallback }
    }

    private fun audioManager() = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    // ------------------------------------------------------------------ entry points
    fun startOutgoing(conv: Conversation, kind: String) {
        if (_state.value.phase != Phase.IDLE && _state.value.phase != Phase.ENDED) return
        val peer = conv.other(repo.myId) ?: return
        val callId = java.util.UUID.randomUUID().toString()
        _state.value = CallState(Phase.OUTGOING, callId, conv.id, kind, peer.id, peer.displayName, outgoing = true, cameraOn = kind == "video", speaker = kind == "video")
        repo.callActive = true
        CallService.start(ctx, peer.displayName, kind)
        scope.launch {
            try {
                ensureConnectedSocket()
                createPeer(kind)
                val offer = pc!!.createOfferSuspend(MediaConstraints())
                pc!!.setLocalSuspend(offer)
                repo.rt.emit("call:invite", JSONObject().put("callId", callId).put("calleeId", peer.id).put("conversationId", conv.id)
                    .put("kind", kind).put("offer", sdpJson(offer)).put("device", deviceJson()))
                armRingTimeout()
            } catch (e: Exception) { finish("failed") }
        }
    }

    /** From the realtime `call:incoming` event (app open) or from a push (app was closed — the offer follows once the socket connects). */
    fun onIncoming(callId: String, convId: String, kind: String, peerName: String, peerId: String, offer: JSONObject?) {
        val st = _state.value
        if (st.callId == callId) { if (offer != null) { pendingOffer = offer; maybeAnswer() }; return }
        if (st.phase != Phase.IDLE && st.phase != Phase.ENDED) return // busy: the server auto-declines for us
        pendingOffer = offer; answerWanted = false; remoteSet = false; pendingIce.clear()
        _state.value = CallState(Phase.INCOMING, callId, convId, kind, peerId, peerName, outgoing = false, cameraOn = kind == "video", speaker = kind == "video")
        repo.callActive = true // opens the live socket; the server re-sends the offer to it
        armRingTimeout()
    }

    fun answer() {
        val st = _state.value
        if (st.phase != Phase.INCOMING) return
        answerWanted = true
        _state.update { it.copy(phase = Phase.CONNECTING) }
        Notifier.cancelIncomingCall(ctx)
        CallService.start(ctx, st.peerName, st.kind)
        maybeAnswer()
    }

    private fun maybeAnswer() {
        val offer = pendingOffer ?: return
        if (!answerWanted || pc != null) return
        val st = _state.value
        scope.launch {
            try {
                createPeer(st.kind)
                pc!!.setRemoteSuspend(sdpFrom(offer)); remoteSet = true
                flushIce()
                val ans = pc!!.createAnswerSuspend(MediaConstraints())
                pc!!.setLocalSuspend(ans)
                repo.rt.emit("call:answer", JSONObject().put("callId", st.callId).put("answer", sdpJson(ans)).put("device", deviceJson()))
            } catch (e: Exception) { repo.rt.emit("call:end", JSONObject().put("callId", st.callId)); finish("failed") }
        }
    }

    fun decline() {
        val st = _state.value
        if (st.phase == Phase.INCOMING || (st.phase == Phase.CONNECTING && !st.outgoing)) repo.rt.emit("call:decline", JSONObject().put("callId", st.callId))
        scope.launch { try { repo.api.request("POST", "/calls/${st.callId}/decline", JSONObject(), 0) } catch (_: Exception) {} }
        finish("declined")
    }

    fun hangUp() {
        val st = _state.value
        if (st.callId.isNotEmpty()) repo.rt.emit("call:end", JSONObject().put("callId", st.callId))
        finish("ended")
    }

    // ------------------------------------------------------------------ controls
    fun toggleMute() { val m = !_state.value.muted; audioTrack?.setEnabled(!m); _state.update { it.copy(muted = m); }; sendMedia() }
    fun toggleCamera() { val on = !_state.value.cameraOn; localVideoTrack?.setEnabled(on); _state.update { it.copy(cameraOn = on) }; sendMedia() }
    fun switchCamera() { capturer?.switchCamera(null); frontCamera = !frontCamera }
    fun toggleSpeaker() { val on = !_state.value.speaker; audioManager().isSpeakerphoneOn = on; _state.update { it.copy(speaker = on) } }
    private fun sendMedia() {
        val s = _state.value
        repo.rt.emit("call:media-state", JSONObject().put("callId", s.callId).put("muted", s.muted).put("cameraOff", !s.cameraOn))
    }

    // ------------------------------------------------------------------ peer connection
    private suspend fun ensureConnectedSocket() {
        repo.rt.connect()
        var waited = 0
        while (!repo.rt.connected.value && waited < 40_000) { delay(250); waited += 250 } // covers a waking host
        if (!repo.rt.connected.value) error("socket")
    }

    private suspend fun createPeer(kind: String) {
        val f = ensureFactory()
        val cfg = PeerConnection.RTCConfiguration(iceServers()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        pc = f.createPeerConnection(cfg, observer) ?: error("peer")
        val am = audioManager(); am.mode = AudioManager.MODE_IN_COMMUNICATION; am.isSpeakerphoneOn = _state.value.speaker

        val audioSource = f.createAudioSource(MediaConstraints())
        audioTrack = f.createAudioTrack("a0", audioSource).also { pc!!.addTrack(it, listOf("s0")) }
        if (kind == "video") {
            val enumerator = Camera2Enumerator(ctx)
            val name = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) } ?: enumerator.deviceNames.firstOrNull()
            if (name != null) {
                videoSource = f.createVideoSource(false)
                helper = SurfaceTextureHelper.create("capture", egl.eglBaseContext)
                capturer = enumerator.createCapturer(name, null)?.also {
                    it.initialize(helper, ctx, videoSource!!.capturerObserver)
                    it.startCapture(720, 1280, 30)
                }
                localVideoTrack = f.createVideoTrack("v0", videoSource).also { t -> pc!!.addTrack(t, listOf("s0")); _state.update { it.copy(localVideo = t) } }
            }
        }
    }

    private val observer = object : PeerConnection.Observer {
        override fun onIceCandidate(c: IceCandidate) {
            val id = _state.value.callId
            repo.rt.emit("call:ice-candidate", JSONObject().put("callId", id).put("candidate",
                JSONObject().put("candidate", c.sdp).put("sdpMid", c.sdpMid).put("sdpMLineIndex", c.sdpMLineIndex)))
        }
        override fun onConnectionChange(s: PeerConnection.PeerConnectionState) {
            scope.launch {
                when (s) {
                    PeerConnection.PeerConnectionState.CONNECTED -> {
                        disconnectJob?.cancel(); ringTimeout?.cancel()
                        _state.update { it.copy(phase = Phase.CONNECTED, connectedAt = if (it.connectedAt == 0L) System.currentTimeMillis() else it.connectedAt, unstable = false) }
                    }
                    PeerConnection.PeerConnectionState.DISCONNECTED -> {
                        _state.update { it.copy(unstable = true) }
                        disconnectJob?.cancel()
                        disconnectJob = launch { delay(3000); restartIce(); delay(25_000); if (_state.value.unstable) { hangUp() } }
                    }
                    PeerConnection.PeerConnectionState.FAILED -> restartIce()
                    else -> {}
                }
            }
        }
        override fun onTrack(t: RtpTransceiver) {
            val track = t.receiver.track()
            if (track is VideoTrack) scope.launch { _state.update { it.copy(remoteVideo = track) } }
        }
        override fun onSignalingChange(p0: PeerConnection.SignalingState?) {}
        override fun onIceConnectionChange(p0: PeerConnection.IceConnectionState?) {}
        override fun onIceConnectionReceivingChange(p0: Boolean) {}
        override fun onIceGatheringChange(p0: PeerConnection.IceGatheringState?) {}
        override fun onIceCandidatesRemoved(p0: Array<out IceCandidate>?) {}
        override fun onAddStream(p0: MediaStream?) {}
        override fun onRemoveStream(p0: MediaStream?) {}
        override fun onDataChannel(p0: org.webrtc.DataChannel?) {}
        override fun onRenegotiationNeeded() {}
    }

    /** Network changed / dropped: the caller side re-offers with an ICE restart (the callee answers via call:signal). */
    private suspend fun restartIce() {
        val st = _state.value
        val p = pc ?: return
        if (!st.outgoing || st.phase == Phase.ENDED) return
        try {
            val c = MediaConstraints().apply { mandatory.add(MediaConstraints.KeyValuePair("IceRestart", "true")) }
            val offer = p.createOfferSuspend(c); p.setLocalSuspend(offer)
            repo.rt.emit("call:signal", JSONObject().put("callId", st.callId).put("description", sdpJson(offer)))
        } catch (_: Exception) {}
    }

    // ------------------------------------------------------------------ signalling events
    private suspend fun onEvent(e: Realtime.Event) {
        val d = e.data
        val st = _state.value
        when (e.name) {
            "call:incoming" -> {
                val from = d.optJSONObject("from")
                onIncoming(d.optString("callId"), d.optString("conversationId"), d.optString("kind", "audio"),
                    from?.optString("displayName", "Someone") ?: "Someone", from?.optString("_id").orEmpty(), d.optJSONObject("offer"))
            }
            else -> {
                if (d.optString("callId") != st.callId) return
                when (e.name) {
                    "call:ringing" -> {}
                    "call:answered" -> d.optJSONObject("answer")?.let { a ->
                        try { pc?.setRemoteSuspend(sdpFrom(a)); remoteSet = true; flushIce(); _state.update { it.copy(phase = Phase.CONNECTING) } } catch (_: Exception) { finish("failed") }
                    }
                    "call:ice-candidate" -> d.optJSONObject("candidate")?.let { c ->
                        val mid = if (c.isNull("sdpMid")) "0" else c.optString("sdpMid", "0")
                        val ic = IceCandidate(mid, c.optInt("sdpMLineIndex", 0), c.optString("candidate"))
                        if (remoteSet && pc != null) pc?.addIceCandidate(ic) else pendingIce += ic
                    }
                    "call:signal" -> d.optJSONObject("description")?.let { desc ->
                        try {
                            val sd = sdpFrom(desc); val p = pc ?: return
                            p.setRemoteSuspend(sd)
                            if (sd.type == SessionDescription.Type.OFFER) {
                                val ans = p.createAnswerSuspend(MediaConstraints()); p.setLocalSuspend(ans)
                                repo.rt.emit("call:signal", JSONObject().put("callId", st.callId).put("description", sdpJson(ans)))
                            }
                        } catch (_: Exception) {}
                    }
                    "call:media-state" -> _state.update { it.copy(remoteCameraOff = d.optBoolean("cameraOff", false)) }
                    "call:declined" -> finish("declined")
                    "call:busy" -> finish("busy")
                    "call:unavailable" -> finish("unavailable")
                    "call:timeout" -> finish("no answer")
                    "call:ended", "call:handled-elsewhere" -> finish("ended")
                }
            }
        }
    }

    private fun flushIce() { pendingIce.forEach { pc?.addIceCandidate(it) }; pendingIce.clear() }

    private fun armRingTimeout() {
        ringTimeout?.cancel()
        ringTimeout = scope.launch { delay(50_000); if (_state.value.phase == Phase.OUTGOING || _state.value.phase == Phase.INCOMING) finish("no answer") }
    }

    private fun finish(reason: String) {
        if (_state.value.phase == Phase.IDLE || _state.value.phase == Phase.ENDED) return
        ringTimeout?.cancel(); disconnectJob?.cancel()
        Notifier.cancelIncomingCall(ctx)
        try { capturer?.stopCapture() } catch (_: Exception) {}
        capturer?.dispose(); capturer = null
        helper?.dispose(); helper = null
        localVideoTrack?.dispose(); localVideoTrack = null
        videoSource?.dispose(); videoSource = null
        audioTrack?.dispose(); audioTrack = null
        pc?.close(); pc = null
        pendingOffer = null; pendingIce.clear(); remoteSet = false; answerWanted = false
        val am = audioManager(); am.mode = AudioManager.MODE_NORMAL; am.isSpeakerphoneOn = false
        CallService.stop(ctx)
        _state.update { it.copy(phase = Phase.ENDED, endReason = reason, remoteVideo = null, localVideo = null) }
        repo.callActive = false
        scope.launch { delay(1800); if (_state.value.phase == Phase.ENDED) _state.value = CallState() }
    }

    // ------------------------------------------------------------------ SDP helpers
    private fun sdpJson(s: SessionDescription) = JSONObject().put("type", s.type.canonicalForm()).put("sdp", s.description)
    private fun sdpFrom(o: JSONObject) = SessionDescription(SessionDescription.Type.fromCanonicalForm(o.getString("type")), o.getString("sdp"))
    private fun deviceJson() = JSONObject().put("type", "mobile").put("orientation", "portrait")

    private suspend fun PeerConnection.createOfferSuspend(c: MediaConstraints) = suspendCancellableCoroutine<SessionDescription> { k ->
        createOffer(object : SdpAdapter() { override fun onCreateSuccess(d: SessionDescription) = k.resume(d); override fun onCreateFailure(e: String?) = k.resumeWithException(IllegalStateException(e)) }, c)
    }
    private suspend fun PeerConnection.createAnswerSuspend(c: MediaConstraints) = suspendCancellableCoroutine<SessionDescription> { k ->
        createAnswer(object : SdpAdapter() { override fun onCreateSuccess(d: SessionDescription) = k.resume(d); override fun onCreateFailure(e: String?) = k.resumeWithException(IllegalStateException(e)) }, c)
    }
    private suspend fun PeerConnection.setLocalSuspend(d: SessionDescription) = suspendCancellableCoroutine<Unit> { k ->
        setLocalDescription(object : SdpAdapter() { override fun onSetSuccess() = k.resume(Unit); override fun onSetFailure(e: String?) = k.resumeWithException(IllegalStateException(e)) }, d)
    }
    private suspend fun PeerConnection.setRemoteSuspend(d: SessionDescription) = suspendCancellableCoroutine<Unit> { k ->
        setRemoteDescription(object : SdpAdapter() { override fun onSetSuccess() = k.resume(Unit); override fun onSetFailure(e: String?) = k.resumeWithException(IllegalStateException(e)) }, d)
    }

    private open class SdpAdapter : SdpObserver {
        override fun onCreateSuccess(d: SessionDescription) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(e: String?) {}
        override fun onSetFailure(e: String?) {}
    }
}
