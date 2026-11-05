import { useRef } from "react";
import {
  isFull,
  isTooSmall,
  moveCrop,
  rectFromAnchor,
  resizeCrop,
  type Crop,
  type Handle,
} from "@/lib/video/crop";

type Props = {
  crop: Crop;
  onChange: (c: Crop) => void;
  /** Rapport largeur/hauteur imposé (en pixels), ou null pour un cadre libre. */
  ratio: number | null;
  /** Rapport largeur/hauteur de la vidéo. */
  aspect: number;
  /** Clic simple (sans glisser) : lecture/pause. */
  onTap: () => void;
};

type Drag = {
  mode: "new" | "move" | "resize";
  handle: Handle | undefined;
  sx: number;
  sy: number;
  clientX: number;
  clientY: number;
  startCrop: Crop;
  moved: boolean;
};

const CORNERS: Handle[] = ["nw", "ne", "sw", "se"];
const EDGES: Handle[] = ["n", "s", "e", "w"];

const HANDLE_STYLE: Record<Handle, React.CSSProperties> = {
  nw: { left: 0, top: 0, cursor: "nwse-resize" },
  ne: { left: "100%", top: 0, cursor: "nesw-resize" },
  sw: { left: 0, top: "100%", cursor: "nesw-resize" },
  se: { left: "100%", top: "100%", cursor: "nwse-resize" },
  n: { left: "50%", top: 0, cursor: "ns-resize" },
  s: { left: "50%", top: "100%", cursor: "ns-resize" },
  e: { left: "100%", top: "50%", cursor: "ew-resize" },
  w: { left: 0, top: "50%", cursor: "ew-resize" },
};

export function CropOverlay({ crop, onChange, ratio, aspect, onTap }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const showFrame = !isFull(crop);

  const pos = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const h = target.dataset["handle"] as Handle | "move" | undefined;
    const p = pos(e);
    boxRef.current!.setPointerCapture(e.pointerId);
    drag.current = {
      mode: h === "move" ? "move" : h ? "resize" : "new",
      handle: h && h !== "move" ? h : undefined,
      sx: Math.min(1, Math.max(0, p.x)),
      sy: Math.min(1, Math.max(0, p.y)),
      clientX: e.clientX,
      clientY: e.clientY,
      startCrop: crop,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (
      !d.moved &&
      Math.hypot(e.clientX - d.clientX, e.clientY - d.clientY) < 5
    )
      return;
    d.moved = true;
    const p = pos(e);
    const px = Math.min(1, Math.max(0, p.x));
    const py = Math.min(1, Math.max(0, p.y));
    if (d.mode === "new")
      onChange(rectFromAnchor(d.sx, d.sy, px, py, ratio, aspect));
    else if (d.mode === "move")
      onChange(moveCrop(d.startCrop, p.x - d.sx, p.y - d.sy));
    else if (d.handle)
      onChange(resizeCrop(d.startCrop, d.handle, px, py, ratio, aspect));
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) return onTap();
    // Une sélection minuscule est sûrement involontaire : on revient à l'état précédent
    if (d.mode !== "move" && isTooSmall(cropRef.current)) onChange(d.startCrop);
  };

  // Valeur courante lisible dans onPointerUp sans attendre le rendu suivant
  const cropRef = useRef(crop);
  cropRef.current = crop;

  return (
    <div
      ref={boxRef}
      className="absolute inset-0 cursor-crosshair touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      aria-label="Zone de recadrage : glissez pour sélectionner la partie à garder"
    >
      {showFrame && (
        <div
          data-handle="move"
          className="absolute cursor-move border-2 border-accent"
          style={{
            left: `${crop.x * 100}%`,
            top: `${crop.y * 100}%`,
            width: `${crop.w * 100}%`,
            height: `${crop.h * 100}%`,
            boxShadow: "0 0 0 9999px var(--overlay)",
          }}
        >
          {/* Repères des tiers */}
          <div className="pointer-events-none absolute inset-0 opacity-30">
            <div className="absolute inset-y-0 left-1/3 border-l border-accent" />
            <div className="absolute inset-y-0 left-2/3 border-l border-accent" />
            <div className="absolute inset-x-0 top-1/3 border-t border-accent" />
            <div className="absolute inset-x-0 top-2/3 border-t border-accent" />
          </div>
          {[...CORNERS, ...(ratio ? [] : EDGES)].map((h) => (
            <div
              key={h}
              data-handle={h}
              className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-accent bg-background"
              style={HANDLE_STYLE[h]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
