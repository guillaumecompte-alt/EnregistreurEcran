import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Enregistreur d'écran — MP4 avec recadrage" },
      { name: "description", content: "Enregistrez votre écran et le son, recadrez la vidéo puis téléchargez-la en MP4." },
      { property: "og:title", content: "Enregistreur d'écran — MP4 avec recadrage" },
      { property: "og:description", content: "Enregistrez votre écran et le son, recadrez puis téléchargez en MP4." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

type Crop = { x: number; y: number; w: number; h: number }; // normalized 0..1
const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

function pickMime() {
  const c = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
  return c.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";
}

function fmt(s: number) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function Index() {
  const [status, setStatus] = useState<"idle" | "recording" | "done" | "exporting">("idle");
  const [mic, setMic] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>(FULL);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mimeNote, setMimeNote] = useState("");
  const recRef = useRef<MediaRecorder | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number } | null>(null);

  useEffect(() => {
    if (status !== "recording") return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => {
    const m = pickMime();
    if (!m.startsWith("video/mp4")) setMimeNote("Votre navigateur ne sait pas produire du MP4 nativement : utilisez Chrome, Edge ou Safari récents pour un fichier .mp4.");
  }, []);

  const stopAll = () => {
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streamsRef.current = [];
  };

  async function start() {
    setError(null);
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      streamsRef.current = [display];
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      let hasAudio = false;
      if (display.getAudioTracks().length) {
        ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);
        hasAudio = true;
      }
      if (mic) {
        try {
          const m = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamsRef.current.push(m);
          ctx.createMediaStreamSource(m).connect(dest);
          hasAudio = true;
        } catch { /* micro refusé */ }
      }
      const tracks = [...display.getVideoTracks(), ...(hasAudio ? dest.stream.getAudioTracks() : [])];
      const mime = pickMime();
      const rec = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stopAll();
        ctx.close();
        const blob = new Blob(chunks, { type: rec.mimeType || "video/mp4" });
        setVideoUrl(URL.createObjectURL(blob));
        setCrop(FULL);
        setStatus("done");
      };
      const vt = display.getVideoTracks()[0];
      if (vt) vt.onended = () => rec.state !== "inactive" && rec.stop();
      rec.start(1000);
      recRef.current = rec;
      setElapsed(0);
      setStatus("recording");
    } catch (e) {
      setError("Enregistrement annulé ou non autorisé.");
      stopAll();
    }
  }

  const stop = () => recRef.current?.state !== "inactive" && recRef.current?.stop();

  const reset = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    setStatus("idle");
    setCrop(FULL);
  };

  // crop selection
  const pos = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = pos(e);
    dragRef.current = { sx: p.x, sy: p.y };
    setCrop({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const p = pos(e), { sx, sy } = dragRef.current;
    setCrop({ x: Math.min(sx, p.x), y: Math.min(sy, p.y), w: Math.abs(p.x - sx), h: Math.abs(p.y - sy) });
  };
  const onUp = () => {
    dragRef.current = null;
    setCrop((c) => (c.w < 0.02 || c.h < 0.02 ? FULL : c));
  };

  const ext = (type: string) => (type.includes("mp4") ? "mp4" : "webm");

  async function download() {
    if (!videoUrl) return;
    const isFull = crop.w > 0.995 && crop.h > 0.995;
    if (isFull) {
      const blob = await fetch(videoUrl).then((r) => r.blob());
      return save(blob);
    }
    setStatus("exporting");
    setProgress(0);
    try {
      const blob = await exportCropped(videoUrl, crop, setProgress);
      save(blob);
    } catch {
      setError("Le recadrage a échoué.");
    }
    setStatus("done");
  }

  function save(blob: Blob) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `enregistrement-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext(blob.type)}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  const cropped = !(crop.w > 0.995 && crop.h > 0.995);

  return (
    <main className="min-h-screen bg-background px-4 py-12 font-sans text-foreground">
      <div className="mx-auto max-w-4xl">
        <header className="mb-10 flex items-center gap-3">
          <span className={`h-3 w-3 rounded-full bg-primary ${status === "recording" ? "animate-pulse" : ""}`} />
          <h1 className="text-2xl font-bold tracking-tight">Enregistreur d'écran</h1>
        </header>

        {status === "idle" || status === "recording" ? (
          <section className="rounded-2xl border border-border bg-card p-10 text-center">
            <p className="font-mono text-6xl tabular-nums">{fmt(status === "recording" ? elapsed : 0)}</p>
            <p className="mt-3 text-sm text-muted-foreground">
              {status === "recording" ? "Enregistrement en cours…" : "Écran + son système (cochez « partager l'audio »)"}
            </p>
            {status === "idle" && (
              <label className="mt-6 inline-flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} className="accent-primary" />
                Inclure le micro
              </label>
            )}
            <div className="mt-8">
              {status === "idle" ? (
                <button onClick={start} className="rounded-full bg-primary px-8 py-3 font-medium text-primary-foreground transition hover:opacity-90">
                  ● Démarrer
                </button>
              ) : (
                <button onClick={stop} className="rounded-full bg-secondary px-8 py-3 font-medium text-secondary-foreground ring-1 ring-primary transition hover:opacity-90">
                  ■ Arrêter
                </button>
              )}
            </div>
            {mimeNote && <p className="mt-6 text-xs text-accent">{mimeNote}</p>}
          </section>
        ) : (
          <section className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Faites glisser sur la vidéo pour sélectionner la zone à conserver.
            </p>
            <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
              <div ref={boxRef} className="relative">
                <video ref={videoRef} src={videoUrl!} controls className="block w-full" />
                <div
                  className="absolute inset-x-0 top-0 bottom-12 cursor-crosshair touch-none"
                  onPointerDown={onDown}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                >
                  {cropped && (
                    <div
                      className="pointer-events-none absolute border-2 border-accent"
                      style={{
                        left: `${crop.x * 100}%`, top: `${crop.y * 100}%`,
                        width: `${crop.w * 100}%`, height: `${crop.h * 100}%`,
                        boxShadow: "0 0 0 9999px var(--overlay)",
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
            {status === "exporting" && (
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress * 100}%` }} />
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <button disabled={status === "exporting"} onClick={download} className="rounded-full bg-primary px-6 py-2.5 font-medium text-primary-foreground disabled:opacity-50">
                {status === "exporting" ? `Recadrage… ${Math.round(progress * 100)}%` : cropped ? "Recadrer et télécharger" : "Télécharger"}
              </button>
              {cropped && (
                <button disabled={status === "exporting"} onClick={() => setCrop(FULL)} className="rounded-full bg-secondary px-6 py-2.5 text-secondary-foreground disabled:opacity-50">
                  Annuler le recadrage
                </button>
              )}
              <button disabled={status === "exporting"} onClick={reset} className="rounded-full px-6 py-2.5 text-muted-foreground hover:text-foreground disabled:opacity-50">
                Nouvel enregistrement
              </button>
            </div>
            {status === "exporting" && <p className="text-xs text-muted-foreground">Le recadrage se fait à vitesse réelle, gardez cet onglet ouvert.</p>}
          </section>
        )}
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </div>
    </main>
  );
}

async function exportCropped(src: string, crop: Crop, onProgress: (p: number) => void): Promise<Blob> {
  const v = document.createElement("video");
  v.src = src;
  v.playsInline = true;
  await new Promise((r) => (v.onloadedmetadata = r));
  // webm from MediaRecorder may report Infinity duration
  if (!isFinite(v.duration)) {
    v.currentTime = 1e9;
    await new Promise((r) => (v.ontimeupdate = r));
    v.ontimeupdate = null;
    v.currentTime = 0;
    await new Promise((r) => (v.onseeked = r));
  }
  const sx = Math.round(crop.x * v.videoWidth), sy = Math.round(crop.y * v.videoHeight);
  const sw = Math.round(crop.w * v.videoWidth) & ~1, sh = Math.round(crop.h * v.videoHeight) & ~1;
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const g = canvas.getContext("2d")!;
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  ctx.createMediaElementSource(v).connect(dest);
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<Blob>((r) => (rec.onstop = () => r(new Blob(chunks, { type: rec.mimeType }))));
  let raf = 0;
  const draw = () => {
    g.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);
    if (v.duration) onProgress(Math.min(1, v.currentTime / v.duration));
    raf = requestAnimationFrame(draw);
  };
  v.onended = () => {
    cancelAnimationFrame(raf);
    rec.stop();
  };
  rec.start(1000);
  draw();
  await v.play();
  const blob = await done;
  ctx.close();
  onProgress(1);
  return blob;
}
