/**
 * Unified, WhatsApp-style client-side media compressor.
 *
 * - Images (jpeg/png/webp/etc, excluding gif): re-encoded on a <canvas>,
 *   iteratively lowering quality and then dimensions until the result is
 *   under IMAGE_TARGET_BYTES (default 1MB) or we hit a quality/size floor.
 *   Re-drawing onto a canvas also strips all EXIF/metadata for free —
 *   there's nothing left to "clean up" separately.
 * - Animated GIFs: re-encoded through ffmpeg.wasm (palette-based, so
 *   colors stay clean) with reduced fps/scale, targeting the same 1MB
 *   ceiling where achievable.
 * - Video: transcoded through ffmpeg.wasm with settings chosen adaptively
 *   from the *source* file (see pickVideoPreset) rather than one fixed
 *   quality knob — a phone-shot 200MB clip gets downscaled hard and
 *   encoded on the fastest preset so it doesn't take minutes, while a
 *   small, already-reasonable clip gets a much lighter touch.
 *
 * ffmpeg.wasm is loaded lazily (only the first time a gif/video actually
 * needs it) and its core files are bundled from node_modules rather than
 * fetched from a CDN. When the page is cross-origin isolated (COOP/COEP
 * headers set — see vite.config.js and the README for what a production
 * host needs to add) it transparently upgrades to the multi-threaded
 * core, which is dramatically faster; otherwise it falls back to the
 * single-threaded core automatically. Either way, video encoding is the
 * one part of this pipeline that's fundamentally CPU-bound, so "faster"
 * here means "as fast as a wasm encoder reasonably gets" — not instant.
 */

import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";

export const IMAGE_TARGET_BYTES = 1024 * 1024; // 1MB
export const IMAGE_SKIP_BELOW_BYTES = 220 * 1024; // already small enough, don't bother
export const GIF_TARGET_BYTES = 1024 * 1024; // 1MB
export const GIF_SKIP_BELOW_BYTES = 300 * 1024;

let ffmpegPromise = null;

// NOTE: an earlier version of this file tried to opportunistically load
// the multi-threaded @ffmpeg/core-mt when the page was cross-origin
// isolated, for a speed boost. In practice that core's internal pthread
// worker script loading is fragile across bundlers/dev-servers (it
// crash-loops with "Cannot use import statement outside a module"
// instead of failing gracefully), which broke sending entirely rather
// than just falling back to single-threaded like it was supposed to. It
// was pulled back out — single-threaded is slower but actually reliable,
// and the adaptive presets below (pickVideoPreset) do most of the real
// speed work anyway.
async function getFFmpeg() {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({ coreURL, wasmURL });
      return ffmpeg;
    })();
  }
  return ffmpegPromise;
}

function fileExt(name = "") {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

function replaceExt(name, ext) {
  return name.replace(/\.[a-z0-9]+$/i, "") + "." + ext;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

async function fileToArrayBuffer(file) {
  return file.arrayBuffer();
}

// ---------------- images ----------------

function loadImageBitmap(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ img, url });
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Iteratively lowers JPEG/WebP quality, then physical dimensions, until
 * the encoded blob is under `targetBytes` or we run out of steps to try.
 * Always keeps whichever attempt came out smallest, so it never makes a
 * file *bigger* than the original.
 */
export async function compressImageFile(file, { targetBytes = IMAGE_TARGET_BYTES, onProgress } = {}) {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") {
    return file;
  }
  if (file.size < IMAGE_SKIP_BELOW_BYTES) return file;

  onProgress?.(0.05);
  const { img, url } = await loadImageBitmap(file);
  try {
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;
    const outputType = file.type === "image/png" && file.size < targetBytes * 2 ? "image/png" : "image/jpeg";

    const qualitySteps = [0.85, 0.72, 0.6, 0.48, 0.38];
    const scaleSteps = [1, 0.85, 0.7, 0.55, 0.4];

    let best = null;
    let step = 0;
    const totalSteps = qualitySteps.length * scaleSteps.length;

    for (const scale of scaleSteps) {
      const w = Math.max(64, Math.round(width * scale));
      const h = Math.max(64, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);

      for (const quality of qualitySteps) {
        step += 1;
        onProgress?.(Math.min(0.95, step / totalSteps));
        const blob = await canvasToBlob(canvas, outputType, outputType === "image/png" ? undefined : quality);
        if (!blob) continue;
        if (!best || blob.size < best.size) best = blob;
        if (blob.size <= targetBytes) {
          onProgress?.(1);
          return new File([blob], replaceExt(file.name, outputType === "image/png" ? "png" : "jpg"), {
            type: blob.type,
            lastModified: Date.now(),
          });
        }
        if (outputType === "image/png") break; // no quality knob for png, only scale matters
      }
    }

    onProgress?.(1);
    if (best && best.size < file.size) {
      return new File([best], replaceExt(file.name, outputType === "image/png" ? "png" : "jpg"), {
        type: best.type,
        lastModified: Date.now(),
      });
    }
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------- gifs ----------------

export async function compressGifFile(file, { targetBytes = GIF_TARGET_BYTES, onProgress } = {}) {
  if (file.size < GIF_SKIP_BELOW_BYTES) return file;

  // Bigger source GIFs get a more aggressive first attempt so we're not
  // wasting a full encode pass on settings we already know won't be
  // enough.
  const mb = file.size / (1024 * 1024);
  const attempts =
    mb > 15
      ? [{ fps: 10, width: 320 }, { fps: 8, width: 240 }]
      : mb > 5
      ? [{ fps: 12, width: 400 }, { fps: 10, width: 300 }]
      : [{ fps: 15, width: 480 }, { fps: 12, width: 360 }];

  const ffmpeg = await getFFmpeg();
  const tag = uid();
  const inputName = `in-${tag}.gif`;
  const outputName = `out-${tag}.gif`;
  const data = new Uint8Array(await fileToArrayBuffer(file));
  await ffmpeg.writeFile(inputName, data);

  const onFfmpegProgress = ({ progress }) => onProgress?.(Math.min(0.98, Math.max(0, progress)));
  ffmpeg.on("progress", onFfmpegProgress);

  let resultBlob = null;
  try {
    for (const attempt of attempts) {
      const filter = `fps=${attempt.fps},scale=${attempt.width}:-1:flags=lanczos`;
      await ffmpeg.exec([
        "-i",
        inputName,
        "-vf",
        `${filter},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
        "-loop",
        "0",
        outputName,
      ]);
      const out = await ffmpeg.readFile(outputName);
      const blob = new Blob([out.buffer], { type: "image/gif" });
      if (!resultBlob || blob.size < resultBlob.size) resultBlob = blob;
      await ffmpeg.deleteFile(outputName).catch(() => {});
      if (blob.size <= targetBytes) break;
    }
  } finally {
    ffmpeg.off("progress", onFfmpegProgress);
    await ffmpeg.deleteFile(inputName).catch(() => {});
  }

  onProgress?.(1);
  if (resultBlob && resultBlob.size < file.size) {
    return new File([resultBlob], replaceExt(file.name, "gif"), { type: "image/gif", lastModified: Date.now() });
  }
  return file;
}

// ---------------- video ----------------

/**
 * Adaptive preset: rather than one fixed CRF/scale for every video, pick
 * settings based on how big the *source* file already is. A huge source
 * is almost certainly high-resolution/high-bitrate footage that can take
 * a hard cut without looking noticeably worse in a chat bubble; a small
 * source is probably already modest, so it gets a lighter touch. This is
 * a single-pass heuristic rather than a target-size feedback loop (like
 * the image compressor uses) because re-encoding video is expensive —
 * doing it 3-4 times to hit an exact byte target would make the "keep it
 * fast" requirement impossible to meet.
 */
function pickVideoPreset(file) {
  const mb = file.size / (1024 * 1024);
  if (mb > 150) return { maxLongEdge: 640, crf: 32, preset: "ultrafast", audioBitrate: "96k" };
  if (mb > 60) return { maxLongEdge: 854, crf: 30, preset: "ultrafast", audioBitrate: "112k" };
  if (mb > 20) return { maxLongEdge: 960, crf: 28, preset: "superfast", audioBitrate: "128k" };
  return { maxLongEdge: 1280, crf: 25, preset: "veryfast", audioBitrate: "128k" };
}

export async function compressVideoFile(file, { onProgress } = {}) {
  const { maxLongEdge, crf, preset, audioBitrate } = pickVideoPreset(file);

  const ffmpeg = await getFFmpeg();
  const tag = uid();
  const ext = fileExt(file.name) || "mp4";
  const inputName = `in-${tag}.${ext}`;
  const outputName = `out-${tag}.mp4`;
  const data = new Uint8Array(await fileToArrayBuffer(file));
  await ffmpeg.writeFile(inputName, data);

  const onFfmpegProgress = ({ progress }) => {
    // ffmpeg sometimes reports progress slightly over 1 near the end
    onProgress?.(Math.min(0.98, Math.max(0, progress)));
  };
  ffmpeg.on("progress", onFfmpegProgress);

  try {
    await ffmpeg.exec([
      "-i",
      inputName,
      "-vf",
      `scale='min(${maxLongEdge},iw)':'min(${maxLongEdge},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      String(crf),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      audioBitrate,
      "-movflags",
      "+faststart",
      outputName,
    ]);
    const out = await ffmpeg.readFile(outputName);
    const blob = new Blob([out.buffer], { type: "video/mp4" });
    onProgress?.(1);

    if (blob.size < file.size) {
      return new File([blob], replaceExt(file.name, "mp4"), { type: "video/mp4", lastModified: Date.now() });
    }
    return file; // rare (already tiny/efficient source) — don't make it worse
  } finally {
    ffmpeg.off("progress", onFfmpegProgress);
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}

// ---------------- dispatcher ----------------

export function needsCompression(file) {
  if (!file || !file.type) return false;
  if (file.type === "image/gif") return file.size >= GIF_SKIP_BELOW_BYTES;
  if (file.type.startsWith("image/") && file.type !== "image/svg+xml") return file.size >= IMAGE_SKIP_BELOW_BYTES;
  if (file.type.startsWith("video/")) return true;
  return false;
}

/**
 * Single entry point used by the composer/status editor. `onProgress`
 * receives a 0..1 fraction. Files that don't need compression (audio,
 * documents, small images, svg) resolve immediately with the original
 * file.
 */
export async function compressMedia(file, { onProgress } = {}) {
  try {
    if (file.type === "image/gif") return await compressGifFile(file, { onProgress });
    if (file.type.startsWith("image/")) return await compressImageFile(file, { onProgress });
    if (file.type.startsWith("video/")) return await compressVideoFile(file, { onProgress });
  } catch (err) {
    console.error("Media compression failed, sending original file instead:", err?.message || err);
    onProgress?.(1);
    return file;
  }
  onProgress?.(1);
  return file;
}

/**
 * Compresses a batch of {id, blob} items concurrently where it's safe to
 * (images, each on their own independent <canvas>) while keeping
 * video/GIF jobs queued one-at-a-time — ffmpeg.wasm runs as a single
 * shared instance, so two overlapping exec() calls would stomp on each
 * other's virtual filesystem. `onItemProgress(id, 0..1)` is called
 * throughout so the caller can reflect per-attachment progress (e.g. on
 * each pending message bubble) without blocking the whole send on the
 * slowest item.
 */
export async function compressItems(items, onItemProgress) {
  const results = new Array(items.length);
  const imageIdx = [];
  const heavyIdx = []; // gif/video — share the ffmpeg singleton, must be sequential

  items.forEach((item, i) => {
    if (!needsCompression(item.blob)) {
      results[i] = item.blob;
      onItemProgress?.(item.id, 1);
      return;
    }
    if (item.blob.type.startsWith("image/") && item.blob.type !== "image/gif") imageIdx.push(i);
    else heavyIdx.push(i);
  });

  await Promise.all([
    ...imageIdx.map(async (i) => {
      results[i] = await compressMedia(items[i].blob, { onProgress: (p) => onItemProgress?.(items[i].id, p) });
    }),
    (async () => {
      for (const i of heavyIdx) {
        results[i] = await compressMedia(items[i].blob, { onProgress: (p) => onItemProgress?.(items[i].id, p) });
      }
    })(),
  ]);

  return results;
}
