import { ink } from "./palette";
import { SoftShadowDefs } from "./SvgDefs";

type Props = {
  className?: string;
  variant: "table" | "kanban" | "ai" | "members" | "auth" | "spark";
};

export function FeatureMini({ className, variant }: Props) {
  const common = {
    viewBox: "0 0 160 112",
    fill: "none" as const,
    xmlns: "http://www.w3.org/2000/svg",
    className,
    "aria-hidden": true as const,
  };

  if (variant === "table") {
    return (
      <svg {...common}>
        <SoftShadowDefs prefix="fm-t" />
        <rect width="160" height="112" rx="18" fill={ink.softYellow} />
        <ellipse cx="24" cy="20" rx="28" ry="18" fill={ink.paper} opacity="0.35" />
        <g filter="url(#fm-t-soft2)">
          <rect x="22" y="20" width="116" height="72" rx="12" fill={ink.paper} stroke={ink.border} strokeWidth="1.2" />
          <path d="M22 32c0-6.6 5.4-12 12-12h92c6.6 0 12 5.4 12 12v14H22V32z" fill={ink.softBlue} />
          {[0, 1, 2].map((r) => (
            <g key={r}>
              <rect x="32" y={52 + r * 12} width="36" height="5" rx="2" fill={ink.muted} opacity="0.3" />
              <rect
                x="76"
                y={50 + r * 12}
                width="26"
                height="9"
                rx="4.5"
                fill={[ink.softGreen, ink.softBlue, ink.softRed][r]}
                stroke={ink.border}
                strokeWidth="0.7"
              />
              <circle cx="118" cy={54 + r * 12} r="5" fill={[ink.softPurple, ink.softYellow, ink.softGreen][r]} />
            </g>
          ))}
        </g>
      </svg>
    );
  }

  if (variant === "kanban") {
    return (
      <svg {...common}>
        <SoftShadowDefs prefix="fm-k" />
        <rect width="160" height="112" rx="18" fill={ink.softBlue} />
        {[0, 1, 2].map((c) => (
          <g key={c} filter="url(#fm-k-soft2)">
            <rect
              x={18 + c * 46}
              y="16"
              width="40"
              height="80"
              rx="10"
              fill={ink.paper}
              stroke={ink.border}
              strokeWidth="1.2"
            />
            <rect
              x={26 + c * 46}
              y="24"
              width="22"
              height="6"
              rx="3"
              fill={[ink.softYellow, ink.softGreen, ink.softPurple][c]}
            />
            <rect
              x={24 + c * 46}
              y="38"
              width="28"
              height="20"
              rx="6"
              fill={ink.cream}
              stroke={ink.border}
              strokeWidth="0.9"
            />
            {c < 2 && (
              <rect
                x={24 + c * 46}
                y="64"
                width="28"
                height="20"
                rx="6"
                fill={ink.cream}
                stroke={ink.border}
                strokeWidth="0.9"
              />
            )}
          </g>
        ))}
      </svg>
    );
  }

  if (variant === "ai") {
    return (
      <svg {...common}>
        <SoftShadowDefs prefix="fm-a" />
        <rect width="160" height="112" rx="18" fill={ink.softPurple} />
        <g filter="url(#fm-a-soft2)">
          <rect x="22" y="24" width="70" height="64" rx="12" fill={ink.paper} stroke={ink.border} strokeWidth="1.2" />
          <rect x="32" y="36" width="44" height="6" rx="2" fill={ink.muted} opacity="0.3" />
          <rect x="32" y="48" width="32" height="5" rx="2" fill={ink.muted} opacity="0.22" />
          <rect x="32" y="60" width="40" height="5" rx="2" fill={ink.muted} opacity="0.18" />
          <rect x="32" y="72" width="24" height="8" rx="4" fill={ink.softBlue} />
          <circle cx="118" cy="56" r="26" fill={ink.softGreen} stroke={ink.border} strokeWidth="1.2" />
          <circle cx="118" cy="56" r="12" fill={ink.paper} />
          <path d="M112 56h12M118 50v12" stroke={ink.blueMark} strokeWidth="2" strokeLinecap="round" />
          <path
            d="M98 34c8-12 24-10 28 2"
            stroke={ink.blueMark}
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.45"
          />
        </g>
      </svg>
    );
  }

  if (variant === "members") {
    return (
      <svg {...common}>
        <SoftShadowDefs prefix="fm-m" />
        <rect width="160" height="112" rx="18" fill={ink.softRed} />
        <g filter="url(#fm-m-soft2)">
          {/* human avatars */}
          <circle cx="52" cy="48" r="22" fill={ink.softYellow} stroke={ink.border} strokeWidth="1.2" />
          <text x="52" y="53" textAnchor="middle" fontSize="14" fill={ink.fg} fontFamily="system-ui" opacity="0.55">
            B
          </text>
          <circle cx="96" cy="42" r="20" fill={ink.softBlue} stroke={ink.border} strokeWidth="1.2" />
          <text x="96" y="47" textAnchor="middle" fontSize="13" fill={ink.fg} fontFamily="system-ui" opacity="0.55">
            Y
          </text>
          {/* agent avatar */}
          <circle cx="78" cy="78" r="22" fill={ink.softPurple} stroke={ink.border} strokeWidth="1.2" />
          <rect x="68" y="70" width="20" height="14" rx="5" fill={ink.paper} />
          <circle cx="74" cy="76" r="2" fill={ink.fg} />
          <circle cx="82" cy="76" r="2" fill={ink.fg} />
          <path d="M73 82h10" stroke={ink.fg} strokeWidth="1.3" strokeLinecap="round" opacity="0.45" />
        </g>
      </svg>
    );
  }

  if (variant === "auth") {
    return (
      <svg {...common}>
        <SoftShadowDefs prefix="fm-au" />
        <rect width="160" height="112" rx="18" fill={ink.softGreen} />
        <g filter="url(#fm-au-soft2)">
          <rect x="48" y="18" width="64" height="76" rx="14" fill={ink.paper} stroke={ink.border} strokeWidth="1.2" />
          <circle cx="80" cy="46" r="14" fill={ink.softYellow} stroke={ink.border} strokeWidth="1" />
          <path d="M64 78c6-12 26-12 32 0" fill={ink.softBlue} opacity="0.85" />
          <rect x="68" y="68" width="24" height="14" rx="4" fill={ink.blueMark} opacity="0.85" />
          <rect x="74" y="72" width="12" height="3" rx="1.5" fill={ink.paper} opacity="0.8" />
        </g>
      </svg>
    );
  }

  // spark
  return (
    <svg {...common}>
      <SoftShadowDefs prefix="fm-s" />
      <rect width="160" height="112" rx="18" fill={ink.cream} />
      <ellipse cx="30" cy="90" rx="40" ry="20" fill={ink.softGreen} opacity="0.7" />
      <ellipse cx="130" cy="24" rx="36" ry="22" fill={ink.softBlue} opacity="0.65" />
      <g filter="url(#fm-s-soft2)">
        <path
          d="M80 18l10 26h28l-22 18 8 28-24-16-24 16 8-28-22-18h28z"
          fill={ink.softYellow}
          stroke={ink.border}
          strokeWidth="1.2"
        />
      </g>
      <circle cx="36" cy="40" r="8" fill={ink.softRed} stroke={ink.border} strokeWidth="0.8" />
      <circle cx="128" cy="78" r="7" fill={ink.softPurple} stroke={ink.border} strokeWidth="0.8" />
      <rect x="24" y="64" width="18" height="18" rx="5" fill={ink.softBlue} transform="rotate(12 33 73)" />
    </svg>
  );
}
