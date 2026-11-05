import type { Crop } from "./crop";

// Analyse d'images : détection des bandes noires et des écrans entièrement noirs
// (signe d'une vidéo protégée par DRM, comme Netflix).

export type Pixels = { data: ArrayLike<number>; width: number; height: number };

const lum = (d: ArrayLike<number>, i: number) =>
  (d[i] ?? 0) * 0.299 + (d[i + 1] ?? 0) * 0.587 + (d[i + 2] ?? 0) * 0.114;

/**
 * Zone utile de l'image (sans bandes noires). Une ligne/colonne compte comme « contenu »
 * si une part suffisante de ses pixels dépasse le seuil de luminosité.
 * Renvoie null si l'image est entièrement noire.
 */
export function detectContent(
  p: Pixels,
  threshold = 28,
  minFraction = 0.02,
): Crop | null {
  const { data, width, height } = p;
  const rowCount = new Uint32Array(height);
  const colCount = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (lum(data, (y * width + x) * 4) > threshold) {
        rowCount[y] = (rowCount[y] ?? 0) + 1;
        colCount[x] = (colCount[x] ?? 0) + 1;
      }
    }
  }
  const rowMin = Math.max(1, width * minFraction);
  const colMin = Math.max(1, height * minFraction);
  let top = -1,
    bottom = -1,
    left = -1,
    right = -1;
  for (let y = 0; y < height; y++)
    if ((rowCount[y] ?? 0) >= rowMin) {
      if (top < 0) top = y;
      bottom = y;
    }
  for (let x = 0; x < width; x++)
    if ((colCount[x] ?? 0) >= colMin) {
      if (left < 0) left = x;
      right = x;
    }
  if (top < 0 || left < 0) return null;
  return {
    x: left / width,
    y: top / height,
    w: (right + 1 - left) / width,
    h: (bottom + 1 - top) / height,
  };
}

/** Vrai si l'image est (quasiment) entièrement noire. */
export function isBlackFrame(p: Pixels, maxLum = 16): boolean {
  const { data, width, height } = p;
  const n = width * height;
  let bright = 0;
  for (let i = 0; i < n; i++) if (lum(data, i * 4) > maxLum) bright++;
  return bright < n * 0.002;
}
