import { ink } from "./palette";
import { SoftShadowDefs } from "./SvgDefs";
import {
  FlatPersonTyping,
  FlatPersonStanding,
  FlatAgent,
  DeskPlant,
  CoffeeMug,
  StickyStack,
  DeskLamp,
  Notebook,
  ChatBubble,
  BookStack,
} from "./FlatPeople";

type Props = { className?: string; variant: "table" | "kanban" | "agents" };

export function FeatureScene({ className, variant }: Props) {
  if (variant === "table") {
    return (
      <svg viewBox="0 0 520 360" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <SoftShadowDefs prefix="fs-t" />
        <rect width="520" height="360" rx="18" fill={ink.cream} />
        <ellipse cx="80" cy="50" rx="100" ry="55" fill={ink.softYellow} opacity="0.45" />
        <g filter="url(#fs-t-soft)">
          <rect x="150" y="85" width="230" height="140" rx="12" fill={ink.paper} stroke={ink.border} strokeWidth="1.15" />
          <rect x="150" y="85" width="230" height="26" rx="12" fill={ink.softBlue} opacity="0.8" />
          <rect x="150" y="103" width="230" height="8" fill={ink.softBlue} opacity="0.8" />
          {[0, 1, 2].map((r) => (
            <g key={r}>
              <rect x="168" y={128 + r * 26} width="70" height="5" rx="2" fill={ink.muted} opacity="0.28" />
              <rect
                x="252"
                y={125 + r * 26}
                width="52"
                height="12"
                rx="6"
                fill={[ink.softGreen, ink.softYellow, ink.softBlue][r]}
                stroke={ink.border}
                strokeWidth="0.7"
              />
            </g>
          ))}
        </g>
        <FlatPersonTyping x={30} y={165} s={1.1} tone={ink.softBlue} />
        <FlatPersonStanding x={400} y={145} s={1} tone={ink.softYellow} hair="#5C4A3A" />
        <DeskLamp x={360} y={45} s={0.9} />
        <CoffeeMug x={300} y={235} s={1} />
        <StickyStack x={110} y={255} s={0.75} />
        <Notebook x={340} y={255} s={0.75} />
      </svg>
    );
  }

  if (variant === "kanban") {
    return (
      <svg viewBox="0 0 520 360" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <SoftShadowDefs prefix="fs-k" />
        <rect width="520" height="360" rx="18" fill={ink.cream} />
        <ellipse cx="430" cy="55" rx="90" ry="50" fill={ink.softPurple} opacity="0.35" />
        <g filter="url(#fs-k-soft)">
          {[0, 1, 2].map((c) => {
            const x = 145 + c * 72;
            return (
              <g key={c}>
                <rect x={x} y="70" width="60" height="145" rx="10" fill={ink.paper} stroke={ink.border} strokeWidth="1.1" />
                <rect
                  x={x + 10}
                  y="82"
                  width="30"
                  height="7"
                  rx="3.5"
                  fill={[ink.softBlue, ink.softYellow, ink.softGreen][c]}
                />
                {[0, 1].map((card) => (
                  <rect
                    key={card}
                    x={x + 8}
                    y={100 + card * 44}
                    width="44"
                    height="34"
                    rx="7"
                    fill={ink.cream}
                    stroke={ink.border}
                    strokeWidth="1"
                  />
                ))}
              </g>
            );
          })}
        </g>
        <FlatPersonStanding x={35} y={145} s={1.15} tone={ink.softYellow} hair="#5C4A3A" />
        <FlatAgent x={400} y={185} s={1.1} tone={ink.softPurple} />
        <DeskPlant x={360} y={45} s={0.9} />
        <BookStack x={70} y={285} s={0.8} />
        <ChatBubble x={280} y={245} s={0.65} tone={ink.softYellow} />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 520 360" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <SoftShadowDefs prefix="fs-a" />
      <rect width="520" height="360" rx="18" fill={ink.cream} />
      <ellipse cx="70" cy="60" rx="95" ry="55" fill={ink.softBlue} opacity="0.4" />
      <ChatBubble x={170} y={75} s={0.95} tone={ink.softBlue} />
      <ChatBubble x={270} y={130} s={0.8} tone={ink.softYellow} />
      <FlatPersonTyping x={50} y={165} s={1.05} tone={ink.softBlue} hair="#5C4A3A" />
      <FlatAgent x={340} y={165} s={1.25} tone={ink.softPurple} />
      <CoffeeMug x={250} y={255} s={0.95} />
      <StickyStack x={130} y={265} s={0.7} />
      <g>
        {[
          { x: 300, l: "Codex", c: ink.softBlue, w: 52 },
          { x: 360, l: "Claude", c: ink.softGreen, w: 58 },
          { x: 430, l: "Pi", c: ink.softPurple, w: 36 },
        ].map((h) => (
          <g key={h.l}>
            <rect x={h.x} y={285} width={h.w} height="18" rx="9" fill={h.c} stroke={ink.border} strokeWidth="0.8" />
            <text
              x={h.x + h.w / 2}
              y={297}
              textAnchor="middle"
              fontSize="9"
              fontFamily="system-ui, sans-serif"
              fill={ink.fg}
              opacity="0.65"
            >
              {h.l}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
