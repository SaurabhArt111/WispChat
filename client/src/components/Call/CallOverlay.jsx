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
} from "../common/Icons";
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
  const { call, acceptCall, declineCall, endCall, toggleMute, toggleCamera, flipCamera } = useCall();
  const [audioBlocked, setAudioBlocked] = useState(false);
  const remoteAudioRef = useRef(null);
  const elapsed = useElapsed(call?.status === "connected" ? call.connectedAt : null);

  const onBlocked = useCallback(() => setAudioBlocked(true), []);
  const remoteVideoRef = useStreamRef(call?.remoteStream, { onBlocked: () => {} });
  const remoteAudioBind = useStreamRef(call?.remoteStream, { onBlocked });
  const localVideoRef = useStreamRef(call?.localStream);

  useEffect(() => {
    if (!call) setAudioBlocked(false);
  }, [call]);

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
    <div className="call-overlay">
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

      <div className="call-controls">
        {isIncoming ? (
          <>
            <button className="call-btn decline" onClick={declineCall} title="Decline">
              <PhoneOffIcon size={26} />
            </button>
            <button className="call-btn accept" onClick={acceptCall} title="Accept">
              <PhoneIcon size={26} />
            </button>
          </>
        ) : (
          <>
            <button className={`call-btn small ${call.muted ? "active" : ""}`} onClick={toggleMute} title={call.muted ? "Unmute" : "Mute"}>
              {call.muted ? <MicOffIcon size={20} /> : <MicIcon size={20} />}
            </button>
            {isVideo && (
              <button
                className={`call-btn small ${call.cameraOff ? "active" : ""}`}
                onClick={toggleCamera}
                title={call.cameraOff ? "Turn camera on" : "Turn camera off"}
              >
                {call.cameraOff ? <VideoOffIcon size={20} /> : <VideoIcon size={20} />}
              </button>
            )}
            {isVideo && (
              <button className="call-btn small" onClick={flipCamera} title="Switch camera">
                <FlipCameraIcon size={20} />
              </button>
            )}
            <button className="call-btn decline" onClick={isOutgoing ? declineCall : endCall} title={isOutgoing ? "Cancel" : "End call"}>
              <PhoneOffIcon size={26} />
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
