import { ink } from "./palette";
import { SoftShadowDefs } from "./SvgDefs";

type Props = { className?: string };

/** Soft Notion-style docs / open book illustration */
export function DocsHero({ className }: Props) {
  return (
    <svg
      viewBox="0 0 400 220"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <SoftShadowDefs prefix="dh" />
      <ellipse cx="48" cy="48" rx="52" ry="36" fill={ink.softBlue} opacity="0.85" />
      <ellipse cx="350" cy="180" rx="58" ry="40" fill={ink.softYellow} opacity="0.8" />
      <ellipse cx="320" cy="36" rx="36" ry="28" fill={ink.softPurple} opacity="0.7" />

      <g filter="url(#dh-soft)">
        <rect x="70" y="40" width="150" height="140" rx="14" fill={ink.cream} stroke={ink.border} strokeWidth="1.5" />
        <rect x="88" y="58" width="110" height="10" rx="4" fill={ink.softYellow} />
        <rect x="88" y="80" width="96" height="7" rx="3" fill={ink.border} />
        <rect x="88" y="96" width="104" height="7" rx="3" fill={ink.border} />
        <rect x="88" y="112" width="72" height="7" rx="3" fill={ink.border} />
        <rect x="88" y="140" width="48" height="18" rx="6" fill={ink.softBlue} stroke={ink.blueMark} strokeWidth="1.2" />
      </g>

      <g filter="url(#dh-soft2)" transform="rotate(7 280 110)">
        <rect x="210" y="32" width="140" height="150" rx="14" fill={ink.paper} stroke={ink.border} strokeWidth="1.5" />
        <rect x="228" y="52" width="90" height="9" rx="3" fill={ink.softPurple} />
        <rect x="228" y="72" width="100" height="6" rx="2" fill={ink.border} />
        <rect x="228" y="88" width="84" height="6" rx="2" fill={ink.border} />
        <rect x="228" y="104" width="92" height="6" rx="2" fill={ink.border} />
        <rect x="228" y="130" width="64" height="24" rx="8" fill={ink.softGreen} opacity="0.9" />
      </g>

      <circle cx="60" cy="170" r="12" fill={ink.softRed} opacity="0.65" />
    </svg>
  );
}
