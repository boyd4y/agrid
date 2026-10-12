import { ink } from "./palette";
import { SoftShadowDefs } from "./SvgDefs";

type Props = { className?: string };

/** Compact chrome accent for in-app workspace header / sidebar brand */
export function WorkspaceHeaderArt({ className }: Props) {
  return (
    <svg
      viewBox="0 0 120 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <SoftShadowDefs prefix="wh" />
      <rect x="2" y="4" width="32" height="32" rx="10" fill={ink.softBlue} stroke={ink.border} strokeWidth="1" />
      <rect x="8" y="12" width="20" height="4" rx="1.5" fill={ink.paper} opacity="0.85" />
      <rect x="8" y="20" width="12" height="3" rx="1" fill={ink.muted} opacity="0.4" />
      <rect x="8" y="26" width="16" height="3" rx="1" fill={ink.muted} opacity="0.3" />
      <circle cx="52" cy="20" r="10" fill={ink.softYellow} stroke={ink.border} strokeWidth="1" />
      <circle cx="72" cy="20" r="10" fill={ink.softPurple} stroke={ink.border} strokeWidth="1" />
      <circle cx="92" cy="20" r="10" fill={ink.softGreen} stroke={ink.border} strokeWidth="1" />
    </svg>
  );
}
