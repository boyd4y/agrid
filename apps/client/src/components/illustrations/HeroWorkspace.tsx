import { ink } from "./palette";
import { SoftShadowDefs } from "./SvgDefs";
import {
  FlatPersonTyping,
  FlatPersonStanding,
  FlatAgent,
  DeskPlant,
  CoffeeMug,
  StickyStack,
  BookStack,
  DeskLamp,
  Notebook,
  ChatBubble,
} from "./FlatPeople";

type Props = { className?: string };

/** Hero: restrained adult Notioly — professional desk, muted tones, no candy blobs */
export function HeroWorkspace({ className }: Props) {
  return (
    <svg
      viewBox="0 0 800 480"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <SoftShadowDefs prefix="hw" />

      {/* Quiet paper field — one soft wash only */}
      <rect width="800" height="480" rx="24" fill={ink.cream} />
      <ellipse cx="120" cy="80" rx="160" ry="90" fill={ink.softYellow} opacity="0.55" />
      <ellipse cx="700" cy="100" rx="140" ry="80" fill={ink.softBlue} opacity="0.4" />

      {/* Floor shadow */}
      <ellipse cx="400" cy="420" rx="280" ry="18" fill={ink.fg} opacity="0.04" />

      {/* Desk surface */}
      <g filter="url(#hw-soft)">
        <rect
          x="140"
          y="310"
          width="520"
          height="22"
          rx="6"
          fill={ink.wood}
          stroke={ink.border}
          strokeWidth="1.1"
        />
        <rect x="168" y="332" width="14" height="48" rx="3" fill={ink.slate} opacity="0.7" />
        <rect x="618" y="332" width="14" height="48" rx="3" fill={ink.slate} opacity="0.7" />
      </g>

      {/* Monitor / sheet — restrained UI accent */}
      <g filter="url(#hw-soft2)">
        <rect
          x="290"
          y="168"
          width="220"
          height="142"
          rx="10"
          fill={ink.paper}
          stroke={ink.border}
          strokeWidth="1.15"
        />
        <rect x="290" y="168" width="220" height="28" rx="10" fill={ink.softBlue} opacity="0.85" />
        <rect x="290" y="188" width="220" height="8" fill={ink.softBlue} opacity="0.85" />
        {[0, 1, 2, 3].map((r) => (
          <g key={r}>
            <rect x="308" y={214 + r * 22} width="72" height="5" rx="2" fill={ink.muted} opacity="0.28" />
            <rect
              x="392"
              y={211 + r * 22}
              width="44"
              height="11"
              rx="5"
              fill={[ink.softGreen, ink.softYellow, ink.softBlue, ink.softPurple][r]}
              stroke={ink.border}
              strokeWidth="0.7"
            />
            <circle
              cx={460}
              cy={216 + r * 22}
              r="5"
              fill={[ink.softPurple, ink.softBlue, ink.softGreen, ink.softYellow][r]}
              stroke={ink.border}
              strokeWidth="0.6"
            />
          </g>
        ))}
      </g>

      {/* People */}
      <FlatPersonTyping x={150} y={210} s={1.12} tone={ink.softBlue} hair={ink.fg} />
      <FlatPersonStanding x={520} y={185} s={1.12} tone={ink.softYellow} hair="#5C4A3A" />
      <FlatAgent x={620} y={255} s={0.95} tone={ink.softPurple} />

      {/* Desk props — no balloons / toys */}
      <DeskLamp x={120} y={155} s={1} />
      <DeskPlant x={680} y={268} s={1} />
      <CoffeeMug x={350} y={288} s={1} />
      <StickyStack x={240} y={280} s={0.78} />
      <Notebook x={460} y={282} s={0.8} />
      <BookStack x={100} y={350} s={0.9} />
      <ChatBubble x={540} y={120} s={0.72} tone={ink.softBlue} />
    </svg>
  );
}
