import { ink } from "./palette";
import { SoftShadowDefs } from "./SvgDefs";

type Props = { className?: string };

/** Blog list accent — stacked pages + sticky */
export function BlogHero({ className }: Props) {
  return (
    <svg
      viewBox="0 0 400 220"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <SoftShadowDefs prefix="bh" />
      <ellipse cx="50" cy="40" rx="55" ry="38" fill={ink.softYellow} opacity="0.9" />
      <ellipse cx="350" cy="170" rx="60" ry="42" fill={ink.softGreen} opacity="0.8" />
      <ellipse cx="340" cy="40" rx="40" ry="30" fill={ink.softBlue} opacity="0.7" />

      <g filter="url(#bh-soft)">
        <rect
          x="70"
          y="36"
          width="180"
          height="150"
          rx="16"
          fill={ink.softPurple}
          opacity="0.5"
          transform="rotate(-6 160 111)"
        />
        <rect
          x="90"
          y="32"
          width="180"
          height="150"
          rx="16"
          fill={ink.softYellow}
          opacity="0.55"
          transform="rotate(4 180 107)"
        />
        <rect x="100" y="40" width="180" height="150" rx="16" fill={ink.paper} stroke={ink.border} strokeWidth="1.3" />
      </g>

      <rect x="120" y="64" width="100" height="11" rx="4" fill={ink.fg} opacity="0.14" />
      <rect x="120" y="88" width="140" height="7" rx="3" fill={ink.muted} opacity="0.3" />
      <rect x="120" y="104" width="128" height="7" rx="3" fill={ink.muted} opacity="0.24" />
      <rect x="120" y="120" width="110" height="7" rx="3" fill={ink.muted} opacity="0.2" />
      <rect x="120" y="148" width="56" height="20" rx="10" fill={ink.softBlue} stroke={ink.border} strokeWidth="0.8" />

      {/* sticky */}
      <g filter="url(#bh-soft2)" transform="translate(290 100) rotate(8)">
        <rect width="72" height="72" rx="10" fill={ink.softRed} stroke={ink.border} strokeWidth="1.1" />
        <rect x="12" y="18" width="48" height="6" rx="2" fill={ink.fg} opacity="0.2" />
        <rect x="12" y="32" width="36" height="5" rx="2" fill={ink.muted} opacity="0.35" />
        <circle cx="24" cy="52" r="8" fill={ink.paper} opacity="0.7" />
      </g>
    </svg>
  );
}
