/**
 * Notion-style select chip colors: soft pastel background + dark text.
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

/** Canonical Notion select palette */
export const NOTION_SELECT_COLORS: Record<SelectColorToken, SelectChipStyle> = {
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

/** Preset hexes for ColorPicker / new options (pastel backgrounds) */
export const SELECT_COLOR_PRESETS = [
  NOTION_SELECT_COLORS.gray.background,
  NOTION_SELECT_COLORS.blue.background,
  NOTION_SELECT_COLORS.green.background,
  NOTION_SELECT_COLORS.yellow.background,
  NOTION_SELECT_COLORS.orange.background,
  NOTION_SELECT_COLORS.red.background,
  NOTION_SELECT_COLORS.purple.background,
  NOTION_SELECT_COLORS.pink.background,
  NOTION_SELECT_COLORS.brown.background,
  NOTION_SELECT_COLORS.default.background,
] as const;

/** Pastel bg → token (for seeds / picker values) */
const PASTEL_BG: Record<string, SelectColorToken> = Object.fromEntries(
  (Object.entries(NOTION_SELECT_COLORS) as [SelectColorToken, SelectChipStyle][]).map(
    ([token, s]) => [s.background.toLowerCase(), token]
  )
);

/** Accept CSS HEX in three or six digits. Never persist an incomplete input. */
export function normalizeColorHex(input: string): string | null {
  const hex = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${[...hex].map((digit) => digit + digit).join("")}`;
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
}

export const SELECT_COLOR_NAMES: Record<SelectColorToken, string> = {
  default: "默认", gray: "灰色", brown: "棕色", orange: "橙色", yellow: "黄色",
  green: "绿色", blue: "蓝色", purple: "紫色", pink: "粉色", red: "红色",
};

/** Custom colors are rendered exactly; choose text with WCAG-readable contrast. */
export function selectOptionStyle(raw?: string | null): SelectChipStyle {
  const key = raw?.trim().toLowerCase() ?? "gray";
  if (Object.hasOwn(NOTION_SELECT_COLORS, key)) return NOTION_SELECT_COLORS[key as SelectColorToken];
  const hex = normalizeColorHex(key);
  if (!hex) return NOTION_SELECT_COLORS.gray;
  if (PASTEL_BG[hex]) return NOTION_SELECT_COLORS[PASTEL_BG[hex]];
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return { background: hex, color: luminance > 0.179 ? "#000000" : "#ffffff", swatch: hex };
}

/** Accent dot color for kanban column headers / picker preview. */
export function selectOptionSwatch(color?: string | null): string {
  return selectOptionStyle(color).swatch;
}
