/** HSV uses degrees for hue and fractions (0–1) for saturation and brightness. */
export type HsvColor = { h: number; s: number; v: number };

export function normalizeColorHex(input: string): string | null {
  const hex = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${[...hex].map((digit) => digit + digit).join("")}`;
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
}

export function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function hexToHsv(input: string): HsvColor | null {
  const hex = normalizeColorHex(input);
  if (!hex) return null;
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = 0;
  if (delta) {
    h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex({ h, s, v }: HsvColor): string {
  const hue = ((h % 360) + 360) % 360 / 60;
  const brightness = clampUnit(v), chroma = brightness * clampUnit(s);
  const x = chroma * (1 - Math.abs(hue % 2 - 1)), m = brightness - chroma;
  const channels = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x]
    : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${channels.map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}
