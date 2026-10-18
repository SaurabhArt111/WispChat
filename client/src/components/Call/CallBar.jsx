import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useCall } from "../../context/CallContext";
import useElapsed from "../../hooks/useElapsed";
import { PhoneIcon, PhoneOffIcon, MicIcon, MicOffIcon } from "../common/Icons";
import "../../styles/callBar.css";

/**
 * "Call in progress" bar pinned to the very top of the app while a call is
 * minimised — the same thing WhatsApp shows when you leave the call screen to
 * look at a chat:   [ mic ]   📞 Name – Ringing / 02:13   [ hang up ]
 *
 * Tap the middle to go back to the full call screen. The rest of the app is
 * pushed down by the bar's height (see `body.has-call-bar` in callBar.css),
 * so nothing is covered.
 */
export default function CallBar() {
  const { call, minimized, setMinimized, toggleMute, endCall, declineCall } = useCall();
  const visible = !!call && minimized && !(call.direction === "incoming" && call.status === "ringing");
  const elapsed = useElapsed(visible && call.status === "connected" ? call.connectedAt : null);

  useEffect(() => {
    if (!visible) return undefined;
    document.body.classList.add("has-call-bar");
    return () => document.body.classList.remove("has-call-bar");
  }, [visible]);

  if (!visible) return null;

  const ringing = call.status === "ringing";
  const state =
    call.status === "connected"
      ? elapsed
      : ringing
      ? call.deliveredRinging
        ? "Ringing"
        : "Calling"
      : call.status === "reconnecting"
      ? "Reconnecting"
      : "Connecting";

  return createPortal(
    <div className={`call-bar-top ${call.status === "connected" ? "live" : ""}`} role="region" aria-label="Call in progress">
      <button
        type="button"
        className={`call-bar-top-btn mic ${call.muted ? "muted" : ""}`}
        onClick={toggleMute}
        title={call.muted ? "Unmute" : "Mute"}
        aria-label={call.muted ? "Unmute microphone" : "Mute microphone"}
        aria-pressed={!!call.muted}
      >
        {call.muted ? <MicOffIcon size={22} /> : <MicIcon size={22} />}
      </button>

      <button type="button" className="call-bar-top-info" onClick={() => setMinimized(false)} title="Return to call">
        <PhoneIcon size={17} />
        <span className="call-bar-top-text">
          <span className="call-bar-top-name">{call.peer?.displayName || "Call"}</span>
          <span className="call-bar-top-sep"> - </span>
          <span className="call-bar-top-state">{state}</span>
        </span>
      </button>

      <button
        type="button"
        className="call-bar-top-btn end"
        onClick={ringing && call.direction === "outgoing" ? declineCall : endCall}
        title={ringing ? "Cancel call" : "End call"}
        aria-label={ringing ? "Cancel call" : "End call"}
      >
        <PhoneOffIcon size={22} />
      </button>
    </div>,
    document.body
  );
}
