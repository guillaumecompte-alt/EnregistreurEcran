import { useEffect, useMemo, useRef, useState } from "react";
import { CropOverlay } from "./CropOverlay";
import { TrimBar } from "./TrimBar";
import {
  FULL,
  fitRatio,
  isFull,
  RATIOS,
  ratioValue,
  toPixels,
  type Crop,
  type RatioId,
} from "@/lib/video/crop";
import {
  detectBlackBars,
  exportClip,
  ExportCanceled,
  type ExportResult,
  type RecordingInfo,
  type Trim,
} from "@/lib/video/export";
import { clipFilename, fmtSize, fmtTime } from "@/lib/video/format";

type Props = {
  source: Blob;
  info: RecordingInfo;
  onRestart: () => void;
};

type Result = ExportResult & { url: string; name: string };

export function EditScreen({ source, info, onRestart }: Props) {
  const url = useMemo(() => URL.createObjectURL(source), [source]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const duration = info.duration;
  const aspect = info.width && info.height ? info.width / info.height : 16 / 9;

  const videoRef = useRef<HTMLVideoElement>(null);
  const [title, setTitle] = useState("");
  const [trim, setTrim] = useState<Trim>({ start: 0, end: duration });
  const [crop, setCrop] = useState<Crop>(FULL);
  const [ratioId, setRatioId] = useState<RatioId>("free");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const stopAt = useRef(duration);
  const [detecting, setDetecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [progress, setProgress] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exporting = progress !== null;

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(
    () => () => void (result && URL.revokeObjectURL(result.url)),
    [result],
  );

  // Toute modification rend le fichier déjà créé obsolète
  useEffect(() => setResult(null), [trim, crop]);

  // Suivi de la tête de lecture, arrêt automatique à la fin de l'extrait
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      const v = videoRef.current;
      if (!v) return;
      setTime(v.currentTime);
      if (v.currentTime >= stopAt.current) {
        v.pause();
        v.currentTime = stopAt.current;
        setTime(stopAt.current);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = (t: number) => {
    const v = videoRef.current;
    const clamped = Math.min(duration, Math.max(0, t));
    if (v) v.currentTime = clamped;
    setTime(clamped);
  };

  const play = (from?: number) => {
    const v = videoRef.current;
    if (!v) return;
    if (from !== undefined) seek(from);
    const t = from ?? v.currentTime;
    // Lecture limitée à l'extrait si on part de l'intérieur ; sinon jusqu'au bout
    stopAt.current = t < trim.end - 0.05 ? trim.end : duration;
    if (t >= duration - 0.05) seek(trim.start);
    void v.play();
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) play();
    else v.pause();
  };

  const chooseRatio = (id: RatioId) => {
    setRatioId(id);
    const r = ratioValue(id);
    if (r) setCrop((c) => fitRatio(c, r, aspect));
  };

  async function autoDetect() {
    setDetecting(true);
    setNotice(null);
    try {
      const box = await detectBlackBars(source, trim, info, videoRef.current);
      if (!box) setNotice("Image trop sombre pour détecter les bandes noires.");
      else if (isFull(box) || (box.w > 0.98 && box.h > 0.98))
        setNotice("Aucune bande noire détectée.");
      else {
        setRatioId("free");
        setCrop(box);
      }
    } finally {
      setDetecting(false);
    }
  }

  async function createVideo() {
    videoRef.current?.pause();
    setError(null);
    setResult(null);
    setProgress(0);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await exportClip({
        source,
        crop,
        trim,
        info,
        onProgress: (p) => setProgress(p),
        signal: ctrl.signal,
      });
      const r: Result = {
        ...res,
        url: URL.createObjectURL(res.blob),
        name: clipFilename(title, res.ext),
      };
      setResult(r);
      download(r);
    } catch (e) {
      if (!(e instanceof ExportCanceled)) {
        console.error(e);
        setError(
          "La création de la vidéo a échoué. Réessayez, ou essayez sans recadrage.",
        );
      }
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }

  const px = toPixels(crop, info.width, info.height);

  return (
    <div className="space-y-6">
      <label className="block">
        <span className="text-sm text-muted-foreground">Nom de l'extrait</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex. : Le Cid – acte I, scène 4"
          className="mt-1 w-full rounded-xl border border-input bg-card px-4 py-2.5 outline-none focus:ring-2 focus:ring-ring"
        />
      </label>

      <div className="overflow-hidden rounded-2xl border border-border bg-black">
        <div
          className="relative mx-auto"
          style={{
            width: `min(100%, calc(65vh * ${aspect}))`,
            aspectRatio: aspect,
          }}
        >
          <video
            ref={videoRef}
            src={url}
            playsInline
            preload="auto"
            className="absolute inset-0 h-full w-full"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onSeeked={(e) => setTime(e.currentTarget.currentTime)}
          />
          <CropOverlay
            crop={crop}
            onChange={setCrop}
            ratio={ratioValue(ratioId)}
            aspect={aspect}
            onTap={togglePlay}
          />
        </div>
      </div>

      {/* Lecture et coupe */}
      <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={togglePlay}
            className="w-28 rounded-full bg-secondary px-4 py-2 text-sm font-medium"
            aria-label={playing ? "Pause" : "Lecture"}
          >
            {playing ? "❚❚ Pause" : "▶ Lecture"}
          </button>
          <button
            onClick={() => play(trim.start)}
            className="rounded-full bg-secondary px-4 py-2 text-sm"
          >
            Revoir l'extrait
          </button>
          <span className="ml-1 font-mono text-sm tabular-nums">
            {fmtTime(time, true)}{" "}
            <span className="text-muted-foreground">/ {fmtTime(duration)}</span>
          </span>
          <span className="flex-1" />
          <button
            onClick={() =>
              setTrim((t) => ({ ...t, start: Math.min(time, t.end - 0.3) }))
            }
            className="rounded-full border border-accent/60 px-4 py-2 text-sm text-accent hover:bg-accent/10"
          >
            [ Début ici
          </button>
          <button
            onClick={() =>
              setTrim((t) => ({ ...t, end: Math.max(time, t.start + 0.3) }))
            }
            className="rounded-full border border-accent/60 px-4 py-2 text-sm text-accent hover:bg-accent/10"
          >
            Fin ici ]
          </button>
        </div>
        <TrimBar
          duration={duration}
          trim={trim}
          onTrim={setTrim}
          currentTime={time}
          onSeek={seek}
        />
      </section>

      {/* Recadrage */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm font-medium">Cadre</span>
          {RATIOS.map((r) => (
            <button
              key={r.id}
              onClick={() => chooseRatio(r.id)}
              aria-pressed={ratioId === r.id}
              className={`rounded-full px-3.5 py-1.5 text-sm ${ratioId === r.id ? "bg-accent text-accent-foreground" : "bg-secondary"}`}
            >
              {r.label}
            </button>
          ))}
          <button
            onClick={autoDetect}
            disabled={detecting}
            className="rounded-full bg-secondary px-3.5 py-1.5 text-sm disabled:opacity-50"
          >
            {detecting ? "Analyse…" : "Enlever les bandes noires"}
          </button>
          {!isFull(crop) && (
            <button
              onClick={() => setCrop(FULL)}
              className="rounded-full px-3.5 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Tout garder
            </button>
          )}
          <span className="flex-1" />
          <span className="font-mono text-xs text-muted-foreground">
            {px.width} × {px.height} px
          </span>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {notice ??
            (isFull(crop)
              ? "Glissez sur l'image pour ne garder qu'une partie (par exemple sans la barre du site). Un clic simple lance ou met en pause."
              : "Déplacez le cadre ou tirez ses poignées pour l'ajuster.")}
        </p>
      </section>

      {/* Création du fichier */}
      <section className="flex flex-wrap items-center gap-3">
        {!exporting ? (
          <button
            onClick={createVideo}
            className="rounded-full bg-primary px-7 py-3 font-medium text-primary-foreground transition hover:opacity-90"
          >
            Créer la vidéo ({fmtTime(trim.end - trim.start)})
          </button>
        ) : (
          <>
            <div
              className="h-2 min-w-48 flex-1 overflow-hidden rounded-full bg-secondary"
              role="progressbar"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <span className="font-mono text-sm tabular-nums">
              {Math.round(progress * 100)} %
            </span>
            <button
              onClick={() => abortRef.current?.abort()}
              className="rounded-full bg-secondary px-5 py-2 text-sm"
            >
              Annuler
            </button>
          </>
        )}
        <button
          disabled={exporting}
          onClick={() => {
            if (
              result ||
              window.confirm(
                "Abandonner cet enregistrement et en faire un nouveau ?",
              )
            )
              onRestart();
          }}
          className="rounded-full px-5 py-3 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Nouvel enregistrement
        </button>
      </section>

      {result && (
        <section
          className="rounded-2xl border border-accent/50 bg-accent/10 p-5 text-sm"
          role="status"
        >
          <p className="font-medium">
            Vidéo prête : {result.name} ({fmtSize(result.blob.size)})
          </p>
          <p className="mt-1 text-muted-foreground">
            Le téléchargement a démarré.{" "}
            {result.ext === "webm" &&
              "Ce navigateur ne sait pas produire de MP4 : le fichier est en WebM (lisible avec VLC ou un navigateur). "}
            <button
              onClick={() => download(result)}
              className="underline hover:text-foreground"
            >
              Télécharger à nouveau
            </button>
          </p>
        </section>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function download(r: Result) {
  const a = document.createElement("a");
  a.href = r.url;
  a.download = r.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
