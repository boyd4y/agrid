import { ink } from "./palette";

/** Notioly-style flat figures & desk props — people+objects first */

type FigProps = {
  x: number;
  y: number;
  s?: number;
  tone?: string;
  hair?: string;
  flip?: boolean;
};

const skin = "#F5E6D3";

/** Person typing on a laptop (sitting) */
export function FlatPersonTyping({
  x,
  y,
  s = 1,
  tone = ink.softBlue,
  hair = ink.fg,
  flip = false,
}: FigProps) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
      {/* chair */}
      <rect x="22" y="58" width="12" height="52" rx="5" fill={ink.cream} stroke={ink.border} strokeWidth="1.1" />
      <ellipse cx="28" cy="112" rx="18" ry="5" fill={ink.fg} opacity="0.06" />
      {/* legs */}
      <rect x="8" y="88" width="14" height="28" rx="6" fill={ink.fg} opacity="0.45" />
      <rect x="28" y="88" width="14" height="28" rx="6" fill={ink.fg} opacity="0.45" />
      {/* torso */}
      <rect x="4" y="42" width="44" height="48" rx="16" fill={tone} stroke={ink.border} strokeWidth="1.2" />
      {/* head */}
      <circle cx="26" cy="26" r="16" fill={skin} stroke={ink.border} strokeWidth="1.2" />
      <path
        d="M12 24c3-14 26-16 30-2-8-5-14-3-18 2-4 0-9-2-12 0z"
        fill={hair}
        opacity="0.88"
      />
      {/* arm to laptop */}
      <rect x="40" y="58" width="36" height="11" rx="5.5" fill={tone} stroke={ink.border} strokeWidth="1.1" />
      {/* laptop */}
      <rect x="58" y="66" width="42" height="28" rx="4" fill={ink.paper} stroke={ink.border} strokeWidth="1.2" />
      <rect x="62" y="70" width="34" height="18" rx="2" fill={ink.softBlue} opacity="0.85" />
      <rect x="54" y="94" width="52" height="5" rx="2" fill={ink.cream} stroke={ink.border} strokeWidth="1" />
    </g>
  );
}

/** Standing person holding sticky / gesturing */
export function FlatPersonStanding({
  x,
  y,
  s = 1,
  tone = ink.softPurple,
  hair = ink.fg,
  flip = false,
}: FigProps) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
      <ellipse cx="22" cy="118" rx="20" ry="5" fill={ink.fg} opacity="0.06" />
      <circle cx="22" cy="18" r="15" fill={skin} stroke={ink.border} strokeWidth="1.2" />
      <path d="M8 16c4-12 24-12 28 1-7-4-13-2-16 3-4 0-8-2-12-4z" fill={hair} opacity="0.88" />
      <rect x="6" y="36" width="32" height="46" rx="14" fill={tone} stroke={ink.border} strokeWidth="1.2" />
      {/* arms */}
      <rect x="-8" y="42" width="14" height="30" rx="7" fill={tone} stroke={ink.border} strokeWidth="1.1" transform="rotate(-22 -1 57)" />
      <rect x="34" y="40" width="14" height="32" rx="7" fill={tone} stroke={ink.border} strokeWidth="1.1" transform="rotate(28 41 56)" />
      {/* sticky in hand */}
      <rect x="42" y="28" width="22" height="20" rx="3" fill={ink.softYellow} stroke={ink.border} strokeWidth="1" transform="rotate(12 53 38)" />
      <rect x="46" y="34" width="12" height="2.5" rx="1" fill={ink.fg} opacity="0.2" transform="rotate(12 53 38)" />
      {/* legs */}
      <rect x="10" y="80" width="11" height="34" rx="5.5" fill={ink.fg} opacity="0.48" />
      <rect x="24" y="80" width="11" height="34" rx="5.5" fill={ink.fg} opacity="0.48" />
    </g>
  );
}

/** Seated person (no laptop) — reading / chatting pose */
export function FlatPersonSeated({
  x,
  y,
  s = 1,
  tone = ink.softBlue,
  hair = ink.fg,
  flip = false,
}: FigProps) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
      <rect x="34" y="48" width="12" height="56" rx="5" fill={ink.cream} stroke={ink.border} strokeWidth="1.1" />
      <circle cx="24" cy="28" r="15" fill={skin} stroke={ink.border} strokeWidth="1.2" />
      <path d="M10 26c3-13 25-15 29-2-7-5-13-3-17 2-4 0-9-2-12 0z" fill={hair} opacity="0.88" />
      <rect x="4" y="44" width="42" height="46" rx="16" fill={tone} stroke={ink.border} strokeWidth="1.2" />
      <rect x="38" y="56" width="32" height="11" rx="5.5" fill={tone} stroke={ink.border} strokeWidth="1.1" />
      <rect x="8" y="86" width="13" height="28" rx="6" fill={ink.fg} opacity="0.45" />
      <rect x="26" y="86" width="13" height="28" rx="6" fill={ink.fg} opacity="0.45" />
    </g>
  );
}

/** Person watering a plant */
export function FlatPersonWatering({
  x,
  y,
  s = 1,
  tone = ink.softGreen,
  hair = "#5C4A3A",
  flip = false,
}: FigProps) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
      <ellipse cx="20" cy="118" rx="18" ry="5" fill={ink.fg} opacity="0.06" />
      <circle cx="20" cy="18" r="14" fill={skin} stroke={ink.border} strokeWidth="1.2" />
      <path d="M8 16c3-11 22-11 26 1-6-3-12-1-15 3-3 0-7-2-11-4z" fill={hair} opacity="0.9" />
      <rect x="5" y="34" width="30" height="44" rx="13" fill={tone} stroke={ink.border} strokeWidth="1.2" />
      <rect x="8" y="76" width="10" height="32" rx="5" fill={ink.fg} opacity="0.48" />
      <rect x="22" y="76" width="10" height="32" rx="5" fill={ink.fg} opacity="0.48" />
      {/* arm + watering can */}
      <rect x="30" y="42" width="28" height="10" rx="5" fill={tone} stroke={ink.border} strokeWidth="1.1" transform="rotate(-18 44 47)" />
      <g transform="translate(52 28) rotate(-25)">
        <rect x="0" y="10" width="22" height="14" rx="4" fill={ink.softBlue} stroke={ink.border} strokeWidth="1.1" />
        <path d="M22 14h10a4 4 0 010 8h-4" fill="none" stroke={ink.border} strokeWidth="1.4" strokeLinecap="round" />
        <path d="M4 10 V4 h8 v6" fill={ink.softBlue} stroke={ink.border} strokeWidth="1.1" />
        <path d="M2 24c2 6 6 10 10 14M8 24c1 5 4 9 8 12" stroke={ink.softBlue} strokeWidth="1.6" strokeLinecap="round" opacity="0.9" />
      </g>
    </g>
  );
}

/** Tiny robot / agent */
export function FlatAgent({
  x,
  y,
  s = 1,
  tone = ink.softPurple,
}: Omit<FigProps, "hair" | "flip">) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="20" cy="78" rx="16" ry="4" fill={ink.fg} opacity="0.06" />
      <rect x="4" y="10" width="32" height="26" rx="9" fill={tone} stroke={ink.border} strokeWidth="1.2" />
      <circle cx="14" cy="22" r="2.4" fill={ink.fg} opacity="0.65" />
      <circle cx="26" cy="22" r="2.4" fill={ink.fg} opacity="0.65" />
      <path d="M14 28h12" stroke={ink.fg} strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
      <line x1="20" y1="10" x2="20" y2="2" stroke={ink.border} strokeWidth="1.3" />
      <circle cx="20" cy="1" r="2.8" fill={ink.softYellow} stroke={ink.border} strokeWidth="1" />
      <rect x="10" y="38" width="20" height="24" rx="8" fill={ink.softBlue} stroke={ink.border} strokeWidth="1.2" />
      <rect x="-2" y="40" width="12" height="16" rx="5" fill={tone} stroke={ink.border} strokeWidth="1.1" />
      <rect x="30" y="40" width="12" height="16" rx="5" fill={tone} stroke={ink.border} strokeWidth="1.1" />
      <rect x="12" y="60" width="7" height="16" rx="3.5" fill={ink.muted} opacity="0.55" />
      <rect x="21" y="60" width="7" height="16" rx="3.5" fill={ink.muted} opacity="0.55" />
    </g>
  );
}

export function DeskPlant({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="10" y="36" width="28" height="22" rx="5" fill={ink.softRed} stroke={ink.border} strokeWidth="1.1" />
      <ellipse cx="24" cy="28" rx="18" ry="14" fill={ink.softGreen} stroke={ink.border} strokeWidth="1.1" />
      <ellipse cx="12" cy="20" rx="10" ry="9" fill={ink.softGreen} stroke={ink.border} strokeWidth="1" opacity="0.95" />
      <ellipse cx="36" cy="18" rx="9" ry="8" fill={ink.softGreen} stroke={ink.border} strokeWidth="1" opacity="0.9" />
      <ellipse cx="24" cy="12" rx="8" ry="7" fill={ink.softGreen} stroke={ink.border} strokeWidth="1" opacity="0.85" />
    </g>
  );
}

export function CoffeeMug({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="2" y="10" width="20" height="18" rx="5" fill={ink.softYellow} stroke={ink.border} strokeWidth="1.2" />
      <path d="M22 14h7a5 5 0 010 10h-7" fill="none" stroke={ink.border} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 5c0 3.5 2.5 3.5 2.5 7M14 4c0 3.5 2.5 3.5 2.5 7" stroke={ink.muted} strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
    </g>
  );
}

export function StickyStack({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="6" y="8" width="40" height="34" rx="5" fill={ink.softBlue} stroke={ink.border} strokeWidth="1" transform="rotate(7 26 25)" />
      <rect x="0" y="0" width="40" height="34" rx="5" fill={ink.softYellow} stroke={ink.border} strokeWidth="1.2" />
      <rect x="7" y="9" width="26" height="3.5" rx="1.5" fill={ink.fg} opacity="0.16" />
      <rect x="7" y="16" width="20" height="3.5" rx="1.5" fill={ink.muted} opacity="0.35" />
      <rect x="7" y="23" width="22" height="3.5" rx="1.5" fill={ink.muted} opacity="0.28" />
    </g>
  );
}

export function BookStack({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="0" y="22" width="48" height="12" rx="2.5" fill={ink.softBlue} stroke={ink.border} strokeWidth="1.1" />
      <rect x="4" y="12" width="44" height="12" rx="2.5" fill={ink.softPurple} stroke={ink.border} strokeWidth="1.1" />
      <rect x="2" y="2" width="46" height="12" rx="2.5" fill={ink.softGreen} stroke={ink.border} strokeWidth="1.1" />
    </g>
  );
}

export function PaperPlane({ x, y, s = 1, rotate = -18 }: { x: number; y: number; s?: number; rotate?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${s})`}>
      <path
        d="M0 14 L42 0 L24 32 L18 18 Z"
        fill={ink.paper}
        stroke={ink.border}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M18 18 L42 0" stroke={ink.border} strokeWidth="1" opacity="0.45" />
    </g>
  );
}

export function DeskLamp({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="20" cy="56" rx="16" ry="5" fill={ink.cream} stroke={ink.border} strokeWidth="1.1" />
      <path d="M20 50 C20 32 40 28 40 14" fill="none" stroke={ink.border} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M30 6 L48 16 L38 26 Z" fill={ink.softYellow} stroke={ink.border} strokeWidth="1.2" strokeLinejoin="round" />
    </g>
  );
}

export function Balloon({ x, y, s = 1, tone = ink.softRed }: { x: number; y: number; s?: number; tone?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="14" cy="16" rx="14" ry="16" fill={tone} stroke={ink.border} strokeWidth="1.2" />
      <path d="M14 32c0 6 4 10 4 16" stroke={ink.border} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <path d="M10 32h8l-4 5z" fill={tone} stroke={ink.border} strokeWidth="1" />
    </g>
  );
}

export function Notebook({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="0" y="0" width="36" height="46" rx="4" fill={ink.softPurple} stroke={ink.border} strokeWidth="1.2" />
      <rect x="6" y="0" width="30" height="46" rx="3" fill={ink.paper} stroke={ink.border} strokeWidth="1" />
      <rect x="10" y="10" width="18" height="3" rx="1.5" fill={ink.muted} opacity="0.35" />
      <rect x="10" y="18" width="14" height="3" rx="1.5" fill={ink.muted} opacity="0.28" />
      <rect x="10" y="26" width="16" height="3" rx="1.5" fill={ink.muted} opacity="0.28" />
    </g>
  );
}

export function ChatBubble({ x, y, s = 1, tone = ink.softBlue }: { x: number; y: number; s?: number; tone?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="0" y="0" width="56" height="36" rx="12" fill={tone} stroke={ink.border} strokeWidth="1.2" />
      <path d="M14 36l6-8h8" fill={tone} stroke={ink.border} strokeWidth="1.1" strokeLinejoin="round" />
      <circle cx="18" cy="18" r="2.5" fill={ink.fg} opacity="0.25" />
      <circle cx="28" cy="18" r="2.5" fill={ink.fg} opacity="0.25" />
      <circle cx="38" cy="18" r="2.5" fill={ink.fg} opacity="0.25" />
    </g>
  );
}
