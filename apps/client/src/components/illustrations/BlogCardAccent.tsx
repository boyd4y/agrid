import { ink } from "./palette";

type Props = { className?: string; index?: number };

const fills = [ink.softYellow, ink.softBlue, ink.softPurple, ink.softGreen, ink.softRed];

/** Small accent tile for blog list cards */
export function BlogCardAccent({ className, index = 0 }: Props) {
  const fill = fills[index % fills.length];
  return (
    <svg
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect width="80" height="80" rx="16" fill={fill} />
      <rect x="14" y="16" width="40" height="48" rx="8" fill={ink.paper} stroke={ink.border} strokeWidth="1" opacity="0.95" />
      <rect x="22" y="26" width="24" height="5" rx="2" fill={ink.muted} opacity="0.35" />
      <rect x="22" y="36" width="20" height="4" rx="2" fill={ink.muted} opacity="0.25" />
      <rect x="22" y="46" width="16" height="4" rx="2" fill={ink.muted} opacity="0.2" />
      <circle cx="58" cy="58" r="12" fill={ink.paper} opacity="0.7" stroke={ink.border} strokeWidth="0.8" />
      <path d="M54 58h8M58 54v8" stroke={ink.fg} strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}
