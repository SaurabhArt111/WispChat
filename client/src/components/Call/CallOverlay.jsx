import { useEffect, useRef, useState } from "react";
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
} from "../common/Icons";
import "../../styles/call.css";

function useElapsed(startAt) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startAt) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startAt]);
  const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const s = String(elapsed % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export default function CallOverlay() {
  const { call, acceptCall, declineCall, endCall, toggleMute, toggleCamera } = useCall();
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const elapsed = useElapsed(call?.status === "connected" ? call.connectedAt : null);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = call?.localStream || null;
  }, [call?.localStream]);

  useEffect(() => {
    if (call?.kind === "video" && remoteVideoRef.current) remoteVideoRef.current.srcObject = call?.remoteStream || null;
    if (call?.kind === "audio" && remoteAudioRef.current) remoteAudioRef.current.srcObject = call?.remoteStream || null;
  }, [call?.remoteStream, call?.kind]);

  if (!call) return null;

  const isVideo = call.kind === "video";
  const isRinging = call.status === "ringing";
  const isIncoming = call.direction === "incoming" && isRinging;
  const isOutgoing = call.direction === "outgoing" && isRinging;
  const isActive = call.status === "connected" || call.status === "connecting" || call.status === "reconnecting";

  return createPortal(
    <div className="call-overlay">
      {isVideo && isActive && (
        <video ref={remoteVideoRef} className="call-remote-video" autoPlay playsInline />
      )}
      <audio ref={remoteAudioRef} autoPlay />

      {(!isVideo || !isActive) && (
        <div className="call-backdrop">
          <Avatar user={call.peer} size={128} />
        </div>
      )}

      <div className="call-topbar">
        <div className="call-peer-name">{call.peer.displayName}</div>
        <div className="call-status-line">
          {isIncoming && `Incoming ${isVideo ? "video" : "voice"} call…`}
          {isOutgoing && "Calling…"}
          {call.status === "connecting" && "Connecting…"}
          {call.status === "reconnecting" && "Reconnecting…"}
          {call.status === "connected" && (
            <span className="call-timer">
              <LockIcon size={11} /> {elapsed}
            </span>
          )}
        </div>
        {call.status === "connected" && call.safetyCode && (
          <div className="call-safety-code" title="Compare this code out loud to verify no one is intercepting your call">
            Safety code: {call.safetyCode}
          </div>
        )}
      </div>

      {isVideo && isActive && call.localStream && (
        <video
          ref={localVideoRef}
          className={`call-local-video ${call.cameraOff ? "hidden" : ""}`}
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
