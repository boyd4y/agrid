/**
 * Notion-style select chip colors: soft pastel background + dark text.
 * Stored option.color may be a token name, a pastel hex, or a legacy saturated hex.
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

const LEGACY_SATURATED: Record<string, SelectColorToken> = {
  "#94a3b8": "gray",
  "#64748b": "gray",
  "#3b82f6": "blue",
  "#2383e2": "blue",
  "#22c55e": "green",
  "#84cc16": "green",
  "#f59e0b": "orange",
  "#ef4444": "red",
  "#eb5757": "red",
  "#8b5cf6": "purple",
  "#ec4899": "pink",
  "#06b6d4": "blue",
  "#37352f": "default",
};

/** Pastel bg → token (for seeds / picker values) */
const PASTEL_BG: Record<string, SelectColorToken> = Object.fromEntries(
  (Object.entries(NOTION_SELECT_COLORS) as [SelectColorToken, SelectChipStyle][]).map(
    ([token, s]) => [s.background.toLowerCase(), token]
  )
);

function normalizeHex(input: string): string {
  const h = input.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(h)) {
    return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  return h;
}

function resolveToken(raw?: string | null): SelectColorToken {
  if (!raw) return "gray";
  const key = raw.trim().toLowerCase();
  if (key in NOTION_SELECT_COLORS) return key as SelectColorToken;
  const hex = normalizeHex(key);
  if (LEGACY_SATURATED[hex]) return LEGACY_SATURATED[hex];
  if (PASTEL_BG[hex]) return PASTEL_BG[hex];
  // Nearest-ish fallback by hue keywords in string
  if (hex.includes("f") && hex.startsWith("#e")) return "red";
  return "gray";
}

/** Style for select/multi_select chips (light bg + dark text). */
export function selectOptionStyle(color?: string | null): SelectChipStyle {
  return NOTION_SELECT_COLORS[resolveToken(color)];
}

/** Accent dot color for kanban column headers / picker preview. */
export function selectOptionSwatch(color?: string | null): string {
  return selectOptionStyle(color).swatch;
}
