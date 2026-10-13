import { ink } from "./palette";
import { SoftShadowDefs } from "./SvgDefs";
import {
  FlatPersonTyping,
  FlatAgent,
  DeskPlant,
  CoffeeMug,
  StickyStack,
  BookStack,
  Notebook,
  ChatBubble,
} from "./FlatPeople";

type Props = { className?: string };

/** Human ↔ shared commands ↔ agent — muted professional scene */
export function CommandLayerArt({ className }: Props) {
  return (
    <svg
      viewBox="0 0 960 440"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <SoftShadowDefs prefix="cl" />

      <rect width="960" height="440" rx="20" fill={ink.cream} />
      <ellipse cx="100" cy="60" rx="140" ry="70" fill={ink.softYellow} opacity="0.45" />
      <ellipse cx="860" cy="70" rx="130" ry="70" fill={ink.softPurple} opacity="0.35" />

      <FlatPersonTyping x={70} y={170} s={1.2} tone={ink.softBlue} />
      <CoffeeMug x={210} y={290} s={1} />
      <StickyStack x={50} y={310} s={0.75} />
      <DeskPlant x={40} y={110} s={0.85} />
      <Notebook x={240} y={310} s={0.7} />

      {/* Shared hub */}
      <g filter="url(#cl-soft2)">
        <rect
          x="380"
          y={145}
          width="200"
          height={150}
          rx="14"
          fill={ink.paper}
          stroke={ink.border}
          strokeWidth="1.2"
        />
        <text
          x="480"
          y="168"
          textAnchor="middle"
          fontSize="11"
          fontFamily="system-ui, sans-serif"
          fill={ink.muted}
        >
          /api/commands
        </text>
        {[
          { y: 184, c: ink.softBlue, label: "updateCell" },
          { y: 224, c: ink.softGreen, label: "moveCard" },
          { y: 264, c: ink.softPurple, label: "queryRows" },
        ].map((row) => (
          <g key={row.label}>
            <rect
              x="400"
              y={row.y}
              width="160"
              height="28"
              rx="8"
              fill={row.c}
              stroke={ink.border}
              strokeWidth="0.9"
            />
            <text
              x="480"
              y={row.y + 18}
              textAnchor="middle"
              fontSize="11"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fill={ink.fg}
              opacity="0.7"
            >
              {row.label}
            </text>
          </g>
        ))}
      </g>

      <path
        d="M280 220 H380"
        stroke={ink.border}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="5 6"
      />
      <path
        d="M580 220 H690"
        stroke={ink.border}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="5 6"
      />

      <ChatBubble x={430} y={70} s={0.75} tone={ink.softGreen} />

      <FlatAgent x={730} y={175} s={1.25} tone={ink.softPurple} />
      <BookStack x={690} y={320} s={0.85} />
    </svg>
  );
}
