/** Agrid Design Tokens — mirror of CSS variables in index.css */
export const agridColors = {
  blue: "#2383e2",
  blueSoft: "#d3e5ef",
  purple: "#9065b0",
  purpleSoft: "#e8deee",
  green: "#4dab9a",
  greenSoft: "#d3ead9",
  yellow: "#c29343",
  yellowSoft: "#f1e3b7",
  red: "#e03e3e",
  redSoft: "#fdeeee",
  ink: "#37352f",
  inkMuted: "#787774",
  paper: "#fffef9",
  cream: "#f7f6f3",
} as const;

export const agridRadius = {
  xs: "0.25rem",
  sm: "0.375rem",
  md: "0.5rem",
  lg: "0.75rem",
  xl: "1rem",
  "2xl": "1.25rem",
  full: "9999px",
} as const;

export const agridSpace = {
  0: "0",
  1: "0.25rem",
  2: "0.5rem",
  3: "0.75rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
  8: "2rem",
  10: "2.5rem",
  12: "3rem",
  16: "4rem",
  20: "5rem",
  24: "6rem",
} as const;

export const agridType = {
  fontSans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
  fontMono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  xs: "0.75rem",
  sm: "0.875rem",
  base: "0.9375rem",
  lg: "1.125rem",
  xl: "1.25rem",
  "2xl": "1.5rem",
  "3xl": "1.875rem",
  "4xl": "2.25rem",
} as const;
