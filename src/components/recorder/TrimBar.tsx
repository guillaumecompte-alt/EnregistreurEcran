import { useRef } from "react";
import { fmtTime } from "@/lib/video/format";
import type { Trim } from "@/lib/video/export";

type Props = {
  duration: number;
  trim: Trim;
  onTrim: (t: Trim) => void;
  currentTime: number;
  onSeek: (t: number) => void;
};

const MIN_GAP = 0.3;

/** Barre de coupe : deux poignées (début / fin) et la tête de lecture. */
export function TrimBar({
  duration,
  trim,
  onTrim,
  currentTime,
  onSeek,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | "seek" | null>(null);
  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`;

  const timeAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return Math.min(
      duration,
      Math.max(0, ((clientX - r.left) / r.width) * duration),
    );
  };

  const apply = (which: "start" | "end", t: number) => {
    if (which === "start") {
      const start = Math.min(t, trim.end - MIN_GAP);
      onTrim({ ...trim, start: Math.max(0, start) });
      onSeek(Math.max(0, start));
    } else {
      const end = Math.max(t, trim.start + MIN_GAP);
      onTrim({ ...trim, end: Math.min(duration, end) });
      onSeek(Math.min(duration, end));
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const which = (e.target as HTMLElement).dataset["thumb"] as
      "start" | "end" | undefined;
    trackRef.current!.setPointerCapture(e.pointerId);
    dragging.current = which ?? "seek";
    if (!which) onSeek(timeAt(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragging.current;
    if (!d) return;
    const t = timeAt(e.clientX);
    if (d === "seek") onSeek(t);
    else apply(d, t);
  };
  const onPointerUp = () => (dragging.current = null);

  const onKey = (which: "start" | "end") => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.1;
    const cur = which === "start" ? trim.start : trim.end;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown")
      apply(which, cur - step);
    else if (e.key === "ArrowRight" || e.key === "ArrowUp")
      apply(which, cur + step);
    else return;
    e.preventDefault();
  };

  const thumb =
    "absolute top-1/2 h-9 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-md bg-accent shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="select-none">
      <div
        ref={trackRef}
        className="relative h-12 cursor-pointer touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full bg-secondary" />
        <div
          className="absolute top-1/2 h-3 -translate-y-1/2 bg-accent/60"
          style={{
            left: pct(trim.start),
            width: `calc(${pct(trim.end)} - ${pct(trim.start)})`,
          }}
        />
        <div
          className="pointer-events-none absolute top-1/2 h-11 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-foreground"
          style={{ left: pct(currentTime) }}
        />
        <div
          data-thumb="start"
          role="slider"
          tabIndex={0}
          aria-label="Début de l'extrait"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={trim.start}
          aria-valuetext={fmtTime(trim.start, true)}
          onKeyDown={onKey("start")}
          className={thumb}
          style={{ left: pct(trim.start) }}
        />
        <div
          data-thumb="end"
          role="slider"
          tabIndex={0}
          aria-label="Fin de l'extrait"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={trim.end}
          aria-valuetext={fmtTime(trim.end, true)}
          onKeyDown={onKey("end")}
          className={thumb}
          style={{ left: pct(trim.end) }}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-xs tabular-nums text-muted-foreground">
        <span>Début {fmtTime(trim.start, true)}</span>
        <span className="text-foreground">
          Extrait : {fmtTime(trim.end - trim.start, true)}
        </span>
        <span>Fin {fmtTime(trim.end, true)}</span>
      </div>
    </div>
  );
}
