// Géométrie du recadrage. Toutes les coordonnées sont normalisées (0..1)
// par rapport à l'image source ; `aspect` est le rapport largeur/hauteur en pixels de la vidéo.

export type Crop = { x: number; y: number; w: number; h: number };
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };
export const MIN_SIZE = 0.05;

export const RATIOS = [
  { id: "free", label: "Libre", value: null },
  { id: "16:9", label: "16:9", value: 16 / 9 },
  { id: "4:3", label: "4:3", value: 4 / 3 },
  { id: "1:1", label: "1:1", value: 1 },
] as const;
export type RatioId = (typeof RATIOS)[number]["id"];

export const ratioValue = (id: RatioId) =>
  RATIOS.find((r) => r.id === id)?.value ?? null;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export const isFull = (c: Crop) =>
  c.x < 0.002 && c.y < 0.002 && c.w > 0.996 && c.h > 0.996;
export const isTooSmall = (c: Crop) => c.w < MIN_SIZE || c.h < MIN_SIZE;

/** Plus grand rectangle de rapport `ratio`, centré dans `c`. */
export function fitRatio(c: Crop, ratio: number, aspect: number): Crop {
  const k = aspect / ratio; // hauteur normalisée = largeur normalisée × k
  let w = c.w;
  let h = w * k;
  if (h > c.h) {
    h = c.h;
    w = h / k;
  }
  return { x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w, h };
}

export function moveCrop(c: Crop, dx: number, dy: number): Crop {
  return {
    ...c,
    x: clamp(c.x + dx, 0, 1 - c.w),
    y: clamp(c.y + dy, 0, 1 - c.h),
  };
}

/** Rectangle tracé depuis un point fixe (ancre) jusqu'au pointeur, borné à l'image. */
export function rectFromAnchor(
  ax: number,
  ay: number,
  px: number,
  py: number,
  ratio: number | null,
  aspect: number,
): Crop {
  const dirX = px >= ax ? 1 : -1;
  const dirY = py >= ay ? 1 : -1;
  const maxW = dirX > 0 ? 1 - ax : ax;
  const maxH = dirY > 0 ? 1 - ay : ay;
  let w = Math.min(Math.abs(px - ax), maxW);
  let h = Math.min(Math.abs(py - ay), maxH);
  if (ratio) {
    const k = aspect / ratio;
    w = Math.min(Math.max(w, h / k), maxW, maxH / k);
    h = w * k;
  }
  return { x: dirX > 0 ? ax : ax - w, y: dirY > 0 ? ay : ay - h, w, h };
}

/** Redimensionne `c` en tirant la poignée `handle` jusqu'au point (px, py). */
export function resizeCrop(
  c: Crop,
  handle: Handle,
  px: number,
  py: number,
  ratio: number | null,
  aspect: number,
): Crop {
  px = clamp(px, 0, 1);
  py = clamp(py, 0, 1);
  if (handle.length === 2) {
    const ax = handle.includes("e") ? c.x : c.x + c.w;
    const ay = handle.includes("s") ? c.y : c.y + c.h;
    return rectFromAnchor(ax, ay, px, py, ratio, aspect);
  }
  let { x, y, w, h } = c;
  if (handle === "e") w = clamp(px - x, MIN_SIZE, 1 - x);
  if (handle === "s") h = clamp(py - y, MIN_SIZE, 1 - y);
  if (handle === "w") {
    const right = x + w;
    x = clamp(px, 0, right - MIN_SIZE);
    w = right - x;
  }
  if (handle === "n") {
    const bottom = y + h;
    y = clamp(py, 0, bottom - MIN_SIZE);
    h = bottom - y;
  }
  return { x, y, w, h };
}

export type PixelRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Convertit en pixels avec des dimensions paires (exigées par l'encodeur H.264). */
export function toPixels(c: Crop, width: number, height: number): PixelRect {
  const evenDown = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  const left = clamp(
    Math.round((c.x * width) / 2) * 2,
    0,
    Math.max(0, width - 2),
  );
  const top = clamp(
    Math.round((c.y * height) / 2) * 2,
    0,
    Math.max(0, height - 2),
  );
  return {
    left,
    top,
    width: evenDown(Math.min(c.w * width, width - left)),
    height: evenDown(Math.min(c.h * height, height - top)),
  };
}

export function unionCrops(crops: Crop[]): Crop | null {
  if (!crops.length) return null;
  const x = Math.min(...crops.map((c) => c.x));
  const y = Math.min(...crops.map((c) => c.y));
  const r = Math.max(...crops.map((c) => c.x + c.w));
  const b = Math.max(...crops.map((c) => c.y + c.h));
  return { x, y, w: r - x, h: b - y };
}
