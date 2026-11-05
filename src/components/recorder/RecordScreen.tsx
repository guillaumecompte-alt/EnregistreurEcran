import { useEffect, useRef, useState } from "react";
import {
  captureSupport,
  startCapture,
  type Capture,
  type CaptureWarning,
} from "@/lib/video/capture";
import { fmtTime } from "@/lib/video/format";

const WORKS = [
  "YouTube",
  "Dailymotion",
  "Arte.tv",
  "Lumni",
  "INA",
  "Vimeo",
  "France.tv (selon les programmes)",
];
const BLOCKED = ["Netflix", "Disney+", "Prime Video", "Canal+", "Apple TV+"];

const WARNING_TEXT: Record<CaptureWarning, string> = {
  "no-audio":
    "Aucun son n'est capté. Arrêtez, puis recommencez en choisissant un onglet et en activant « Partager aussi l'audio de l'onglet ».",
  "mic-denied":
    "Le micro a été refusé : l'enregistrement continue sans votre voix.",
  "black-screen":
    "L'image capturée est entièrement noire. Si la vidéo vient d'une plateforme protégée (Netflix, Disney+…), l'enregistrement ne pourra pas fonctionner.",
};

export function RecordScreen({
  onRecorded,
}: {
  onRecorded: (blob: Blob) => void;
}) {
  const [status, setStatus] = useState<
    "idle" | "starting" | "recording" | "paused"
  >("idle");
  const [mic, setMic] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [warnings, setWarnings] = useState<CaptureWarning[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [support, setSupport] = useState({ supported: true, tabAudio: true });
  const capRef = useRef<Capture | null>(null);
  const clock = useRef({ acc: 0, since: 0 });

  useEffect(() => setSupport(captureSupport()), []);

  useEffect(() => {
    if (status !== "recording") return;
    const id = setInterval(
      () =>
        setElapsed(
          (clock.current.acc + Date.now() - clock.current.since) / 1000,
        ),
      200,
    );
    return () => clearInterval(id);
  }, [status]);

  // Arrête proprement la capture si on quitte la page
  useEffect(() => () => capRef.current?.cancel(), []);

  const setWarning = (w: CaptureWarning, active: boolean) =>
    setWarnings((list) =>
      active ? [...new Set([...list, w])] : list.filter((x) => x !== w),
    );

  async function start() {
    setError(null);
    setWarnings([]);
    setStatus("starting");
    try {
      capRef.current = await startCapture({
        mic,
        onWarning: setWarning,
        onEnded: () => void stop(),
      });
      clock.current = { acc: 0, since: Date.now() };
      setElapsed(0);
      setStatus("recording");
    } catch (e) {
      console.error("Échec du démarrage de la capture", e);
      setStatus("idle");
      const name = (e as Error)?.name;
      setError(
        name === "NotAllowedError"
          ? "Partage d'écran annulé ou refusé."
          : "Impossible de démarrer l'enregistrement sur ce navigateur.",
      );
    }
  }

  async function stop() {
    const cap = capRef.current;
    if (!cap) return;
    capRef.current = null;
    const blob = await cap.stop();
    setStatus("idle");
    if (blob.size < 1000) {
      setError("L'enregistrement est vide.");
      return;
    }
    onRecorded(blob);
  }

  function togglePause() {
    const cap = capRef.current;
    if (!cap) return;
    if (status === "recording") {
      cap.pause();
      clock.current.acc += Date.now() - clock.current.since;
      setStatus("paused");
    } else {
      cap.resume();
      clock.current.since = Date.now();
      setStatus("recording");
    }
  }

  function cancel() {
    capRef.current?.cancel();
    capRef.current = null;
    setStatus("idle");
    setWarnings([]);
    setElapsed(0);
  }

  const active = status === "recording" || status === "paused";

  if (!support.supported) {
    return (
      <section className="rounded-2xl border border-border bg-card p-8">
        <p className="font-medium">
          Ce navigateur ne permet pas d'enregistrer l'écran.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Utilisez Chrome ou Edge sur un ordinateur.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-8 text-center sm:p-10">
        <p
          className={`font-mono text-6xl tabular-nums ${status === "paused" ? "text-muted-foreground" : ""}`}
        >
          {fmtTime(active ? elapsed : 0)}
        </p>
        <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
          {status === "recording" &&
            "Enregistrement en cours… lancez la vidéo dans l'autre onglet."}
          {status === "paused" && "En pause."}
          {status === "starting" && "Choisissez l'onglet à enregistrer…"}
          {status === "idle" && "Prêt à enregistrer un extrait."}
        </p>

        {status === "idle" && (
          <label className="mt-6 inline-flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mic}
              onChange={(e) => setMic(e.target.checked)}
              className="accent-primary"
            />
            Ajouter mon micro (pour commenter l'extrait)
          </label>
        )}

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {!active ? (
            <button
              onClick={start}
              disabled={status === "starting"}
              className="rounded-full bg-primary px-8 py-3 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              ● Démarrer
            </button>
          ) : (
            <>
              <button
                onClick={stop}
                className="rounded-full bg-primary px-8 py-3 font-medium text-primary-foreground transition hover:opacity-90"
              >
                ■ Arrêter
              </button>
              <button
                onClick={togglePause}
                className="rounded-full bg-secondary px-6 py-3 font-medium text-secondary-foreground transition hover:opacity-90"
              >
                {status === "paused" ? "▶ Reprendre" : "❚❚ Pause"}
              </button>
              <button
                onClick={cancel}
                className="rounded-full px-5 py-3 text-sm text-muted-foreground hover:text-foreground"
              >
                Annuler
              </button>
            </>
          )}
        </div>

        {warnings.length > 0 && (
          <div
            className="mx-auto mt-6 max-w-xl space-y-2 text-left"
            role="alert"
          >
            {warnings.map((w) => (
              <p
                key={w}
                className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent"
              >
                {WARNING_TEXT[w]}
              </p>
            ))}
          </div>
        )}
        {error && <p className="mt-6 text-sm text-destructive">{error}</p>}
      </section>

      {!active && (
        <div className="grid gap-6 md:grid-cols-[3fr_2fr]">
          <section className="rounded-2xl border border-border bg-card p-6">
            <h2 className="font-bold">Comment faire</h2>
            <ol className="mt-4 space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="font-mono text-accent">1</span>
                <span>
                  Ouvrez la vidéo dans un <strong>autre onglet</strong> et
                  placez-vous un peu avant le passage voulu.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-accent">2</span>
                <span>
                  Cliquez sur « Démarrer », choisissez{" "}
                  <strong>« Onglet »</strong> puis l'onglet de la vidéo, et
                  activez{" "}
                  <strong>« Partager aussi l'audio de l'onglet »</strong>.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-accent">3</span>
                <span>
                  Lancez la lecture (en plein écran si vous voulez), puis
                  revenez ici et cliquez sur « Arrêter ».
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-accent">4</span>
                <span>
                  Ajustez le début, la fin et le cadre, puis créez le fichier
                  MP4 à projeter en classe.
                </span>
              </li>
            </ol>
            {!support.tabAudio && (
              <p className="mt-5 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
                Ce navigateur ne sait pas capter le son d'un onglet. Pour avoir
                le son, utilisez Chrome ou Edge sur ordinateur.
              </p>
            )}
          </section>
          <section className="rounded-2xl border border-border bg-card p-6 text-sm">
            <h2 className="font-bold">Sites compatibles</h2>
            <p className="mt-3 text-muted-foreground">Fonctionne avec :</p>
            <p className="mt-1">{WORKS.join(" · ")}</p>
            <p className="mt-4 text-muted-foreground">
              Image noire (vidéos protégées contre la copie) :
            </p>
            <p className="mt-1">{BLOCKED.join(" · ")}</p>
            <p className="mt-4 text-xs text-muted-foreground">
              L'usage d'extraits en classe relève de l'exception pédagogique :
              vérifiez les conditions sur Éduscol.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
