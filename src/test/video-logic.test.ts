import { describe, expect, it } from "vitest";
import {
  FULL,
  fitRatio,
  isFull,
  moveCrop,
  rectFromAnchor,
  resizeCrop,
  toPixels,
} from "@/lib/video/crop";
import { detectContent, isBlackFrame } from "@/lib/video/detect";
import { clipFilename, fmtTime, slugify } from "@/lib/video/format";

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 4);

describe("recadrage", () => {
  it("place un cadre 4:3 centré dans une vidéo 16:9", () => {
    const c = fitRatio(FULL, 4 / 3, 16 / 9);
    near(c.h, 1);
    near((c.w * 16) / (c.h * 9), 4 / 3);
    near(c.x, (1 - c.w) / 2);
  });

  it("garde le rapport imposé en tirant un coin, sans sortir de l'image", () => {
    const c = rectFromAnchor(0.5, 0.5, 1.2, 0.6, 1, 16 / 9);
    expect(c.x + c.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(c.y + c.h).toBeLessThanOrEqual(1 + 1e-9);
    near((c.w * 16) / (c.h * 9), 1);
  });

  it("déplace le cadre sans le faire sortir", () => {
    const c = moveCrop({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, 0.5, -0.9);
    expect(c).toEqual({ x: 0.6, y: 0, w: 0.4, h: 0.4 });
  });

  it("redimensionne par un bord sans s'inverser", () => {
    const c = resizeCrop(
      { x: 0.2, y: 0.2, w: 0.4, h: 0.4 },
      "w",
      0.9,
      0,
      null,
      1,
    );
    expect(c.w).toBeGreaterThan(0);
    near(c.x + c.w, 0.6);
  });

  it("produit des dimensions en pixels paires et dans l'image", () => {
    const p = toPixels({ x: 0.1, y: 0.1, w: 0.9, h: 0.9 }, 1279, 721);
    expect(p.width % 2).toBe(0);
    expect(p.height % 2).toBe(0);
    expect(p.left + p.width).toBeLessThanOrEqual(1279);
    expect(p.top + p.height).toBeLessThanOrEqual(721);
    const full = toPixels(FULL, 1279, 721);
    expect(full).toEqual({ left: 0, top: 0, width: 1278, height: 720 });
  });

  it("reconnaît un cadre plein", () => {
    expect(isFull(FULL)).toBe(true);
    expect(isFull({ x: 0, y: 0.1, w: 1, h: 0.8 })).toBe(false);
  });
});

function frame(
  w: number,
  h: number,
  bright: (x: number, y: number) => boolean,
) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = bright(x, y) ? 180 : 4;
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  return { data, width: w, height: h };
}

describe("détection d'image", () => {
  it("trouve la zone utile entre deux bandes noires", () => {
    const img = frame(100, 100, (_, y) => y >= 12 && y < 88);
    const c = detectContent(img)!;
    near(c.x, 0);
    near(c.y, 0.12);
    near(c.w, 1);
    near(c.h, 0.76);
  });

  it("renvoie null pour une image noire et la signale comme noire", () => {
    const img = frame(64, 36, () => false);
    expect(detectContent(img)).toBeNull();
    expect(isBlackFrame(img)).toBe(true);
    expect(isBlackFrame(frame(64, 36, (x) => x > 30))).toBe(false);
  });
});

describe("format", () => {
  it("formate les durées", () => {
    expect(fmtTime(75.44)).toBe("01:15");
    expect(fmtTime(75.44, true)).toBe("01:15.4");
    expect(fmtTime(Infinity)).toBe("00:00");
  });

  it("nomme le fichier à partir du titre", () => {
    expect(slugify("Le Cid – acte I, scène 4")).toBe("le-cid-acte-i-scene-4");
    expect(clipFilename("Révolution française !", "mp4")).toBe(
      "revolution-francaise.mp4",
    );
    expect(clipFilename("  ", "mp4", new Date("2026-11-05T10:20:30Z"))).toBe(
      "extrait-2026-11-05-10-20-30.mp4",
    );
  });
});
