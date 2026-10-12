import { ink } from "./palette";
import { SoftShadowDefs } from "./SvgDefs";

type Props = { className?: string };

/** Empty state for workspace — notebook with plus badge */
export function EmptyTable({ className }: Props) {
  return (
    <svg
      viewBox="0 0 320 240"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <SoftShadowDefs prefix="et" />
      <ellipse cx="160" cy="210" rx="100" ry="16" fill={ink.border} opacity="0.45" />
      <ellipse cx="50" cy="48" rx="48" ry="34" fill={ink.softYellow} opacity="0.9" />
      <ellipse cx="270" cy="56" rx="42" ry="30" fill={ink.softBlue} opacity="0.85" />
      <ellipse cx="280" cy="180" rx="36" ry="28" fill={ink.softPurple} opacity="0.55" />

      <g filter="url(#et-soft)">
        <rect x="56" y="36" width="208" height="148" rx="18" fill={ink.paper} stroke={ink.border} strokeWidth="1.3" />
        <path d="M56 54c0-9.9 8.1-18 18-18h172c9.9 0 18 8.1 18 18v24H56V54z" fill={ink.softPurple} opacity="0.7" />
        <rect x="74" y="48" width="80" height="9" rx="3" fill={ink.paper} opacity="0.75" />
        {[0, 1, 2].map((r) => (
          <g key={r} opacity={0.55 + r * 0.12}>
            <rect x="74" y={92 + r * 26} width="72" height="8" rx="3" fill={ink.muted} />
            <rect
              x="160"
              y={90 + r * 26}
              width="42"
              height="14"
              rx="7"
              fill={[ink.softGreen, ink.softYellow, ink.softRed][r]}
              stroke={ink.border}
              strokeWidth="0.8"
            />
            <circle cx="228" cy={97 + r * 26} r="7" fill={ink.softBlue} />
          </g>
        ))}
      </g>

      {/* Plus badge */}
      <g filter="url(#et-soft2)">
        <circle cx="248" cy="52" r="22" fill={ink.softBlue} stroke={ink.border} strokeWidth="1.2" />
        <path d="M248 42v20M238 52h20" stroke={ink.blueMark} strokeWidth="2.8" strokeLinecap="round" />
      </g>

      {/* Sticky doodle */}
      <g filter="url(#et-soft2)" transform="translate(40 160) rotate(-12)">
        <rect width="44" height="44" rx="8" fill={ink.softYellow} stroke={ink.border} strokeWidth="1" />
        <rect x="8" y="12" width="28" height="4" rx="1.5" fill={ink.fg} opacity="0.2" />
        <rect x="8" y="22" width="20" height="4" rx="1.5" fill={ink.muted} opacity="0.35" />
      </g>
    </svg>
  );
}
