import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { RecordScreen } from "@/components/recorder/RecordScreen";
import { EditScreen } from "@/components/recorder/EditScreen";
import { probeRecording, type RecordingInfo } from "@/lib/video/export";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: "Extraits vidéo pour la classe — enregistrer, couper, recadrer",
      },
      {
        name: "description",
        content:
          "Enregistrez un passage vidéo (YouTube, Arte…), coupez le début et la fin, recadrez puis téléchargez un MP4 prêt à projeter en classe.",
      },
      { property: "og:title", content: "Extraits vidéo pour la classe" },
      {
        property: "og:description",
        content:
          "Enregistrez un passage vidéo, coupez, recadrez et téléchargez un MP4 prêt à projeter.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

type State =
  | { phase: "record" }
  | { phase: "preparing" }
  | { phase: "edit"; source: Blob; info: RecordingInfo; key: number };

function Index() {
  const [state, setState] = useState<State>({ phase: "record" });
  const [error, setError] = useState<string | null>(null);

  async function onRecorded(blob: Blob) {
    setError(null);
    setState({ phase: "preparing" });
    try {
      const info = await probeRecording(blob);
      if (!info.duration || !info.width)
        throw new Error("Durée ou taille inconnue");
      setState({ phase: "edit", source: blob, info, key: Date.now() });
    } catch (e) {
      console.error(e);
      setError("Impossible de lire l'enregistrement. Réessayez.");
      setState({ phase: "record" });
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10 font-sans text-foreground sm:py-12">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 flex items-center gap-3">
          <span className="h-3 w-3 rounded-full bg-primary" />
          <h1 className="text-2xl font-bold tracking-tight">
            Extraits vidéo pour la classe
          </h1>
          {state.phase === "edit" && (
            <span className="ml-auto text-sm text-muted-foreground">
              Étape 2 : couper, recadrer, créer le fichier
            </span>
          )}
        </header>

        {state.phase === "record" && <RecordScreen onRecorded={onRecorded} />}
        {state.phase === "preparing" && (
          <section
            className="rounded-2xl border border-border bg-card p-10 text-center text-muted-foreground"
            aria-live="polite"
          >
            Préparation de la vidéo…
          </section>
        )}
        {state.phase === "edit" && (
          <EditScreen
            key={state.key}
            source={state.source}
            info={state.info}
            onRestart={() => setState({ phase: "record" })}
          />
        )}
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </div>
    </main>
  );
}
