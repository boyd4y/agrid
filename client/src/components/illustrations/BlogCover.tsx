import { ink } from "./palette";
import { SoftShadowDefs } from "./SvgDefs";

export type BlogCoverId =
  | "same-command-layer"
  | "ai-native-tables"
  | "100k-rows-keyset"
  | "notion-style-workspace"
  | "multi-harness-chat"
  | "mcp-five-minutes";

type Props = {
  id: BlogCoverId;
  className?: string;
};

/** Per-post Notion-style cover art (pastel blobs + grids). */
export function BlogCover({ id, className }: Props) {
  const common = {
    viewBox: "0 0 640 360",
    fill: "none" as const,
    xmlns: "http://www.w3.org/2000/svg",
    className,
    role: "img" as const,
    "aria-label": `Cover illustration for ${id}`,
  };

  switch (id) {
    case "same-command-layer":
      return <SameCommand {...common} />;
    case "ai-native-tables":
      return <AiNative {...common} />;
    case "100k-rows-keyset":
      return <Keyset {...common} />;
    case "notion-style-workspace":
      return <NotionWorkspace {...common} />;
    case "multi-harness-chat":
      return <MultiHarness {...common} />;
    case "mcp-five-minutes":
      return <McpFive {...common} />;
  }
}

type SvgProps = {
  viewBox: string;
  fill: "none";
  xmlns: string;
  className?: string;
  role: "img";
  "aria-label": string;
};

function SoftBlobs({
  a,
  b,
  c,
}: {
  a: string;
  b: string;
  c: string;
}) {
  return (
    <>
      <ellipse cx="90" cy="70" rx="110" ry="78" fill={a} opacity="0.95" />
      <ellipse cx="540" cy="300" rx="130" ry="90" fill={b} opacity="0.85" />
      <ellipse cx="580" cy="60" rx="80" ry="55" fill={c} opacity="0.75" />
    </>
  );
}

function SameCommand(p: SvgProps) {
  return (
    <svg {...p}>
      <SoftShadowDefs prefix="bc-cmd" />
      <rect width="100%" height="100%" fill={ink.cream} />
      <SoftBlobs a={ink.softBlue} b={ink.softPurple} c={ink.softYellow} />
      <g filter="url(#bc-cmd-soft)">
        {[0, 1, 2].map((i) => (
          <rect
            key={i}
            x={140 + i * 28}
            y={90 + i * 36}
            width={320}
            height={72}
            rx={16}
            fill={ink.paper}
            stroke={ink.border}
            strokeWidth="1.4"
            opacity={1 - i * 0.08}
          />
        ))}
        <rect x="168" y="112" width="120" height="10" rx="4" fill={ink.fg} opacity="0.16" />
        <rect x="168" y="132" width="200" height="8" rx="3" fill={ink.muted} opacity="0.28" />
        <rect x="196" y="148" width="88" height="22" rx="11" fill={ink.softGreen} stroke={ink.border} strokeWidth="0.8" />
        <text x="212" y="163" fontSize="11" fill={ink.fg} opacity="0.55" fontFamily="system-ui,sans-serif">
          updateCell
        </text>
      </g>
      {/* three shells pointing to one stack */}
      {["UI", "MCP", "agt_"].map((label, i) => (
        <g key={label} transform={`translate(${480}, ${100 + i * 70})`}>
          <rect width="100" height="44" rx="12" fill={ink.paper} stroke={ink.border} strokeWidth="1.2" filter="url(#bc-cmd-soft2)" />
          <text x="50" y="28" textAnchor="middle" fontSize="13" fill={ink.fg} opacity="0.55" fontFamily="system-ui,sans-serif">
            {label}
          </text>
          <path d="M0 22 H-36" stroke={ink.muted} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.5" />
        </g>
      ))}
    </svg>
  );
}

function AiNative(p: SvgProps) {
  return (
    <svg {...p}>
      <SoftShadowDefs prefix="bc-ai" />
      <rect width="100%" height="100%" fill={ink.cream} />
      <SoftBlobs a={ink.softYellow} b={ink.softGreen} c={ink.softBlue} />
      <g filter="url(#bc-ai-soft)">
        <rect x="80" y="70" width="300" height="220" rx="18" fill={ink.paper} stroke={ink.border} strokeWidth="1.4" />
        <path d="M80 98c0-8 6.5-15 15-15h270c8.3 0 15 6.7 15 15v18H80V98z" fill={ink.softBlue} />
        {[0, 1, 2, 3].map((r) => (
          <g key={r}>
            <rect x="100" y={130 + r * 36} width="90" height="8" rx="3" fill={ink.muted} opacity="0.28" />
            <rect
              x="210"
              y={126 + r * 36}
              width="56"
              height="18"
              rx="9"
              fill={[ink.softGreen, ink.softYellow, ink.softRed, ink.softPurple][r]}
              stroke={ink.border}
              strokeWidth="0.8"
            />
            <circle cx="300" cy={135 + r * 36} r="10" fill={[ink.softBlue, ink.softPurple, ink.softGreen, ink.softYellow][r]} stroke={ink.border} strokeWidth="0.8" />
          </g>
        ))}
      </g>
      {/* agent avatar */}
      <g filter="url(#bc-ai-float)" transform="translate(420 110)">
        <rect width="140" height="160" rx="20" fill={ink.paper} stroke={ink.border} strokeWidth="1.3" />
        <circle cx="70" cy="58" r="28" fill={ink.softPurple} stroke={ink.border} strokeWidth="1.1" />
        <text x="70" y="64" textAnchor="middle" fontSize="18" fill={ink.fg} opacity="0.5" fontFamily="system-ui,sans-serif">
          A
        </text>
        <rect x="28" y="100" width="84" height="8" rx="3" fill={ink.muted} opacity="0.3" />
        <rect x="36" y="118" width="68" height="8" rx="3" fill={ink.muted} opacity="0.22" />
        <rect x="40" y="140" width="60" height="22" rx="11" fill={ink.softGreen} stroke={ink.border} strokeWidth="0.8" />
      </g>
    </svg>
  );
}

function Keyset(p: SvgProps) {
  return (
    <svg {...p}>
      <SoftShadowDefs prefix="bc-ks" />
      <rect width="100%" height="100%" fill={ink.cream} />
      <SoftBlobs a={ink.softGreen} b={ink.softBlue} c={ink.softYellow} />
      <g filter="url(#bc-ks-soft)">
        <rect x="100" y="48" width="440" height="264" rx="18" fill={ink.paper} stroke={ink.border} strokeWidth="1.4" />
        {/* many faint rows */}
        {Array.from({ length: 14 }).map((_, r) => (
          <g key={r} opacity={r >= 4 && r <= 8 ? 1 : 0.22}>
            <line
              x1="120"
              y1={72 + r * 16}
              x2="520"
              y2={72 + r * 16}
              stroke={ink.border}
              strokeWidth="1"
            />
            <rect x="128" y={66 + r * 16} width={40 + (r % 5) * 18} height="6" rx="2" fill={ink.muted} opacity="0.35" />
          </g>
        ))}
        {/* window highlight */}
        <rect
          x="112"
          y={64 + 4 * 16}
          width="416"
          height={5 * 16 + 8}
          rx="10"
          fill={ink.softYellow}
          opacity="0.45"
          stroke={ink.yellowMark}
          strokeWidth="1.2"
        />
        <text x="320" y="320" textAnchor="middle" fontSize="12" fill={ink.fg} opacity="0.45" fontFamily="system-ui,sans-serif">
          keyset window · no OFFSET
        </text>
      </g>
    </svg>
  );
}

function NotionWorkspace(p: SvgProps) {
  return (
    <svg {...p}>
      <SoftShadowDefs prefix="bc-nw" />
      <rect width="100%" height="100%" fill={ink.cream} />
      <SoftBlobs a={ink.softPurple} b={ink.softYellow} c={ink.softRed} />
      <g filter="url(#bc-nw-soft)">
        <rect x="70" y="80" width="260" height="200" rx="18" fill={ink.paper} stroke={ink.border} strokeWidth="1.4" />
        <rect x="94" y="108" width="140" height="12" rx="4" fill={ink.fg} opacity="0.14" />
        <rect x="94" y="136" width="200" height="8" rx="3" fill={ink.muted} opacity="0.28" />
        <rect x="94" y="156" width="180" height="8" rx="3" fill={ink.muted} opacity="0.22" />
        <rect x="94" y="176" width="160" height="8" rx="3" fill={ink.muted} opacity="0.18" />
        {/* sticky */}
        <g transform="translate(300 70) rotate(8)">
          <rect width="100" height="100" rx="12" fill={ink.softYellow} stroke={ink.border} strokeWidth="1.1" filter="url(#bc-nw-soft2)" />
          <rect x="16" y="24" width="68" height="7" rx="2" fill={ink.fg} opacity="0.2" />
          <rect x="16" y="40" width="52" height="6" rx="2" fill={ink.muted} opacity="0.35" />
        </g>
        {/* left rail hint */}
        <rect x="400" y="90" width="160" height="180" rx="16" fill={ink.paper} stroke={ink.border} strokeWidth="1.3" filter="url(#bc-nw-soft2)" />
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x="420" y={118 + i * 32} width={i === 1 ? 100 : 80} height="14" rx="7" fill={i === 1 ? ink.softBlue : ink.cream} stroke={ink.border} strokeWidth="0.7" />
        ))}
      </g>
    </svg>
  );
}

function MultiHarness(p: SvgProps) {
  const chips = [
    { label: "Codex", fill: ink.softGreen },
    { label: "Claude", fill: ink.softPurple },
    { label: "Pi", fill: ink.softYellow },
  ];
  return (
    <svg {...p}>
      <SoftShadowDefs prefix="bc-mh" />
      <rect width="100%" height="100%" fill={ink.cream} />
      <SoftBlobs a={ink.softBlue} b={ink.softGreen} c={ink.softPurple} />
      <g filter="url(#bc-mh-soft)">
        <rect x="100" y="60" width="440" height="240" rx="20" fill={ink.paper} stroke={ink.border} strokeWidth="1.4" />
        {/* harness chips */}
        {chips.map((c, i) => (
          <g key={c.label} transform={`translate(${130 + i * 130}, 88)`}>
            <rect width="110" height="36" rx="18" fill={c.fill} stroke={ink.border} strokeWidth="1" />
            <text x="55" y="23" textAnchor="middle" fontSize="13" fill={ink.fg} opacity="0.55" fontFamily="system-ui,sans-serif">
              {c.label}
            </text>
          </g>
        ))}
        {/* chat bubbles */}
        <rect x="140" y="150" width="220" height="48" rx="16" fill={ink.softBlue} opacity="0.7" />
        <rect x="280" y="214" width="200" height="48" rx="16" fill={ink.softGreen} opacity="0.65" />
        <circle cx="160" cy="174" r="12" fill={ink.paper} stroke={ink.border} strokeWidth="0.8" />
        <circle cx="460" cy="238" r="12" fill={ink.softPurple} stroke={ink.border} strokeWidth="0.8" />
      </g>
    </svg>
  );
}

function McpFive(p: SvgProps) {
  return (
    <svg {...p}>
      <SoftShadowDefs prefix="bc-mcp" />
      <rect width="100%" height="100%" fill={ink.cream} />
      <SoftBlobs a={ink.softYellow} b={ink.softRed} c={ink.softBlue} />
      <g filter="url(#bc-mcp-soft)">
        {/* left: Cursor-ish panel */}
        <rect x="70" y="70" width="200" height="220" rx="18" fill={ink.paper} stroke={ink.border} strokeWidth="1.4" />
        <rect x="90" y="96" width="100" height="10" rx="4" fill={ink.fg} opacity="0.14" />
        <rect x="90" y="124" width="140" height="28" rx="8" fill={ink.softBlue} stroke={ink.border} strokeWidth="0.8" />
        <text x="160" y="143" textAnchor="middle" fontSize="11" fill={ink.fg} opacity="0.5" fontFamily="system-ui,sans-serif">
          @table/mcp
        </text>
        <rect x="90" y="168" width="120" height="8" rx="3" fill={ink.muted} opacity="0.28" />
        <rect x="90" y="188" width="100" height="8" rx="3" fill={ink.muted} opacity="0.22" />
        {/* cable */}
        <path
          d="M270 180 C320 180, 320 180, 370 180"
          stroke={ink.fg}
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.25"
        />
        <circle cx="320" cy="180" r="10" fill={ink.softYellow} stroke={ink.border} strokeWidth="1.1" />
        {/* right: board */}
        <rect x="370" y="70" width="200" height="220" rx="18" fill={ink.paper} stroke={ink.border} strokeWidth="1.4" />
        {[0, 1].map((c) => (
          <g key={c}>
            <rect x={390 + c * 80} y="100" width="64" height="150" rx="12" fill={ink.cream} stroke={ink.border} strokeWidth="1" />
            <rect x={400 + c * 80} y="112" width="44" height="8" rx="3" fill={[ink.softGreen, ink.softPurple][c]} />
            <rect x={398 + c * 80} y="132" width="48" height="36" rx="8" fill={ink.paper} stroke={ink.border} strokeWidth="0.8" />
          </g>
        ))}
      </g>
    </svg>
  );
}
