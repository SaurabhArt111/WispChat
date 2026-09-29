import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import { useSocket } from "./SocketContext";
import { useToast } from "./ToastContext";
import { logError } from "../utils/logger";
import client from "../api/client";

const CallContext = createContext(null);

// Fallback STUN list used only if /api/calls/ice can't be reached. The real
// list comes from the server (see server/src/routes/call.routes.js) and
// includes a TURN relay when one is configured — without TURN, callers on
// strict NATs / mobile data / corporate networks connect but get no
// audio or video.
const FALLBACK_ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
];

let iceCache = { at: 0, servers: FALLBACK_ICE_SERVERS };
async function loadIceServers() {
  // TURN credentials are short-lived; re-fetch if the cached copy is old.
  if (Date.now() - iceCache.at < 30 * 60 * 1000) return iceCache.servers;
  try {
    const res = await client.get("/calls/ice", { timeout: 4000 });
    if (res.data?.iceServers?.length) iceCache = { at: Date.now(), servers: res.data.iceServers };
  } catch {
    /* keep whatever we had */
  }
  return iceCache.servers;
}

// Good defaults for calls: echo cancellation / noise suppression on, a
// resolution that a phone can actually encode in real time (asking for a
// hard 1280x720 made weaker devices choke or fail getUserMedia), and
// `ideal` so a camera that can't do it falls back instead of erroring.
const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const VIDEO_CONSTRAINTS = {
  facingMode: "user",
  width: { ideal: 960, max: 1280 },
  height: { ideal: 540, max: 720 },
  frameRate: { ideal: 24, max: 30 },
};

async function getLocalMedia(kind) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: AUDIO_CONSTRAINTS,
      video: kind === "video" ? VIDEO_CONSTRAINTS : false,
    });
  } catch (err) {
    // Camera missing/busy on a video call: fall back to audio-only rather than failing the call.
    if (kind === "video" && err?.name !== "NotAllowedError") {
      const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
      audioOnly.__noCamera = true;
      return audioOnly;
    }
    throw err;
  }
}

// Cap outgoing video bitrate so a call doesn't saturate a weak uplink
// (uncapped, browsers often overshoot and everything stutters).
function tuneSenders(pc) {
  pc.getSenders().forEach((sender) => {
    if (!sender.track || sender.track.kind !== "video") return;
    try {
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = 900_000;
      params.encodings[0].maxFramerate = 30;
      params.degradationPreference = "maintain-framerate";
      sender.setParameters(params).catch(() => {});
    } catch {
      /* not supported everywhere */
    }
  });
}

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

  // `call` drives the UI; `callRef` mirrors it so socket/WebRTC callbacks
  // always see the *current* call instead of a stale closure (the old
  // version re-subscribed every socket handler on each state change and
  // could act on an outdated `call`).
  const [call, setCallState] = useState(null);
  const callRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pendingCandidatesRef = useRef([]); // remote candidates that arrived before we could apply them
  const iceOutboxRef = useRef({ ready: false, list: [] }); // our candidates held until the invite is out
  const ringIntervalRef = useRef(null);
  const ringTimeoutRef = useRef(null);
  const disconnectTimerRef = useRef(null);
  const failTimerRef = useRef(null);
  const incomingOfferRef = useRef(null); // { callId, conversationId, kind, offer, from }
  const startingRef = useRef(false);
  const makingOfferRef = useRef(false);
  const negotiationReadyRef = useRef(false);
  const wakeLockRef = useRef(null);

  const patchCall = useCallback((patch, onlyCallId) => {
    const cur = callRef.current;
    if (!cur || (onlyCallId && cur.callId !== onlyCallId)) return;
    const next = typeof patch === "function" ? patch(cur) : { ...cur, ...patch };
    callRef.current = next;
    setCallState(next);
  }, []);
  const replaceCall = useCallback((next) => {
    callRef.current = next;
    setCallState(next);
  }, []);

  useEffect(() => {
    // `Notification` doesn't exist at all on iOS Safari (outside installed
    // PWAs) — referencing it bare threw a ReferenceError there.
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Resume (or lazily create) the shared ring AudioContext on first interaction.
  useEffect(() => {
    function resumeOnce() {
      getAudioCtx()?.resume().catch(() => {});
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

  async function acquireWakeLock() {
    try {
      if ("wakeLock" in navigator) wakeLockRef.current = await navigator.wakeLock.request("screen");
    } catch {
      /* not critical */
    }
  }
  function releaseWakeLock() {
    try {
      wakeLockRef.current?.release();
    } catch {
      /* ignore */
    }
    wakeLockRef.current = null;
  }

  const cleanup = useCallback(() => {
    clearInterval(ringIntervalRef.current);
    clearTimeout(ringTimeoutRef.current);
    clearTimeout(disconnectTimerRef.current);
    clearTimeout(failTimerRef.current);
    ringIntervalRef.current = null;
    ringTimeoutRef.current = null;
    disconnectTimerRef.current = null;
    failTimerRef.current = null;
    pendingCandidatesRef.current = [];
    iceOutboxRef.current = { ready: false, list: [] };
    incomingOfferRef.current = null;
    startingRef.current = false;
    makingOfferRef.current = false;
    negotiationReadyRef.current = false;
    releaseWakeLock();
    if (pcRef.current) {
      const pc = pcRef.current;
      pcRef.current = null;
      pc.onicecandidate = pc.ontrack = pc.onconnectionstatechange = pc.onnegotiationneeded = null;
      try {
        pc.close();
      } catch {
        /* already closed */
      }
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    remoteStreamRef.current = null;
    callRef.current = null;
    setCallState(null);
  }, []);

  function startRingback() {
    stopRinging();
    playTone([440, 480], 1400);
    ringIntervalRef.current = setInterval(() => playTone([440, 480], 1400), 3500);
  }
  function startRingtone() {
    stopRinging();
    playTone([523, 659], 900);
    ringIntervalRef.current = setInterval(() => playTone([523, 659], 900), 2000);
  }
  function stopRinging() {
    clearInterval(ringIntervalRef.current);
    ringIntervalRef.current = null;
  }

  // ---- ICE restart / renegotiation ----
  // The original caller is the "impolite" peer and the callee the "polite"
  // one (WebRTC "perfect negotiation"), so if both sides try to restart at
  // once the collision resolves itself instead of deadlocking the call.
  const restartIce = useCallback(() => {
    const pc = pcRef.current;
    if (!pc || pc.signalingState === "closed") return;
    try {
      if (pc.restartIce) pc.restartIce(); // fires negotiationneeded
      else negotiationReadyRef.current && pc.onnegotiationneeded?.();
    } catch (err) {
      logError("call:restartIce", err);
    }
  }, []);

  const buildPeerConnection = useCallback(
    async (callId, otherUserId) => {
      const iceServers = await loadIceServers();
      const pc = new RTCPeerConnection({ iceServers, bundlePolicy: "max-bundle", iceCandidatePoolSize: 4 });

      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        const outbox = iceOutboxRef.current;
        if (!outbox.ready) {
          outbox.list.push(e.candidate);
          return;
        }
        socket?.emit("call:ice-candidate", { callId, candidate: e.candidate, to: otherUserId });
      };

      pc.ontrack = (e) => {
        // Collect every incoming track into one stream we control. Relying
        // on `e.streams[0]` alone broke whenever the browser delivered a
        // track without an associated stream.
        const stream = e.streams?.[0] || remoteStreamRef.current || new MediaStream();
        if (!e.streams?.[0] && !stream.getTracks().includes(e.track)) stream.addTrack(e.track);
        remoteStreamRef.current = stream;
        patchCall((c) => ({ ...c, remoteStream: stream, remoteTracksAt: Date.now() }), callId);
        e.track.onunmute = () => patchCall((c) => ({ ...c, remoteTracksAt: Date.now() }), callId);
      };

      pc.onnegotiationneeded = async () => {
        if (!negotiationReadyRef.current) return; // the first offer/answer is driven manually
        try {
          makingOfferRef.current = true;
          await pc.setLocalDescription(); // implicit offer (with iceRestart if restartIce() was called)
          socket?.emit("call:signal", { callId, description: pc.localDescription });
        } catch (err) {
          logError("call:negotiation", err);
        } finally {
          makingOfferRef.current = false;
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === "connected") {
          clearTimeout(disconnectTimerRef.current);
          clearTimeout(failTimerRef.current);
          negotiationReadyRef.current = true;
          tuneSenders(pc);
          patchCall((c) => {
            computeSafetyCode(pc).then((safetyCode) => patchCall({ safetyCode }, callId));
            return { ...c, status: "connected", connectedAt: c.connectedAt || Date.now(), peerUnstable: false };
          }, callId);
        } else if (state === "disconnected") {
          // Often heals by itself within a couple of seconds; only react if it doesn't.
          clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = setTimeout(() => {
            if (pcRef.current !== pc || pc.connectionState === "connected") return;
            patchCall({ status: "reconnecting" }, callId);
            restartIce();
          }, 3000);
          clearTimeout(failTimerRef.current);
          failTimerRef.current = setTimeout(() => {
            if (pcRef.current === pc && pc.connectionState !== "connected") {
              showToast("Call connection lost", "danger");
              socket?.emit("call:end", { callId });
              cleanup();
            }
          }, 25000);
        } else if (state === "failed") {
          patchCall({ status: "reconnecting" }, callId);
          restartIce();
          clearTimeout(failTimerRef.current);
          failTimerRef.current = setTimeout(() => {
            if (pcRef.current === pc && pc.connectionState !== "connected") {
              showToast("Call connection failed — check your network", "danger");
              socket?.emit("call:end", { callId });
              cleanup();
            }
          }, 20000);
        }
      };

      return pc;
    },
    [socket, patchCall, restartIce, cleanup, showToast]
  );

  const flushRemoteCandidates = useCallback(async (pc) => {
    const list = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const c of list) await pc.addIceCandidate(c).catch(() => {});
  }, []);

  const flushOutbox = useCallback(
    (callId, otherUserId) => {
      const outbox = iceOutboxRef.current;
      outbox.ready = true;
      outbox.list.forEach((candidate) => socket?.emit("call:ice-candidate", { callId, candidate, to: otherUserId }));
      outbox.list = [];
    },
    [socket]
  );

  const startCall = useCallback(
    async (conversation, kind) => {
      if (callRef.current || startingRef.current) return;
      if (!socket?.connected) {
        showToast("You're offline — reconnecting. Try again in a moment.", "danger");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
        showToast("Calls need a modern browser over HTTPS (or localhost).", "danger");
        return;
      }
      startingRef.current = true;
      const other = conversation.participants.find((p) => p._id !== user._id);
      if (!other) {
        startingRef.current = false;
        return;
      }

      const callId = uid();
      try {
        const localStream = await getLocalMedia(kind);
        localStreamRef.current = localStream;
        const effectiveKind = kind === "video" && localStream.getVideoTracks().length ? "video" : "audio";
        if (localStream.__noCamera) showToast("No camera available — starting as a voice call");

        const pc = await buildPeerConnection(callId, other._id);
        pcRef.current = pc;
        iceOutboxRef.current = { ready: false, list: [] };
        localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

        replaceCall({
          callId,
          direction: "outgoing",
          status: "ringing",
          kind: effectiveKind,
          peer: other,
          conversationId: conversation._id,
          localStream,
          remoteStream: null,
          muted: false,
          cameraOff: false,
          remoteMuted: false,
          remoteCameraOff: false,
          peerUnstable: false,
          safetyCode: null,
          deliveredRinging: false,
        });
        startingRef.current = false;
        startRingback();
        acquireWakeLock();

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("call:invite", {
          callId,
          calleeId: other._id,
          conversationId: conversation._id,
          kind: effectiveKind,
          offer: pc.localDescription,
        });
        // The invite is on its way — now it's safe to send candidates.
        flushOutbox(callId, other._id);

        ringTimeoutRef.current = setTimeout(() => {
          if (callRef.current?.callId === callId && callRef.current.status === "ringing") {
            showToast("No answer");
            socket.emit("call:decline", { callId });
            cleanup();
          }
        }, RING_TIMEOUT_MS + 2000);
      } catch (err) {
        logError("call:start", err);
        showToast(
          err?.name === "NotAllowedError"
            ? "Camera/microphone permission was denied"
            : err?.name === "NotFoundError"
            ? "No microphone found on this device"
            : "Couldn't start the call — check your camera/microphone",
          "danger"
        );
        cleanup();
      }
    },
    [user, buildPeerConnection, socket, showToast, cleanup, replaceCall, flushOutbox]
  );

  const acceptCall = useCallback(async () => {
    const pending = incomingOfferRef.current;
    if (!pending) return;
    stopRinging();
    patchCall({ status: "connecting" }, pending.callId);
    try {
      const localStream = await getLocalMedia(pending.kind);
      localStreamRef.current = localStream;
      if (localStream.__noCamera) showToast("No camera available — joining with audio only");

      const pc = await buildPeerConnection(pending.callId, pending.from._id);
      pcRef.current = pc;
      // Callee's candidates can go out straight away: the call already exists on the server.
      iceOutboxRef.current = { ready: true, list: [] };
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

      await pc.setRemoteDescription(new RTCSessionDescription(pending.offer));
      await flushRemoteCandidates(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket?.emit("call:answer", { callId: pending.callId, answer: pc.localDescription });

      patchCall({ status: "connecting", localStream }, pending.callId);
      incomingOfferRef.current = null;
      acquireWakeLock();
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
  }, [buildPeerConnection, socket, showToast, cleanup, patchCall, flushRemoteCandidates]);

  const declineCall = useCallback(() => {
    const pending = incomingOfferRef.current;
    const cur = callRef.current;
    if (pending) socket?.emit("call:decline", { callId: pending.callId });
    else if (cur) socket?.emit("call:decline", { callId: cur.callId });
    cleanup();
  }, [socket, cleanup]);

  const endCall = useCallback(() => {
    const cur = callRef.current;
    if (cur) socket?.emit("call:end", { callId: cur.callId });
    cleanup();
  }, [socket, cleanup]);

  const announceMediaState = useCallback(
    (muted, cameraOff) => {
      const cur = callRef.current;
      if (cur) socket?.emit("call:media-state", { callId: cur.callId, muted, cameraOff });
    },
    [socket]
  );

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    patchCall({ muted: !track.enabled });
    announceMediaState(!track.enabled, callRef.current?.cameraOff);
  }, [patchCall, announceMediaState]);

  const toggleCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    patchCall({ cameraOff: !track.enabled });
    announceMediaState(callRef.current?.muted, !track.enabled);
  }, [patchCall, announceMediaState]);

  // Front/back camera switch on phones. Swaps the outgoing video track in
  // place (replaceTrack) so no renegotiation or reconnect is needed.
  const flipCamera = useCallback(async () => {
    const pc = pcRef.current;
    const stream = localStreamRef.current;
    const oldTrack = stream?.getVideoTracks()[0];
    if (!pc || !stream || !oldTrack) return;
    const facing = oldTrack.getSettings?.().facingMode === "environment" ? "user" : "environment";
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({
        video: { ...VIDEO_CONSTRAINTS, facingMode: { exact: facing } },
      });
      const newTrack = fresh.getVideoTracks()[0];
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      await sender?.replaceTrack(newTrack);
      stream.removeTrack(oldTrack);
      oldTrack.stop();
      stream.addTrack(newTrack);
      newTrack.enabled = !callRef.current?.cameraOff;
      patchCall({ localStream: new MediaStream(stream.getTracks()), mirrored: facing === "user" });
    } catch {
      showToast("Couldn't switch camera on this device");
    }
  }, [patchCall, showToast]);

  // ---------------- socket wiring ----------------
  // Handlers read `callRef` so this effect only re-runs when the socket
  // itself changes.
  useEffect(() => {
    if (!socket) return;

    function onIncoming({ callId, conversationId, kind, offer, from }) {
      if (incomingOfferRef.current?.callId === callId || callRef.current?.callId === callId) return;
      if (callRef.current || incomingOfferRef.current) {
        socket.emit("call:decline", { callId });
        return;
      }
      incomingOfferRef.current = { callId, conversationId, kind, offer, from };
      pendingCandidatesRef.current = [];
      replaceCall({
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
        remoteMuted: false,
        remoteCameraOff: false,
        peerUnstable: false,
        safetyCode: null,
      });
      startRingtone();

      if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          const n = new Notification(`Incoming ${kind === "video" ? "video" : "voice"} call`, {
            body: from.displayName,
            tag: `call-${callId}`,
            requireInteraction: true,
            icon: "/icons/icon-192.png",
          });
          n.onclick = () => {
            window.focus();
            n.close();
          };
        } catch {
          /* some browsers only allow notifications from a service worker */
        }
      }
    }

    function onRinging({ callId }) {
      patchCall({ deliveredRinging: true }, callId);
    }

    async function onAnswered({ callId, answer }) {
      const pc = pcRef.current;
      const cur = callRef.current;
      if (!pc || !cur || cur.callId !== callId) return;
      stopRinging();
      clearTimeout(ringTimeoutRef.current);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        await flushRemoteCandidates(pc);
        patchCall({ status: "connecting" }, callId);
      } catch (err) {
        logError("call:answered", err);
      }
    }

    function onIceCandidate({ callId, candidate }) {
      const cur = callRef.current;
      if (!cur || cur.callId !== callId || !candidate) return;
      const pc = pcRef.current;
      const c = new RTCIceCandidate(candidate);
      if (pc && pc.remoteDescription) pc.addIceCandidate(c).catch(() => {});
      else pendingCandidatesRef.current.push(c);
    }

    // Renegotiation from the other side (ICE restart etc.).
    async function onSignal({ callId, description }) {
      const pc = pcRef.current;
      const cur = callRef.current;
      if (!pc || !cur || cur.callId !== callId || !description) return;
      const polite = cur.direction === "incoming";
      try {
        const collision = description.type === "offer" && (makingOfferRef.current || pc.signalingState !== "stable");
        if (!polite && collision) return; // impolite peer ignores the colliding offer
        await pc.setRemoteDescription(description); // polite peer rolls back implicitly
        if (description.type === "offer") {
          await pc.setLocalDescription();
          socket.emit("call:signal", { callId, description: pc.localDescription });
        }
      } catch (err) {
        logError("call:signal", err);
      }
    }

    function onMediaState({ callId, muted, cameraOff }) {
      patchCall({ remoteMuted: !!muted, remoteCameraOff: !!cameraOff }, callId);
    }

    const end = (message, tone) => () => {
      if (message && callRef.current) showToast(message, tone);
      cleanup();
    };
    const onDeclined = end("Call declined");
    const onBusy = end("They're on another call");
    const onUnavailable = end("Couldn't reach them — they appear to be offline");
    const onTimeout = end("No answer");
    const onEnded = ({ callId, reason } = {}) => {
      if (callId && callRef.current && callRef.current.callId !== callId) return;
      if (reason === "disconnected" && callRef.current) showToast("The other person lost connection");
      cleanup();
    };
    // Answered / declined on another of my devices.
    const onHandledElsewhere = ({ callId }) => {
      const cur = callRef.current;
      if (cur && cur.callId === callId && cur.direction === "incoming" && cur.status === "ringing") cleanup();
    };
    const onPeerUnstable = ({ callId }) => patchCall({ peerUnstable: true }, callId);
    const onPeerReconnected = ({ callId }) => {
      patchCall({ peerUnstable: false }, callId);
      restartIce();
    };

    // Our own socket dropped and came back mid-call: nudge ICE so media recovers too.
    function onSocketReconnect() {
      const cur = callRef.current;
      if (cur && cur.status !== "ringing" && pcRef.current?.connectionState !== "connected") restartIce();
    }

    const handlers = {
      "call:incoming": onIncoming,
      "call:ringing": onRinging,
      "call:answered": onAnswered,
      "call:ice-candidate": onIceCandidate,
      "call:signal": onSignal,
      "call:media-state": onMediaState,
      "call:declined": onDeclined,
      "call:busy": onBusy,
      "call:unavailable": onUnavailable,
      "call:timeout": onTimeout,
      "call:ended": onEnded,
      "call:handled-elsewhere": onHandledElsewhere,
      "call:peer-unstable": onPeerUnstable,
      "call:peer-reconnected": onPeerReconnected,
      connect: onSocketReconnect,
    };
    Object.entries(handlers).forEach(([evt, fn]) => socket.on(evt, fn));

    const onOnline = () => {
      const cur = callRef.current;
      if (cur && cur.status !== "ringing" && pcRef.current?.connectionState !== "connected") restartIce();
    };
    window.addEventListener("online", onOnline);

    return () => {
      Object.entries(handlers).forEach(([evt, fn]) => socket.off(evt, fn));
      window.removeEventListener("online", onOnline);
    };
  }, [socket, cleanup, showToast, patchCall, replaceCall, restartIce, flushRemoteCandidates]);

  // Leaving the page mid-call shouldn't leave the other person hanging.
  useEffect(() => {
    const onUnload = () => {
      const cur = callRef.current;
      if (cur) socket?.emit("call:end", { callId: cur.callId });
    };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, [socket]);

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
        flipCamera,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  return useContext(CallContext);
}
