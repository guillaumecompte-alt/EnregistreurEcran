import { isBlackFrame } from "./detect";

export function pickRecorderMime(): string {
  const candidates = [
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4;codecs=avc1",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

export type CaptureSupport = {
  supported: boolean;
  /** Chrome / Edge : seuls navigateurs qui capturent le son d'un onglet. */
  tabAudio: boolean;
};

export function captureSupport(): CaptureSupport {
  if (typeof navigator === "undefined")
    return { supported: true, tabAudio: true };
  const supported =
    !!navigator.mediaDevices?.getDisplayMedia &&
    typeof MediaRecorder !== "undefined";
  const ua = navigator.userAgent;
  const chromium = /Chrome\/|Edg\//.test(ua) && !/OPR\//.test(ua);
  return { supported, tabAudio: chromium };
}

export type CaptureWarning = "no-audio" | "mic-denied" | "black-screen";

export type CaptureCallbacks = {
  onWarning: (w: CaptureWarning, active: boolean) => void;
  /** Appelé quand l'utilisateur arrête le partage depuis la barre du navigateur. */
  onEnded: () => void;
};

export type Capture = {
  hasAudio: boolean;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<Blob>;
  cancel: () => void;
};

export async function startCapture(
  opts: { mic: boolean } & CaptureCallbacks,
): Promise<Capture> {
  // Options non encore typées par TypeScript : cursor, displaySurface, systemAudio, etc.
  const displayOptions = {
    video: {
      frameRate: { ideal: 30 },
      cursor: "never",
      displaySurface: "browser",
    },
    // Pas de contraintes de traitement sur l'audio : Chrome refuse alors parfois
    // de démarrer la source (« Could not start audio source »).
    audio: true,
    preferCurrentTab: false,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    systemAudio: "include",
  } as DisplayMediaStreamOptions;

  let display: MediaStream;
  try {
    display = await navigator.mediaDevices.getDisplayMedia(displayOptions);
  } catch (e) {
    // Le son n'a pas pu démarrer : on réessaie avec l'image seule (alerte « pas de son » ensuite)
    if ((e as Error)?.name !== "NotReadableError") throw e;
    display = await navigator.mediaDevices.getDisplayMedia({
      ...displayOptions,
      audio: false,
    });
  }
  const streams: MediaStream[] = [display];
  let audioCtx: AudioContext | null = null;
  let micStream: MediaStream | null = null;

  if (opts.mic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streams.push(micStream);
    } catch {
      opts.onWarning("mic-denied", true);
    }
  }

  const displayAudio = display.getAudioTracks();
  let audioTracks: MediaStreamTrack[] = [];
  if (displayAudio.length && micStream) {
    // Mélange son de l'onglet + micro
    audioCtx = new AudioContext();
    await audioCtx.resume().catch(() => {});
    const dest = audioCtx.createMediaStreamDestination();
    audioCtx
      .createMediaStreamSource(new MediaStream(displayAudio))
      .connect(dest);
    audioCtx.createMediaStreamSource(micStream).connect(dest);
    audioTracks = dest.stream.getAudioTracks();
  } else if (displayAudio.length) {
    audioTracks = displayAudio; // pas de traitement : qualité d'origine
  } else if (micStream) {
    audioTracks = micStream.getAudioTracks();
  }
  if (!displayAudio.length) opts.onWarning("no-audio", true);

  const videoTrack = display.getVideoTracks()[0];
  if (!videoTrack) {
    streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
    throw new Error("Aucune piste vidéo");
  }
  const mime = pickRecorderMime();
  const recorder = new MediaRecorder(
    new MediaStream([videoTrack, ...audioTracks]),
    {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond: 10_000_000,
      audioBitsPerSecond: 192_000,
    },
  );
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  const stopMonitor = monitorBlackScreen(videoTrack, (black) =>
    opts.onWarning("black-screen", black),
  );

  const cleanup = () => {
    stopMonitor();
    streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    audioCtx?.close().catch(() => {});
  };

  let ended = false;
  videoTrack.addEventListener("ended", () => {
    if (!ended) opts.onEnded();
  });

  recorder.start(1000);

  return {
    hasAudio: audioTracks.length > 0,
    pause: () => recorder.state === "recording" && recorder.pause(),
    resume: () => recorder.state === "paused" && recorder.resume(),
    stop: () =>
      new Promise<Blob>((resolve) => {
        ended = true;
        const finish = () => {
          cleanup();
          resolve(
            new Blob(chunks, {
              type: recorder.mimeType || mime || "video/webm",
            }),
          );
        };
        if (recorder.state === "inactive") return finish();
        recorder.onstop = finish;
        recorder.stop();
      }),
    cancel: () => {
      ended = true;
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
      cleanup();
    },
  };
}

/**
 * Surveille la vidéo capturée : si l'image reste entièrement noire plusieurs secondes,
 * c'est presque toujours un site protégé (Netflix, Disney+…).
 */
function monitorBlackScreen(
  track: MediaStreamTrack,
  onChange: (black: boolean) => void,
): () => void {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  video.play().catch(() => {});
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 36;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  let blackSince: number | null = null;
  let flagged = false;
  const id = window.setInterval(() => {
    if (!g || video.readyState < 2) return;
    g.drawImage(video, 0, 0, canvas.width, canvas.height);
    const black = isBlackFrame(
      g.getImageData(0, 0, canvas.width, canvas.height),
    );
    const now = Date.now();
    if (black) {
      blackSince ??= now;
      if (!flagged && now - blackSince > 4000) {
        flagged = true;
        onChange(true);
      }
    } else {
      blackSince = null;
      if (flagged) {
        flagged = false;
        onChange(false);
      }
    }
  }, 1000);
  return () => {
    clearInterval(id);
    video.srcObject = null;
  };
}
