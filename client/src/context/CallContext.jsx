import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import { useSocket } from "./SocketContext";
import { useToast } from "./ToastContext";
import { logError } from "../utils/logger";

const CallContext = createContext(null);

// Public STUN servers (free, no signup) are enough to establish a direct
// peer-to-peer connection on most home/office networks. Some networks
// (symmetric NAT, some corporate firewalls) need a TURN relay to connect
// at all — that requires running a TURN server, which is out of scope
// here, so a call between two people on such networks may fail to
// connect. Everything else about the call (media itself) is exactly the
// same either way.
const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

const RING_TIMEOUT_MS = 45000;

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// A short, human-checkable code derived from both sides' DTLS
// certificate fingerprints — WebRTC's media is *always* encrypted
// peer-to-peer via DTLS-SRTP (that part isn't optional, and the
// signaling server never sees audio/video either way), but the
// signaling server *could* in principle try to swap in its own SDP to
// sit in the middle. Comparing this code out loud is the same idea as
// Signal's "safety number" for calls — if it matches on both ends, the
// connection wasn't tampered with in transit.
async function computeSafetyCode(pc) {
  try {
    const local = pc.localDescription?.sdp || "";
    const remote = pc.remoteDescription?.sdp || "";
    const localFp = /a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/.exec(local)?.[1] || "";
    const remoteFp = /a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/.exec(remote)?.[1] || "";
    const combined = [localFp, remoteFp].sort().join("|");
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(combined));
    const bytes = new Uint8Array(digest);
    let code = "";
    for (let i = 0; i < 6; i++) code += (bytes[i] % 10).toString();
    return code.match(/.{1,3}/g).join(" ");
  } catch {
    return null;
  }
}

// A single shared AudioContext, reused for every ring/ringback tone
// instead of a fresh `new AudioContext()` per tone. Browsers block audio
// from starting until the page has had *some* user gesture; creating a
// context on every incoming-call socket event (which isn't a gesture)
// just produced a console warning and often no sound at all. Instead,
// this context is created lazily and resumed the moment the person
// interacts with the page at all (see the click/keydown listener in
// CallProvider below) — after that one-time resume, the same context
// can be reused freely for calls that arrive later with no gesture
// needed at that point, satisfying the autoplay policy correctly.
let sharedAudioCtx = null;
function getAudioCtx() {
  if (!sharedAudioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    sharedAudioCtx = new Ctor();
  }
  return sharedAudioCtx;
}

function playTone(freqs, durationMs, gain = 0.05) {
  const ctx = getAudioCtx();
  if (!ctx || ctx.state !== "running") return; // not resumed yet — silently skip rather than warn
  const master = ctx.createGain();
  master.gain.value = gain;
  master.connect(ctx.destination);
  freqs.forEach((f) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = f;
    osc.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
  });
}

export function CallProvider({ children }) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const { showToast } = useToast();

  const [call, setCall] = useState(null); // see shape notes below
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const ringIntervalRef = useRef(null);
  const ringTimeoutRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const incomingOfferRef = useRef(null); // { callId, conversationId, kind, offer, from }
  const startingRef = useRef(false); // guards against a double-click firing startCall twice

  useEffect(() => {
    if (Notification?.permission === "default") {
      // Ask once, quietly, rather than blocking on it — declining just
      // means incoming calls only ring in-app instead of also raising an
      // OS notification when the tab isn't focused.
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Resume (or lazily create) the shared ring/ringback AudioContext the
  // very first time the person interacts with the page at all — this is
  // what makes a *later*, gesture-less incoming-call ringtone actually
  // audible instead of silently blocked by the browser's autoplay policy.
  useEffect(() => {
    function resumeOnce() {
      const ctx = getAudioCtx();
      ctx?.resume().catch(() => {});
      window.removeEventListener("pointerdown", resumeOnce);
      window.removeEventListener("keydown", resumeOnce);
    }
    window.addEventListener("pointerdown", resumeOnce);
    window.addEventListener("keydown", resumeOnce);
    return () => {
      window.removeEventListener("pointerdown", resumeOnce);
      window.removeEventListener("keydown", resumeOnce);
    };
  }, []);

  const cleanup = useCallback(() => {
    clearInterval(ringIntervalRef.current);
    clearTimeout(ringTimeoutRef.current);
    clearTimeout(reconnectTimeoutRef.current);
    ringIntervalRef.current = null;
    ringTimeoutRef.current = null;
    reconnectTimeoutRef.current = null;
    pendingCandidatesRef.current = [];
    incomingOfferRef.current = null;
    startingRef.current = false;
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setCall(null);
  }, []);

  function startRingback() {
    playTone([440, 480], 1400);
    ringIntervalRef.current = setInterval(() => playTone([440, 480], 1400), 3500);
  }
  function startRingtone() {
    playTone([523, 659], 900);
    ringIntervalRef.current = setInterval(() => playTone([523, 659], 900), 2000);
  }
  function stopRinging() {
    clearInterval(ringIntervalRef.current);
    ringIntervalRef.current = null;
  }

  const buildPeerConnection = useCallback(
    (callId, otherUserId) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket?.emit("call:ice-candidate", { callId, candidate: e.candidate, to: otherUserId });
        }
      };

      pc.ontrack = (e) => {
        setCall((c) => (c && c.callId === callId ? { ...c, remoteStream: e.streams[0] } : c));
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
          setCall((c) => {
            if (!c || c.callId !== callId) return c;
            computeSafetyCode(pc).then((safetyCode) =>
              setCall((c2) => (c2 && c2.callId === callId ? { ...c2, safetyCode } : c2))
            );
            return { ...c, status: "connected", connectedAt: c.connectedAt || Date.now() };
          });
        } else if (["failed", "disconnected"].includes(pc.connectionState)) {
          // A network blip (wifi handoff, brief packet loss) reports as
          // "disconnected" and often self-heals in a few seconds; "failed"
          // means ICE gave up entirely. Either way, try an ICE restart
          // (renegotiating fresh candidates without tearing down the whole
          // call) rather than immediately hanging up on a call that might
          // still recover.
          setCall((c) => (c && c.callId === callId && c.status !== "ended" ? { ...c, status: "reconnecting" } : c));
          try {
            pc.restartIce();
          } catch {
            // restartIce isn't supported in every browser — the
            // reconnectTimeout below still covers cleanup either way.
          }
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = setTimeout(() => {
            if (["failed", "disconnected"].includes(pc.connectionState)) {
              showToast("Call connection lost");
              cleanup();
            }
          }, 15000);
        } else if (pc.connectionState === "closed") {
          setCall((c) => (c && c.callId === callId && c.status !== "ended" ? { ...c, status: "reconnecting" } : c));
        }
      };

      return pc;
    },
    [socket]
  );

  const startCall = useCallback(
    async (conversation, kind) => {
      if (call || startingRef.current) return; // already on/starting a call
      startingRef.current = true;
      const other = conversation.participants.find((p) => p._id !== user._id);
      if (!other) {
        startingRef.current = false;
        return;
      }

      const callId = uid();
      try {
        const localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: kind === "video" ? { width: 1280, height: 720 } : false,
        });
        localStreamRef.current = localStream;

        const pc = buildPeerConnection(callId, other._id);
        pcRef.current = pc;
        localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

        setCall({
          callId,
          direction: "outgoing",
          status: "ringing",
          kind,
          peer: other,
          conversationId: conversation._id,
          localStream,
          remoteStream: null,
          muted: false,
          cameraOff: false,
          safetyCode: null,
        });
        startingRef.current = false;
        startRingback();

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket?.emit("call:invite", { callId, calleeId: other._id, conversationId: conversation._id, kind, offer });

        ringTimeoutRef.current = setTimeout(() => {
          showToast("No answer");
          cleanup();
        }, RING_TIMEOUT_MS + 2000);
      } catch (err) {
        logError("call:start", err);
        showToast(
          err?.name === "NotAllowedError"
            ? "Camera/microphone permission was denied"
            : "Couldn't start the call — check your camera/microphone",
          "danger"
        );
        cleanup();
      }
    },
    [call, user, buildPeerConnection, socket, showToast, cleanup]
  );

  const acceptCall = useCallback(async () => {
    const pending = incomingOfferRef.current;
    if (!pending) return;
    stopRinging();
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: pending.kind === "video" ? { width: 1280, height: 720 } : false,
      });
      localStreamRef.current = localStream;

      const pc = buildPeerConnection(pending.callId, pending.from._id);
      pcRef.current = pc;
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

      await pc.setRemoteDescription(new RTCSessionDescription(pending.offer));
      for (const c of pendingCandidatesRef.current) await pc.addIceCandidate(c).catch(() => {});
      pendingCandidatesRef.current = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket?.emit("call:answer", { callId: pending.callId, answer });

      setCall((c) => (c && c.callId === pending.callId ? { ...c, status: "connecting", localStream } : c));
      incomingOfferRef.current = null;
    } catch (err) {
      logError("call:accept", err);
      showToast(
        err?.name === "NotAllowedError"
          ? "Camera/microphone permission was denied"
          : "Couldn't join the call — check your camera/microphone",
        "danger"
      );
      socket?.emit("call:decline", { callId: pending.callId });
      cleanup();
    }
  }, [buildPeerConnection, socket, showToast, cleanup]);

  const declineCall = useCallback(() => {
    const pending = incomingOfferRef.current;
    if (pending) socket?.emit("call:decline", { callId: pending.callId });
    else if (call) socket?.emit("call:decline", { callId: call.callId });
    cleanup();
  }, [call, socket, cleanup]);

  const endCall = useCallback(() => {
    if (call) socket?.emit("call:end", { callId: call.callId });
    cleanup();
  }, [call, socket, cleanup]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCall((c) => (c ? { ...c, muted: !track.enabled } : c));
  }, []);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCall((c) => (c ? { ...c, cameraOff: !track.enabled } : c));
  }, []);

  // ---------------- socket wiring ----------------
  useEffect(() => {
    if (!socket) return;

    function onIncoming({ callId, conversationId, kind, offer, from }) {
      // Already ringing/on this exact call (a duplicate delivery of the
      // same invite, e.g. from a brief reconnect) — ignore rather than
      // re-processing it as if it were a second call.
      if (incomingOfferRef.current?.callId === callId || call?.callId === callId) return;
      // Already on a call ourselves — let the caller know rather than
      // silently dropping their invite.
      if (call || incomingOfferRef.current) {
        socket.emit("call:decline", { callId });
        return;
      }
      incomingOfferRef.current = { callId, conversationId, kind, offer, from };
      pendingCandidatesRef.current = [];
      setCall({
        callId,
        direction: "incoming",
        status: "ringing",
        kind,
        peer: from,
        conversationId,
        localStream: null,
        remoteStream: null,
        muted: false,
        cameraOff: false,
        safetyCode: null,
      });
      startRingtone();

      if (document.hidden && Notification?.permission === "granted") {
        const n = new Notification(`Incoming ${kind === "video" ? "video" : "voice"} call`, {
          body: from.displayName,
          tag: `call-${callId}`,
          requireInteraction: true,
        });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      }
    }

    function onAnswered({ callId, answer }) {
      const pc = pcRef.current;
      if (!pc || !call || call.callId !== callId) return;
      stopRinging();
      pc.setRemoteDescription(new RTCSessionDescription(answer))
        .then(async () => {
          for (const c of pendingCandidatesRef.current) await pc.addIceCandidate(c).catch(() => {});
          pendingCandidatesRef.current = [];
          setCall((c) => (c && c.callId === callId ? { ...c, status: "connecting" } : c));
        })
        .catch((err) => logError("call:answered", err));
    }

    function onIceCandidate({ candidate }) {
      const pc = pcRef.current;
      const c = new RTCIceCandidate(candidate);
      if (pc && pc.remoteDescription) pc.addIceCandidate(c).catch(() => {});
      else pendingCandidatesRef.current.push(c);
    }

    function onDeclined() {
      showToast("Call declined");
      cleanup();
    }
    function onBusy() {
      showToast("They're on another call");
      cleanup();
    }
    function onUnavailable() {
      showToast("Couldn't reach them");
      cleanup();
    }
    function onTimeout() {
      showToast("No answer");
      cleanup();
    }
    function onEnded() {
      cleanup();
    }

    socket.on("call:incoming", onIncoming);
    socket.on("call:answered", onAnswered);
    socket.on("call:ice-candidate", onIceCandidate);
    socket.on("call:declined", onDeclined);
    socket.on("call:busy", onBusy);
    socket.on("call:unavailable", onUnavailable);
    socket.on("call:timeout", onTimeout);
    socket.on("call:ended", onEnded);

    return () => {
      socket.off("call:incoming", onIncoming);
      socket.off("call:answered", onAnswered);
      socket.off("call:ice-candidate", onIceCandidate);
      socket.off("call:declined", onDeclined);
      socket.off("call:busy", onBusy);
      socket.off("call:unavailable", onUnavailable);
      socket.off("call:timeout", onTimeout);
      socket.off("call:ended", onEnded);
    };
  }, [socket, call, cleanup, showToast]);

  return (
    <CallContext.Provider
      value={{
        call,
        startCall,
        acceptCall,
        declineCall,
        endCall,
        toggleMute,
        toggleCamera,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  return useContext(CallContext);
}
