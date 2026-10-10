import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCall } from "../../context/CallContext";
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

export default function CallOverlay() {
  const { call, acceptCall, declineCall, endCall, toggleMute, toggleCamera, flipCamera, toggleScreenShare } = useCall();
  const { showToast } = useToast();
  const [minimized, setMinimized] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [outputs, setOutputs] = useState([]); // audio output devices
  const [outputId, setOutputId] = useState("default");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const remoteAudioRef = useRef(null);
  const elapsed = useElapsed(call?.status === "connected" ? call.connectedAt : null);

  const onBlocked = useCallback(() => setAudioBlocked(true), []);
  const remoteVideoRef = useStreamRef(call?.remoteStream, { onBlocked: () => {} });
  const remoteAudioBind = useStreamRef(call?.remoteStream, { onBlocked });
  const localVideoRef = useStreamRef(call?.localStream);

  useEffect(() => {
    if (!call) {
      setAudioBlocked(false);
      setMinimized(false);
      setMoreOpen(false);
    }
  }, [call]);

  // Audio output devices (speaker / headset / Bluetooth). Browsers only expose
  // this where HTMLMediaElement.setSinkId exists (Chrome/Edge, Android Chrome).
  const canPickOutput = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
  async function loadOutputs() {
    if (!canPickOutput || !navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
      setOutputs(devices);
      return devices;
    } catch {
      return [];
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
  // Speaker button: cycle through available outputs, or explain when the
  // browser doesn't allow choosing one.
  async function cycleSpeaker() {
    if (!canPickOutput) {
      showToast("This browser always uses your device's default audio output");
      return;
    }
    const list = outputs.length ? outputs : await loadOutputs();
    if (list.length < 2) {
      showToast("Only one audio output is available");
      return;
    }
    const idx = Math.max(0, list.findIndex((d) => d.deviceId === outputId));
    const next = list[(idx + 1) % list.length];
    await chooseOutput(next.deviceId);
    showToast(`Audio: ${next.label || "Output device"}`);
  }
  function upgradeToVideo() {
    showToast("Switching to video mid-call isn't supported yet — end this call and start a video call");
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
    <div className={`call-overlay ${minimized ? "minimized" : ""}`}>
      {/* Remote audio always plays through its own element; the remote <video>
          is muted so sound is never doubled and audio-only calls work too. */}
      <audio
        ref={(el) => {
          remoteAudioRef.current = el;
          remoteAudioBind(el);
        }}
        autoPlay
        playsInline
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
        {call.status === "connected" && call.safetyCode && (
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
        <div className="call-controls">
          <button className="call-btn decline" onClick={declineCall} title="Decline">
            <PhoneOffIcon size={26} />
          </button>
          <button className="call-btn accept" onClick={acceptCall} title="Accept">
            <PhoneIcon size={26} />
          </button>
        </div>
      ) : (
        // WhatsApp-style 3 x 2 control card: Speaker · Video · Mute / More · Share · End.
        <div className="call-panel">
          {moreOpen && (
            <div className="call-more-menu" role="menu">
              {isVideo && (
                <button role="menuitem" onClick={() => { setMoreOpen(false); flipCamera(); }}>
                  <FlipCameraIcon size={18} /> Switch camera
                </button>
              )}
              <button role="menuitem" onClick={() => { setMoreOpen(false); setMinimized(true); }}>
                <MinimizeIcon size={18} /> Minimize
              </button>
              {canPickOutput && outputs.length > 0 && (
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
              {call.safetyCode && <div className="call-more-code">Safety code: {call.safetyCode}</div>}
            </div>
          )}
          <div className="call-panel-grid">
            <button className="call-panel-btn" onClick={cycleSpeaker}>
              <span className="call-panel-icon"><SpeakerIcon size={24} /></span>
              <span>Speaker</span>
            </button>
            <button
              className={`call-panel-btn ${isVideo && call.cameraOff ? "active" : ""}`}
              onClick={isVideo ? toggleCamera : upgradeToVideo}
            >
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
            <button className={`call-panel-btn ${call.sharing ? "active" : ""}`} onClick={toggleScreenShare}>
              <span className="call-panel-icon"><ScreenShareIcon size={24} /></span>
              <span>{call.sharing ? "Stop" : "Share"}</span>
            </button>
            <button className="call-panel-btn end" onClick={isOutgoing ? declineCall : endCall}>
              <span className="call-panel-icon"><PhoneOffIcon size={26} /></span>
              <span>{isOutgoing ? "Cancel" : "End"}</span>
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
