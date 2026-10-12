import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useCall } from "../../context/CallContext";
import { useChat } from "../../context/ChatContext";
import Avatar from "../common/Avatar";
import {
  PhoneIcon,
  PhoneOffIcon,
  MicIcon,
  MicOffIcon,
  VideoIcon,
  VideoOffIcon,
  LockIcon,
  RefreshIcon,
  FlipCameraIcon,
  SpeakerIcon,
  ScreenShareIcon,
  MoreIcon,
  MinimizeIcon,
  CheckIcon,
  ChatIcon,
  LockIcon as ShieldLockIcon,
} from "../common/Icons";
import { useToast } from "../../context/ToastContext";
import "../../styles/call.css";

function useElapsed(startAt) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startAt) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startAt]);
  const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const s = String(elapsed % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// Binds a MediaStream to a <video>/<audio> element via a *callback ref*.
//
// The previous version attached streams in a useEffect keyed on the stream,
// but the <video> elements were only mounted once the call reached the
// "connected" state — by which time the remote stream had usually already
// arrived and the effect had already run against a null ref. The stream was
// then never attached, so video stayed black and audio silent. A callback
// ref runs whenever the element mounts, so it always gets the current stream.
function useStreamRef(stream, { onBlocked } = {}) {
  const elRef = useRef(null);
  const streamRef = useRef(stream);
  streamRef.current = stream;

  const attach = useCallback(
    (el) => {
      if (!el) return;
      if (el.srcObject !== streamRef.current) el.srcObject = streamRef.current || null;
      const p = el.play?.();
      if (p && typeof p.catch === "function") p.catch(() => onBlocked?.());
    },
    [onBlocked]
  );

  const ref = useCallback(
    (el) => {
      elRef.current = el;
      attach(el);
    },
    [attach]
  );

  // Also re-attach when the stream object changes while the element stays mounted.
  useEffect(() => {
    if (elRef.current) attach(elRef.current);
  }, [stream, attach]);

  return ref;
}

// "Speaker": phones' browsers can't flip between earpiece and loudspeaker, so
// this does the part that is possible and audible — boosts the other person's
// voice (Web Audio gain + a soft limiter so peaks don't distort). While it's
// on, the plain <audio> element is muted so the sound isn't doubled.
function useLoudSpeaker(stream) {
  const [loud, setLoud] = useState(false);
  const supported = typeof window !== "undefined" && !!(window.AudioContext || window.webkitAudioContext);

  useEffect(() => {
    if (!loud || !stream || !supported) return undefined;
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx;
    try {
      ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = 2.4;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.ratio.value = 12;
      src.connect(gain);
      gain.connect(limiter);
      limiter.connect(ctx.destination);
      ctx.resume?.();
    } catch {
      setLoud(false);
      return undefined;
    }
    return () => {
      try {
        ctx.close();
      } catch {
        /* ignore */
      }
    };
  }, [loud, stream, supported]);

  return { loud, supported, toggle: () => setLoud((v) => !v) };
}


// Slide-to-answer: drag the green knob right past ~80% of the track to pick up
// (haptic buzz at the threshold). A plain tap/click on the knob — or Enter /
// Space when it is focused — answers too, so mouse and keyboard users never
// have to drag.
function SlideToAnswer({ onAnswer, video }) {
  const trackRef = useRef(null);
  const dragRef = useRef(null);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);
  const KNOB = 60;
  const maxX = () => Math.max(0, (trackRef.current?.clientWidth || 260) - KNOB - 8);

  function buzz(p) {
    try { navigator.vibrate?.(p); } catch { /* ignore */ }
  }
  function finish() {
    if (done) return;
    setDone(true);
    setX(maxX());
    buzz([20, 40, 30]);
    setTimeout(onAnswer, 120);
  }
  function down(e) {
    if (done) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, base: x, moved: false, armed: false };
    setDragging(true);
  }
  function move(e) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 6) d.moved = true;
    const next = Math.max(0, Math.min(maxX(), d.base + dx));
    const armed = next >= maxX() * 0.8;
    if (armed && !d.armed) buzz(14);
    d.armed = armed;
    setX(next);
  }
  function up() {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!d) return;
    if (!d.moved || x >= maxX() * 0.8) return finish(); // tap OR slid far enough
    setX(0); // spring back
  }
  const progress = maxX() ? x / maxX() : 0;

  return (
    <div className={`slide-answer ${done ? "done" : ""}`} ref={trackRef}>
      <div className="slide-answer-label" style={{ opacity: Math.max(0, 1 - progress * 1.6) }}>
        <span className="slide-chevrons"><i /><i /><i /></span>
        Slide to answer
      </div>
      <div className="slide-answer-fill" style={{ width: x + KNOB + 4 }} />
      <button
        type="button"
        className={`slide-answer-knob ${dragging ? "dragging" : ""}`}
        style={{ transform: `translateX(${x}px)` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); finish(); } }}
        aria-label={`Answer ${video ? "video" : "voice"} call`}
        title="Slide or tap to answer"
      >
        {video ? <VideoIcon size={26} /> : <PhoneIcon size={26} />}
      </button>
    </div>
  );
}

export default function CallOverlay() {
  const { call, acceptCall, declineCall, endCall, toggleMute, toggleCamera, flipCamera, toggleScreenShare } = useCall();
  const { showToast } = useToast();
  const { openConversation } = useChat();
  const navigate = useNavigate();
  const [minimized, setMinimized] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [outputs, setOutputs] = useState([]); // audio output devices
  const [outputId, setOutputId] = useState("default");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const remoteAudioRef = useRef(null);
  const hideTimerRef = useRef(null);
  const elapsed = useElapsed(call?.status === "connected" ? call.connectedAt : null);
  const speaker = useLoudSpeaker(call?.remoteStream);

  const onBlocked = useCallback(() => setAudioBlocked(true), []);
  const remoteVideoRef = useStreamRef(call?.remoteStream, { onBlocked: () => {} });
  const remoteAudioBind = useStreamRef(call?.remoteStream, { onBlocked });
  const localVideoRef = useStreamRef(call?.localStream);

  const isVideoCall = call?.kind === "video";
  const canShare = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

  // Video calls: the control bar tucks away after a few idle seconds so the
  // picture gets the whole screen; any tap or movement brings it back.
  const wake = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 4500);
  }, []);
  useEffect(() => {
    if (!call || !isVideoCall || call.status !== "connected" || moreOpen) {
      clearTimeout(hideTimerRef.current);
      setControlsVisible(true);
      return undefined;
    }
    wake();
    return () => clearTimeout(hideTimerRef.current);
  }, [call?.status, isVideoCall, moreOpen, wake, !!call]);

  useEffect(() => {
    if (!call) {
      setAudioBlocked(false);
      setMinimized(false);
      setMoreOpen(false);
    }
  }, [call]);

  // Audio output devices (Chrome/Edge/Android Chrome support setSinkId).
  const canPickOutput = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
  async function loadOutputs() {
    if (!canPickOutput || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      setOutputs((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput"));
    } catch {
      /* ignore */
    }
  }
  async function chooseOutput(id) {
    try {
      await remoteAudioRef.current?.setSinkId?.(id);
      setOutputId(id);
    } catch {
      showToast("Couldn't switch audio output");
    }
  }
  function toggleSpeaker() {
    if (!speaker.supported) {
      showToast("Your browser can't boost call volume");
      return;
    }
    speaker.toggle();
    showToast(speaker.loud ? "Speaker boost off" : "Speaker boost on — their voice is louder");
  }
  function openChatDuringCall() {
    setMoreOpen(false);
    setMinimized(true);
    if (call?.conversationId) {
      openConversation(call.conversationId);
      navigate(`/chat/${call.conversationId}`);
    }
  }

  function enableAudio() {
    setAudioBlocked(false);
    remoteAudioRef.current?.play?.().catch(() => setAudioBlocked(true));
  }

  if (!call) return null;

  const isVideo = call.kind === "video";
  const isRinging = call.status === "ringing";
  const isIncoming = call.direction === "incoming" && isRinging;
  const isOutgoing = call.direction === "outgoing" && isRinging;
  const isActive = call.status === "connected" || call.status === "connecting" || call.status === "reconnecting";
  const hasRemoteVideo = !!call.remoteStream?.getVideoTracks().some((t) => t.readyState === "live");
  const showRemoteVideo = isVideo && isActive && hasRemoteVideo && !call.remoteCameraOff;

  return createPortal(
    <div
      className={`call-overlay ${minimized ? "minimized" : ""} ${isVideo && isActive ? "video-mode" : ""} ${
        controlsVisible || !isVideo || !isActive ? "" : "controls-hidden"
      }`}
      onPointerDown={isVideo && isActive ? wake : undefined}
      onMouseMove={isVideo && isActive ? wake : undefined}
    >
      {/* Remote audio always plays through its own element; the remote <video>
          is muted so sound is never doubled and audio-only calls work too. */}
      <audio
        ref={(el) => {
          remoteAudioRef.current = el;
          remoteAudioBind(el);
        }}
        autoPlay
        playsInline
        muted={speaker.loud}
      />
      <video
        ref={remoteVideoRef}
        className={`call-remote-video ${showRemoteVideo ? "" : "hidden"}`}
        autoPlay
        playsInline
        muted
      />

      {!showRemoteVideo && (
        <div className="call-backdrop">
          <div className={`call-avatar-wrap ${call.status === "connected" ? "" : "pulsing"}`}>
            <Avatar user={call.peer} size={128} />
          </div>
        </div>
      )}

      <div className="call-topbar">
        <div className="call-peer-name">{call.peer.displayName}</div>
        <div className="call-status-line">
          {isIncoming && `Incoming ${isVideo ? "video" : "voice"} call…`}
          {isOutgoing && (call.deliveredRinging ? "Ringing…" : "Calling…")}
          {call.status === "connecting" && "Connecting…"}
          {call.status === "reconnecting" && (
            <span className="call-reconnect">
              <RefreshIcon size={12} /> Reconnecting…
            </span>
          )}
          {call.status === "connected" && (
            <span className="call-timer">
              <LockIcon size={11} /> {elapsed}
            </span>
          )}
        </div>
        {call.peerUnstable && call.status !== "ringing" && (
          <div className="call-notice">{call.peer.displayName} lost connection — waiting for them to rejoin…</div>
        )}
        {call.status === "connected" && !call.peerUnstable && call.remoteMuted && (
          <div className="call-notice subtle">
            <MicOffIcon size={12} /> {call.peer.displayName} is muted
          </div>
        )}
        {call.status === "connected" && isVideo && call.remoteCameraOff && (
          <div className="call-notice subtle">
            <VideoOffIcon size={12} /> {call.peer.displayName}'s camera is off
          </div>
        )}
        {call.status === "connected" && call.safetyCode && !isVideo && (
          <div className="call-safety-code" title="Compare this code out loud to verify no one is intercepting your call">
            Safety code: {call.safetyCode}
          </div>
        )}
      </div>

      {audioBlocked && (
        <button className="call-audio-tap" onClick={enableAudio}>
          Tap to enable sound
        </button>
      )}

      {/* Local preview: always mounted for video calls once we have a stream, so it can never miss the stream. */}
      {isVideo && call.localStream && !isIncoming && (
        <video
          ref={localVideoRef}
          className={`call-local-video ${call.cameraOff ? "hidden" : ""} ${call.mirrored === false ? "unmirrored" : ""}`}
          autoPlay
          playsInline
          muted
        />
      )}

      {minimized && (
        <button className="call-mini" onClick={() => setMinimized(false)} title="Return to call">
          <span className="call-mini-dot" />
          <span className="call-mini-name">{call.peer.displayName}</span>
          <span className="call-mini-time">{call.status === "connected" ? elapsed : "…"}</span>
        </button>
      )}

      {!minimized && !isIncoming && (
        <button className="call-minimize" onClick={() => setMinimized(true)} title="Minimize" aria-label="Minimize call">
          <MinimizeIcon size={20} />
        </button>
      )}

      {isIncoming ? (
        <div className="call-incoming">
          <div className="call-incoming-row">
            <div className="call-decline-wrap">
              <button className="call-btn decline" onClick={declineCall} title="Decline" aria-label="Decline call">
                <PhoneOffIcon size={26} />
              </button>
              <span>Decline</span>
            </div>
            <SlideToAnswer video={isVideo} onAnswer={acceptCall} />
          </div>
        </div>
      ) : (
        <>
          {moreOpen && (
            <div className={`call-more-menu ${isVideo && isActive ? "compact" : ""}`} role="menu">
              {(isVideo || call.sharing) && (
                <button role="menuitem" onClick={() => { setMoreOpen(false); flipCamera(); }}>
                  <FlipCameraIcon size={18} /> Switch camera
                </button>
              )}
              {canShare && (
                <button role="menuitem" onClick={() => { setMoreOpen(false); toggleScreenShare(); }}>
                  <ScreenShareIcon size={18} /> {call.sharing ? "Stop sharing screen" : "Share screen"}
                </button>
              )}
              <button role="menuitem" onClick={openChatDuringCall}>
                <ChatIcon size={18} /> Open chat
              </button>
              <button role="menuitem" onClick={() => { setMoreOpen(false); setMinimized(true); }}>
                <MinimizeIcon size={18} /> Minimize
              </button>
              {canPickOutput && outputs.length > 1 && (
                <>
                  <div className="call-more-label">Audio output</div>
                  {outputs.map((d) => (
                    <button key={d.deviceId} role="menuitemradio" aria-checked={outputId === d.deviceId} onClick={() => { chooseOutput(d.deviceId); setMoreOpen(false); }}>
                      <SpeakerIcon size={18} /> <span className="call-more-ellipsis">{d.label || "Output device"}</span>
                      {outputId === d.deviceId && <CheckIcon size={14} />}
                    </button>
                  ))}
                </>
              )}
              {call.safetyCode && (
                <div className="call-more-code">
                  <ShieldLockIcon size={12} /> Safety code: {call.safetyCode}
                </div>
              )}
            </div>
          )}

          {isVideo && isActive ? (
            // Video call: a small icon-only bar so the picture stays the focus.
            <div className="call-bar" onPointerDown={(e) => e.stopPropagation()}>
              <button className={`call-bar-btn ${call.muted ? "active" : ""}`} onClick={toggleMute} title={call.muted ? "Unmute" : "Mute"} aria-label="Mute">
                {call.muted ? <MicOffIcon size={20} /> : <MicIcon size={20} />}
              </button>
              <button className={`call-bar-btn ${call.cameraOff ? "active" : ""}`} onClick={toggleCamera} title={call.cameraOff ? "Camera on" : "Camera off"} aria-label="Camera">
                {call.cameraOff ? <VideoOffIcon size={20} /> : <VideoIcon size={20} />}
              </button>
              <button className="call-bar-btn" onClick={flipCamera} title="Switch camera" aria-label="Switch camera">
                <FlipCameraIcon size={20} />
              </button>
              <button className={`call-bar-btn ${speaker.loud ? "active" : ""}`} onClick={toggleSpeaker} title="Speaker boost" aria-label="Speaker">
                <SpeakerIcon size={20} />
              </button>
              <button className={`call-bar-btn ${moreOpen ? "active" : ""}`} onClick={() => { setMoreOpen((o) => !o); loadOutputs(); }} title="More" aria-label="More">
                <MoreIcon size={20} />
              </button>
              <button className="call-bar-btn end" onClick={endCall} title="End call" aria-label="End call">
                <PhoneOffIcon size={22} />
              </button>
            </div>
          ) : (
            // Voice call (and while a call is still ringing/connecting): the
            // roomy WhatsApp-style 3 × 2 panel.
            <div className="call-panel">
              <div className="call-panel-grid">
                <button className={`call-panel-btn ${speaker.loud ? "active" : ""}`} onClick={toggleSpeaker}>
                  <span className="call-panel-icon"><SpeakerIcon size={24} /></span>
                  <span>Speaker</span>
                </button>
                <button className={`call-panel-btn ${isVideo && call.cameraOff ? "active" : ""}`} onClick={toggleCamera}>
                  <span className="call-panel-icon">{isVideo && call.cameraOff ? <VideoOffIcon size={24} /> : <VideoIcon size={24} />}</span>
                  <span>Video</span>
                </button>
                <button className={`call-panel-btn ${call.muted ? "active" : ""}`} onClick={toggleMute}>
                  <span className="call-panel-icon">{call.muted ? <MicOffIcon size={24} /> : <MicIcon size={24} />}</span>
                  <span>Mute</span>
                </button>
                <button className={`call-panel-btn ${moreOpen ? "active" : ""}`} onClick={() => { setMoreOpen((o) => !o); loadOutputs(); }}>
                  <span className="call-panel-icon"><MoreIcon size={24} /></span>
                  <span>More</span>
                </button>
                {canShare ? (
                  <button className={`call-panel-btn ${call.sharing ? "active" : ""}`} onClick={toggleScreenShare}>
                    <span className="call-panel-icon"><ScreenShareIcon size={24} /></span>
                    <span>{call.sharing ? "Stop" : "Share"}</span>
                  </button>
                ) : (
                  <button className="call-panel-btn" onClick={openChatDuringCall}>
                    <span className="call-panel-icon"><ChatIcon size={24} /></span>
                    <span>Chat</span>
                  </button>
                )}
                <button className="call-panel-btn end" onClick={isOutgoing ? declineCall : endCall}>
                  <span className="call-panel-icon"><PhoneOffIcon size={26} /></span>
                  <span>{isOutgoing ? "Cancel" : "End"}</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>,
    document.body
  );
}
