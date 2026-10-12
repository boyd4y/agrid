import { ink } from "./palette";
import { SoftShadowDefs } from "./SvgDefs";

type Props = { className?: string };

/** Empty / solo-member state — desk with human + agent seats waiting */
export function MembersEmpty({ className }: Props) {
  return (
    <svg
      viewBox="0 0 360 220"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <SoftShadowDefs prefix="me" />
      <ellipse cx="180" cy="198" rx="120" ry="14" fill={ink.border} opacity="0.4" />
      <ellipse cx="48" cy="42" rx="52" ry="36" fill={ink.softPurple} opacity="0.85" />
      <ellipse cx="310" cy="50" rx="46" ry="32" fill={ink.softBlue} opacity="0.8" />
      <ellipse cx="300" cy="170" rx="40" ry="28" fill={ink.softYellow} opacity="0.55" />

      {/* Desk card */}
      <g filter="url(#me-soft)">
        <rect
          x="48"
          y="44"
          width="264"
          height="132"
          rx="20"
          fill={ink.paper}
          stroke={ink.border}
          strokeWidth="1.3"
        />
        <path
          d="M48 62c0-9.9 8.1-18 18-18h228c9.9 0 18 8.1 18 18v18H48V62z"
          fill={ink.softGreen}
          opacity="0.75"
        />
        <rect x="68" y="52" width="96" height="8" rx="3" fill={ink.paper} opacity="0.8" />

        {/* Human seat filled */}
        <g transform="translate(78 96)">
          <circle cx="22" cy="18" r="18" fill={ink.softBlue} stroke={ink.border} strokeWidth="1.1" />
          <circle cx="22" cy="14" r="7" fill={ink.paper} stroke={ink.border} strokeWidth="0.9" />
          <path
            d="M8 30c2.5-7 10-10 14-10s11.5 3 14 10"
            fill={ink.paper}
            stroke={ink.border}
            strokeWidth="0.9"
          />
          <rect x="0" y="42" width="44" height="10" rx="5" fill={ink.cream} stroke={ink.border} strokeWidth="0.8" />
        </g>

        {/* Agent seat empty / dashed */}
        <g transform="translate(168 96)">
          <circle
            cx="22"
            cy="18"
            r="18"
            fill={ink.cream}
            stroke={ink.border}
            strokeWidth="1.2"
            strokeDasharray="4 3"
          />
          <rect
            x="14"
            y="10"
            width="16"
            height="12"
            rx="3"
            fill={ink.softPurple}
            opacity="0.7"
            stroke={ink.border}
            strokeWidth="0.8"
          />
          <circle cx="18" cy="15" r="1.5" fill={ink.fg} opacity="0.35" />
          <circle cx="26" cy="15" r="1.5" fill={ink.fg} opacity="0.35" />
          <path d="M16 20h12" stroke={ink.muted} strokeWidth="1.2" strokeLinecap="round" />
          <rect
            x="0"
            y="42"
            width="44"
            height="10"
            rx="5"
            fill={ink.softPurple}
            opacity="0.45"
            stroke={ink.border}
            strokeWidth="0.8"
            strokeDasharray="3 2"
          />
        </g>

        {/* Invite plus */}
        <g transform="translate(258 108)">
          <circle cx="16" cy="16" r="16" fill={ink.softYellow} stroke={ink.border} strokeWidth="1.1" />
          <path
            d="M16 8v16M8 16h16"
            stroke={ink.yellowMark}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </g>
      </g>

      {/* Sticky invite note */}
      <g filter="url(#me-soft2)" transform="translate(28 148) rotate(-8)">
        <rect width="52" height="48" rx="8" fill={ink.softYellow} stroke={ink.border} strokeWidth="1" />
        <rect x="10" y="12" width="32" height="4" rx="1.5" fill={ink.fg} opacity="0.2" />
        <rect x="10" y="22" width="24" height="4" rx="1.5" fill={ink.muted} opacity="0.35" />
        <rect x="10" y="32" width="28" height="4" rx="1.5" fill={ink.muted} opacity="0.25" />
      </g>
    </svg>
  );
}
