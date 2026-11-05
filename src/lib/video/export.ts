import { FULL, toPixels, unionCrops, type Crop } from "./crop";
import { detectContent } from "./detect";
import { pickRecorderMime } from "./capture";

export type Trim = { start: number; end: number };

export type RecordingInfo = {
  duration: number;
  width: number;
  height: number;
  /** Décalage du premier horodatage du fichier (les temps de l'élément <video> partent de 0). */
  offset: number;
};

export type ExportResult = {
  blob: Blob;
  ext: "mp4" | "webm";
  method: "rapide" | "temps-reel";
};

export type ExportOptions = {
  source: Blob;
  crop: Crop;
  trim: Trim;
  info: RecordingInfo;
  onProgress: (p: number) => void;
  signal?: AbortSignal;
};

export class ExportCanceled extends Error {
  constructor() {
    super("Export annulé");
  }
}

// Chargé uniquement dans le navigateur (et jamais embarqué dans le rendu serveur)
const loadMediabunny = () =>
  import.meta.env.SSR
    ? Promise.reject(new Error("Indisponible côté serveur"))
    : import("mediabunny");
const loadAacEncoder = () =>
  import.meta.env.SSR
    ? Promise.reject(new Error("Indisponible côté serveur"))
    : import("@mediabunny/aac-encoder");

const hasWebCodecs = () =>
  typeof window !== "undefined" &&
  "VideoEncoder" in window &&
  "VideoDecoder" in window &&
  "AudioEncoder" in window;

/** Durée et dimensions de l'enregistrement (les fichiers de MediaRecorder n'ont souvent pas de durée). */
export async function probeRecording(blob: Blob): Promise<RecordingInfo> {
  if (hasWebCodecs()) {
    try {
      const mb = await loadMediabunny();
      const input = new mb.Input({
        source: new mb.BlobSource(blob),
        formats: mb.ALL_FORMATS,
      });
      const track = await input.getPrimaryVideoTrack();
      if (track) {
        const [first, end] = await Promise.all([
          input.getFirstTimestamp(),
          input.computeDuration(),
        ]);
        const offset = Math.max(0, first);
        return {
          duration: end - offset,
          width: track.displayWidth,
          height: track.displayHeight,
          offset,
        };
      }
    } catch (e) {
      console.warn("Analyse mediabunny impossible, repli sur <video>", e);
    }
  }
  return probeWithVideoElement(blob);
}

async function probeWithVideoElement(blob: Blob): Promise<RecordingInfo> {
  const url = URL.createObjectURL(blob);
  try {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "metadata";
    v.src = url;
    await once(v, "loadedmetadata");
    if (!isFinite(v.duration)) {
      // Astuce connue : les WebM de MediaRecorder annoncent une durée infinie
      v.currentTime = 1e9;
      await once(v, "durationchange", 5000).catch(() => {});
    }
    return {
      duration: isFinite(v.duration) ? v.duration : 0,
      width: v.videoWidth,
      height: v.videoHeight,
      offset: 0,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Détecte les bandes noires en analysant plusieurs images réparties sur l'extrait. */
export async function detectBlackBars(
  source: Blob,
  trim: Trim,
  info: RecordingInfo,
  video?: HTMLVideoElement | null,
): Promise<Crop | null> {
  const n = 7;
  const times = Array.from(
    { length: n },
    (_, i) => trim.start + ((i + 0.5) / n) * (trim.end - trim.start),
  );
  const boxes: Crop[] = [];
  const canvas = document.createElement("canvas");
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  const analyse = (img: CanvasImageSource, w: number, h: number) => {
    canvas.width = 320;
    canvas.height = Math.max(2, Math.round((320 * h) / w));
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const box = detectContent(
      g.getImageData(0, 0, canvas.width, canvas.height),
    );
    if (box) boxes.push(box);
  };
  let done = false;
  if (hasWebCodecs()) {
    try {
      const mb = await loadMediabunny();
      const input = new mb.Input({
        source: new mb.BlobSource(source),
        formats: mb.ALL_FORMATS,
      });
      const track = await input.getPrimaryVideoTrack();
      if (track) {
        const sink = new mb.CanvasSink(track, { width: 320, poolSize: 1 });
        for await (const wc of sink.canvasesAtTimestamps(
          times.map((t) => t + info.offset),
        )) {
          if (wc)
            analyse(
              wc.canvas as CanvasImageSource,
              wc.canvas.width,
              wc.canvas.height,
            );
        }
        done = true;
      }
    } catch (e) {
      console.warn("Détection via mediabunny impossible", e);
    }
  }
  if (!done && video && video.videoWidth)
    analyse(video, video.videoWidth, video.videoHeight);
  const union = unionCrops(boxes);
  if (!union) return null;
  // Petite marge intérieure pour éviter un liseré sombre sur les bords
  const m = 0.003;
  return {
    x: union.x + m,
    y: union.y + m,
    w: Math.max(0, union.w - 2 * m),
    h: Math.max(0, union.h - 2 * m),
  };
}

export async function exportClip(o: ExportOptions): Promise<ExportResult> {
  if (hasWebCodecs()) {
    try {
      return await exportFast(o);
    } catch (e) {
      if (e instanceof ExportCanceled || o.signal?.aborted)
        throw new ExportCanceled();
      console.warn(
        "Export rapide impossible, repli sur l'export en temps réel",
        e,
      );
    }
  }
  return exportRealtime(o);
}

/** Export par WebCodecs : bien plus rapide que le temps réel, et indépendant de l'onglet visible. */
async function exportFast(o: ExportOptions): Promise<ExportResult> {
  const mb = await loadMediabunny();
  const input = new mb.Input({
    source: new mb.BlobSource(o.source),
    formats: mb.ALL_FORMATS,
  });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("Aucune piste vidéo");
  const crop = toPixels(o.crop, track.displayWidth, track.displayHeight);

  const mp4 = await mb.canEncodeVideo("avc", {
    width: crop.width,
    height: crop.height,
  });
  let videoCodec: "avc" | "vp9" | "vp8" | "av1" = "avc";
  let audioCodec: "aac" | "opus" = "aac";
  if (mp4) {
    if (!(await mb.canEncodeAudio("aac"))) {
      // Chrome sous Linux n'a pas d'encodeur AAC : on utilise un encodeur WebAssembly
      const { registerAacEncoder } = await loadAacEncoder();
      registerAacEncoder();
    }
  } else {
    const fallback = await mb.getFirstEncodableVideoCodec(
      ["vp9", "vp8", "av1"],
      {
        width: crop.width,
        height: crop.height,
      },
    );
    if (!fallback) throw new Error("Aucun encodeur vidéo disponible");
    videoCodec = fallback as typeof videoCodec;
    audioCodec = "opus";
  }

  const output = new mb.Output({
    format: mp4
      ? new mb.Mp4OutputFormat({ fastStart: "in-memory" })
      : new mb.WebMOutputFormat(),
    target: new mb.BufferTarget(),
  });
  const conversion = await mb.Conversion.init({
    input,
    output,
    tracks: "primary",
    video: {
      codec: videoCodec,
      crop,
      frameRate: 30, // cadence constante : meilleure compatibilité (PowerPoint, TV…)
      quality: mb.QUALITY_HIGH,
      keyFrameInterval: 2,
      forceTranscode: true,
    },
    audio: { codec: audioCodec, quality: mb.QUALITY_HIGH },
    trim: {
      start: o.trim.start + o.info.offset,
      end: o.trim.end + o.info.offset,
    },
    showWarnings: false,
  });
  if (!conversion.isValid) {
    throw new Error(
      "Conversion impossible : " +
        conversion.discardedTracks.map((d) => d.reason).join(", "),
    );
  }
  conversion.onProgress = (p) => o.onProgress(p);
  const onAbort = () => conversion.cancel();
  o.signal?.addEventListener("abort", onAbort);
  try {
    await conversion.execute();
  } catch (e) {
    if (o.signal?.aborted) throw new ExportCanceled();
    throw e;
  } finally {
    o.signal?.removeEventListener("abort", onAbort);
  }
  const buffer = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
  if (!buffer) throw new Error("Fichier vide");
  o.onProgress(1);
  return {
    blob: new Blob([buffer], { type: mp4 ? "video/mp4" : "video/webm" }),
    ext: mp4 ? "mp4" : "webm",
    method: "rapide",
  };
}

/** Repli pour les navigateurs sans WebCodecs : relecture de l'extrait dans un canvas, en temps réel. */
async function exportRealtime(o: ExportOptions): Promise<ExportResult> {
  const url = URL.createObjectURL(o.source);
  const v = document.createElement("video");
  v.src = url;
  v.playsInline = true;
  const ctx = new AudioContext();
  try {
    await once(v, "loadedmetadata");
    const { left, top, width, height } = toPixels(
      o.crop ?? FULL,
      v.videoWidth,
      v.videoHeight,
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d")!;
    await ctx.resume().catch(() => {});
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaElementSource(v).connect(dest); // le son va dans le fichier, pas dans les haut-parleurs

    v.currentTime = o.trim.start;
    await once(v, "seeked");
    g.drawImage(v, left, top, width, height, 0, 0, width, height);

    const stream = new MediaStream([
      ...canvas.captureStream(30).getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
    const mime = pickRecorderMime();
    const rec = new MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond: 8_000_000,
    });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));

    const span = Math.max(0.1, o.trim.end - o.trim.start);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      v.pause();
      if (rec.state !== "inactive") rec.stop();
    };
    const tick = () => {
      if (finished) return;
      g.drawImage(v, left, top, width, height, 0, 0, width, height);
      o.onProgress(Math.min(1, (v.currentTime - o.trim.start) / span));
      if (v.currentTime >= o.trim.end || v.ended) finish();
    };
    // requestVideoFrameCallback quand il existe ; sinon un minuteur (pas de requestAnimationFrame,
    // qui s'arrête quand l'onglet est en arrière-plan).
    const rvfc = (
      v as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      }
    ).requestVideoFrameCallback;
    if (rvfc) {
      const loop = () => {
        tick();
        if (!finished) rvfc.call(v, loop);
      };
      rvfc.call(v, loop);
    }
    const timer = window.setInterval(tick, 1000 / 30);
    v.addEventListener("ended", finish);
    const onAbort = () => finish();
    o.signal?.addEventListener("abort", onAbort);

    rec.start(1000);
    await v.play();
    await stopped;
    clearInterval(timer);
    o.signal?.removeEventListener("abort", onAbort);
    if (o.signal?.aborted) throw new ExportCanceled();
    o.onProgress(1);
    const type = rec.mimeType || mime || "video/webm";
    return {
      blob: new Blob(chunks, { type }),
      ext: type.includes("mp4") ? "mp4" : "webm",
      method: "temps-reel",
    };
  } finally {
    ctx.close().catch(() => {});
    v.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}

function once(
  target: EventTarget,
  event: string,
  timeoutMs = 15000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Délai dépassé : ${event}`)),
      timeoutMs,
    );
    target.addEventListener(
      event,
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
