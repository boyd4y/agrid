import type { CSSProperties } from "react";
import type { FormThemeConfig, FormThemePresetId, FormThemeTokens } from "@table/shared";

export type ResolvedFormTheme = Required<
  Pick<
    FormThemeTokens,
    | "background"
    | "question"
    | "answer"
    | "button"
    | "buttonText"
    | "accent"
    | "radius"
    | "font"
  >
>;

export const FORM_THEME_PRESET_META: Record<
  FormThemePresetId,
  { label: string; tokens: ResolvedFormTheme }
> = {
  "notion-light": {
    label: "Notion Light",
    tokens: {
      background: "#F7F6F3",
      question: "#37352F",
      answer: "#37352F",
      button: "#2383E2",
      buttonText: "#FFFFFF",
      accent: "#2383E2",
      radius: "md",
      font: "sans",
    },
  },
  ink: {
    label: "Ink",
    tokens: {
      background: "#FFFFFF",
      question: "#111111",
      answer: "#111111",
      button: "#111111",
      buttonText: "#FFFFFF",
      accent: "#111111",
      radius: "sm",
      font: "sans",
    },
  },
  ocean: {
    label: "Ocean",
    tokens: {
      background: "#EEF5FB",
      question: "#0F2A43",
      answer: "#0F2A43",
      button: "#1D6FA5",
      buttonText: "#FFFFFF",
      accent: "#1D6FA5",
      radius: "md",
      font: "sans",
    },
  },
  sunset: {
    label: "Sunset",
    tokens: {
      background: "#FFF6F0",
      question: "#3D2A22",
      answer: "#3D2A22",
      button: "#E07A5F",
      buttonText: "#FFFFFF",
      accent: "#E07A5F",
      radius: "lg",
      font: "sans",
    },
  },
  midnight: {
    label: "Midnight",
    tokens: {
      background: "#12141A",
      question: "#F3F4F6",
      answer: "#F3F4F6",
      button: "#7C9CFF",
      buttonText: "#0B1020",
      accent: "#7C9CFF",
      radius: "md",
      font: "sans",
    },
  },
};

const RADIUS_PX: Record<NonNullable<FormThemeTokens["radius"]>, string> = {
  sm: "6px",
  md: "12px",
  lg: "18px",
};

export function resolveFormTheme(theme?: FormThemeConfig | null): ResolvedFormTheme {
  const preset = theme?.preset ?? "notion-light";
  const base = FORM_THEME_PRESET_META[preset]?.tokens ?? FORM_THEME_PRESET_META["notion-light"].tokens;
  const o = theme?.overrides ?? {};
  return {
    background: o.background ?? base.background,
    question: o.question ?? base.question,
    answer: o.answer ?? base.answer,
    button: o.button ?? base.button,
    buttonText: o.buttonText ?? base.buttonText,
    accent: o.accent ?? base.accent,
    radius: o.radius ?? base.radius,
    font: o.font ?? base.font,
  };
}

export function formThemeStyle(theme?: FormThemeConfig | null): CSSProperties {
  const t = resolveFormTheme(theme);
  return {
    ["--form-bg" as string]: t.background,
    ["--form-question" as string]: t.question,
    ["--form-answer" as string]: t.answer,
    ["--form-button" as string]: t.button,
    ["--form-button-text" as string]: t.buttonText,
    ["--form-accent" as string]: t.accent,
    ["--form-radius" as string]: RADIUS_PX[t.radius],
    backgroundColor: t.background,
    color: t.question,
    fontFamily:
      t.font === "serif"
        ? 'ui-serif, Georgia, "Times New Roman", serif'
        : 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  };
}
