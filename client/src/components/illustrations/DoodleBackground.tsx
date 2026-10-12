import { ink } from "./palette";

type Props = { className?: string };

/** Soft scattered doodles for auth / marketing backgrounds */
export function DoodleBackground({ className }: Props) {
  return (
    <svg
      viewBox="0 0 800 600"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="800" height="600" fill={ink.cream} />
      <ellipse cx="70" cy="80" rx="90" ry="70" fill={ink.softYellow} opacity="0.85" />
      <ellipse cx="730" cy="70" rx="100" ry="80" fill={ink.softBlue} opacity="0.75" />
      <ellipse cx="90" cy="530" rx="110" ry="85" fill={ink.softRed} opacity="0.45" />
      <ellipse cx="720" cy="510" rx="120" ry="90" fill={ink.softGreen} opacity="0.6" />
      <ellipse cx="400" cy="300" rx="140" ry="110" fill={ink.softPurple} opacity="0.22" />

      {/* tiny motifs */}
      <rect
        x="190"
        y="70"
        width="36"
        height="36"
        rx="10"
        fill={ink.softYellow}
        stroke={ink.border}
        strokeWidth="1"
        transform="rotate(14 208 88)"
      />
      <rect
        x="560"
        y="130"
        width="28"
        height="28"
        rx="8"
        fill={ink.softBlue}
        stroke={ink.border}
        strokeWidth="1"
        transform="rotate(-18 574 144)"
      />
      <circle cx="240" cy="420" r="14" fill={ink.softPurple} stroke={ink.border} strokeWidth="1" />
      <circle cx="600" cy="380" r="12" fill={ink.softRed} stroke={ink.border} strokeWidth="1" />
      <path
        d="M640 260c24-36 60-24 48 12"
        stroke={ink.blueMark}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.35"
      />
      <path
        d="M150 230c-12 36 24 48 42 12"
        stroke={ink.muted}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.4"
      />
      {/* mini sticky */}
      <rect x="480" y="450" width="40" height="40" rx="6" fill={ink.softYellow} stroke={ink.border} strokeWidth="1" transform="rotate(-8 500 470)" />
    </svg>
  );
}
