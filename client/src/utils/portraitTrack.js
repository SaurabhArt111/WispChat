// ---------------------------------------------------------------------------
// Many phones hand the browser a LANDSCAPE camera frame even when the phone is
// held upright (a wide crop of the real scene). Sent as-is, the other side
// (e.g. a computer) gets a wide picture with the person squeezed in the middle.
//
// toPortraitTrack() centre-crops the camera to a true 9:16 frame on a canvas
// and returns that as the track to send, so a phone held upright always sends
// a vertical picture — and its own self-view is vertical too.
// ---------------------------------------------------------------------------
import { getDeviceInfo } from "./device";

export function toPortraitTrack(srcTrack, { w = 540, h = 960, fps = 24, facing } = {}) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([srcTrack]);
  video.play().catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  const target = w / h;

  const draw = () => {
    const sw = video.videoWidth;
    const sh = video.videoHeight;
    if (!sw || !sh || video.readyState < 2) return;
    let cw = sh * target; // widest 9:16 slice of the source
    let ch = sh;
    if (cw > sw) {
      cw = sw;
      ch = sw / target;
    }
    ctx.drawImage(video, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
  };
  // setInterval (not requestAnimationFrame) so it keeps running when the tab is in the background.
  const timer = setInterval(draw, Math.round(1000 / fps));

  const out = canvas.captureStream(fps).getVideoTracks()[0];
  out.__facing = facing || srcTrack.getSettings?.().facingMode || "user";
  const nativeStop = out.stop.bind(out);
  out.stop = () => {
    clearInterval(timer);
    try { srcTrack.stop(); } catch { /* ignore */ }
    video.srcObject = null;
    nativeStop();
  };
  return out;
}

/**
 * If this is a phone held upright, make sure the video it sends is portrait.
 * Returns the same stream with its video track swapped when needed.
 */
export function normalizeVideoForDevice(stream, facing) {
  try {
    const dev = getDeviceInfo();
    if (dev.type !== "mobile" || dev.orientation !== "portrait") return stream;
    const track = stream.getVideoTracks()[0];
    if (!track) return stream;
    const s = track.getSettings?.() || {};
    const alreadyPortrait = s.width && s.height && s.height > s.width;
    if (alreadyPortrait) {
      track.__facing = facing || s.facingMode || "user";
      return stream;
    }
    const portrait = toPortraitTrack(track, { facing });
    stream.removeTrack(track);
    stream.addTrack(portrait);
  } catch {
    /* fall back to the raw camera */
  }
  return stream;
}
