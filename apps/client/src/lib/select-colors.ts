import i18n from "@/i18n";
import { normalizeColorHex } from "./color";
export { normalizeColorHex } from "./color";
/**
 * Select chip colors: soft pastel background + dark text.
 * Stored option.color may be a token name or a custom HEX color.
 */

export type SelectColorToken =
  | "default"
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red";

export type SelectChipStyle = {
  background: string;
  color: string;
  /** Accent for dots / picker swatches (slightly stronger than bg) */
  swatch: string;
};

/** Canonical select chip pastel palette */
export const SELECT_COLORS: Record<SelectColorToken, SelectChipStyle> = {
  default: { background: "#f1f1ef", color: "#787774", swatch: "#d3d1cb" },
  gray: { background: "#ebeced", color: "#5a5a57", swatch: "#9b9a97" },
  brown: { background: "#eee0da", color: "#64473a", swatch: "#a27763" },
  orange: { background: "#fadec9", color: "#9a3412", swatch: "#d9730d" },
  yellow: { background: "#fdecc8", color: "#854d0e", swatch: "#dfab01" },
  green: { background: "#dbeddb", color: "#0f7b6c", swatch: "#448361" },
  blue: { background: "#d3e5ef", color: "#0b6e99", swatch: "#337ea9" },
  purple: { background: "#e8deee", color: "#6940a5", swatch: "#9065b0" },
  pink: { background: "#f5e0e9", color: "#ad1a72", swatch: "#c14c8a" },
  red: { background: "#ffe2dd", color: "#c4554d", swatch: "#e03e3e" },
};

/** Explicit names and vivid preset colors; persisted legacy tokens stay unchanged. */
export const SELECT_COLOR_PALETTE: readonly { token: SelectColorToken; hex: string }[] = [
  { token: "gray", hex: "#64748b" },
  { token: "blue", hex: "#3b82f6" },
  { token: "green", hex: "#22c55e" },
  { token: "yellow", hex: "#facc15" },
  { token: "orange", hex: "#f97316" },
  { token: "red", hex: "#ef4444" },
  { token: "purple", hex: "#8b5cf6" },
  { token: "pink", hex: "#ec4899" },
  { token: "brown", hex: "#a16207" },
  { token: "default", hex: "#f1f1ef" },
];

/** HEX defaults for newly created select options. */
export const SELECT_COLOR_PRESETS = SELECT_COLOR_PALETTE.map(({ hex }) => hex);

/** Pastel bg → token (for seeds / picker values) */
const PASTEL_BG: Record<string, SelectColorToken> = Object.fromEntries(
  (Object.entries(SELECT_COLORS) as [SelectColorToken, SelectChipStyle][]).map(
    ([token, s]) => [s.background.toLowerCase(), token]
  )
);

const SELECT_COLOR_KEYS: SelectColorToken[] = [
  "default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red",
];

/** Live color names — reads current i18n language. */
export const SELECT_COLOR_NAMES = Object.defineProperties({} as Record<SelectColorToken, string>,
  Object.fromEntries(SELECT_COLOR_KEYS.map((color) => [color, { enumerable: true, get: () => i18n.t(`table:colors.${color}`) }])));

/** Custom colors are rendered exactly; choose text with WCAG-readable contrast. */
export function selectOptionStyle(raw?: string | null): SelectChipStyle {
  const key = raw?.trim().toLowerCase() ?? "gray";
  if (Object.hasOwn(SELECT_COLORS, key)) return SELECT_COLORS[key as SelectColorToken];
  const hex = normalizeColorHex(key);
  if (!hex) return SELECT_COLORS.gray;
  if (PASTEL_BG[hex]) return SELECT_COLORS[PASTEL_BG[hex]];
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return { background: hex, color: luminance > 0.179 ? "#000000" : "#ffffff", swatch: hex };
}

/** Accent dot color for kanban column headers / picker preview. */
export function selectOptionSwatch(color?: string | null): string {
  return selectOptionStyle(color).swatch;
}
