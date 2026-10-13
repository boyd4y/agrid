import { ink } from "./palette";
import { SoftShadowDefs } from "./SvgDefs";
import {
  FlatPersonTyping,
  DeskPlant,
  CoffeeMug,
  StickyStack,
  DeskLamp,
  Notebook,
} from "./FlatPeople";

type Props = { className?: string };

/** Auth side panel — quiet desk scene, muted washes */
export function AuthSideArt({ className }: Props) {
  return (
    <svg
      viewBox="0 0 480 720"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
      preserveAspectRatio="xMidYMid slice"
    >
      <SoftShadowDefs prefix="as" />
      <rect width="480" height="720" fill={ink.cream} />

      <ellipse cx="70" cy="90" rx="150" ry="95" fill={ink.softYellow} opacity="0.4" />
      <ellipse cx="410" cy="160" rx="130" ry="90" fill={ink.softBlue} opacity="0.35" />
      <ellipse cx="400" cy="620" rx="120" ry="80" fill={ink.softGreen} opacity="0.3" />

      {/* Document stack */}
      <g filter="url(#as-soft)">
        <rect
          x="118"
          y="168"
          width="250"
          height="320"
          rx="14"
          fill={ink.softPurple}
          opacity="0.35"
          transform="rotate(5 243 328)"
        />
        <rect
          x="100"
          y="156"
          width="250"
          height="320"
          rx="14"
          fill={ink.softYellow}
          opacity="0.4"
          transform="rotate(-4 225 316)"
        />
        <rect
          x="92"
          y="148"
          width="250"
          height="320"
          rx="14"
          fill={ink.paper}
          stroke={ink.border}
          strokeWidth="1.2"
        />
      </g>

      <rect x="116" y="176" width="130" height="12" rx="4" fill={ink.fg} opacity="0.1" />
      <rect x="116" y="200" width="170" height="7" rx="2.5" fill={ink.muted} opacity="0.25" />
      <rect x="116" y="218" width="140" height="7" rx="2.5" fill={ink.muted} opacity="0.18" />

      {[0, 1, 2].map((i) => (
        <g key={i} filter="url(#as-soft2)">
          <rect
            x="112"
            y={250 + i * 48}
            width="210"
            height="36"
            rx="8"
            fill={ink.cream}
            stroke={ink.border}
            strokeWidth="1"
          />
          <circle
            cx="134"
            cy={268 + i * 48}
            r="8"
            fill={[ink.softBlue, ink.softGreen, ink.softPurple][i]}
            stroke={ink.border}
            strokeWidth="0.7"
          />
          <rect
            x="152"
            y={262 + i * 48}
            width="100"
            height="6"
            rx="2"
            fill={ink.muted}
            opacity="0.28"
          />
          <rect
            x="152"
            y={274 + i * 48}
            width="70"
            height="5"
            rx="2"
            fill={ink.muted}
            opacity="0.18"
          />
        </g>
      ))}

      <FlatPersonTyping x={280} y={480} s={1.05} tone={ink.softBlue} />
      <DeskLamp x={40} y={420} s={1.05} />
      <DeskPlant x={380} y={520} s={1.1} />
      <CoffeeMug x={200} y={560} s={1.1} />
      <StickyStack x={60} y={560} s={0.9} />
      <Notebook x={140} y={570} s={0.85} />
    </svg>
  );
}
