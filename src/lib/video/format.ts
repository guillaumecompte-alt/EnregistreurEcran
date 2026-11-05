/** 75.4 → "01:15" ; avec `tenths`, "01:15.4". */
export function fmtTime(s: number, tenths = false): string {
  if (!isFinite(s) || s < 0) s = 0;
  const total = tenths ? Math.round(s * 10) / 10 : Math.floor(s);
  const m = Math.floor(total / 60);
  const r = total - m * 60;
  const sec = tenths
    ? r.toFixed(1).padStart(4, "0")
    : String(Math.floor(r)).padStart(2, "0");
  return `${String(m).padStart(2, "0")}:${sec}`;
}

/** "Le Cid – acte I, scène 4" → "le-cid-acte-i-scene-4" */
export function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function clipFilename(
  title: string,
  ext: string,
  now = new Date(),
): string {
  const slug = slugify(title);
  if (slug) return `${slug}.${ext}`;
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `extrait-${stamp}.${ext}`;
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}
