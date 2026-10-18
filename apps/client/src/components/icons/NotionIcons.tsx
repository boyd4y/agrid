/** Notion-style pictograms (Overflow Notion Icons–inspired). 24×24, currentColor. */
import type { ReactNode } from "react";

type IconProps = { className?: string; title?: string };

function Ni({ className, title, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

const s = {
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function NiTable(props: IconProps) {
  return (
    <Ni {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" {...s} />
      <path d="M3.5 9.5h17M10.5 9.5v10M3.5 14.5h17" {...s} />
    </Ni>
  );
}

export function NiKanban(props: IconProps) {
  return (
    <Ni {...props}>
      <rect x="3.5" y="4" width="5" height="16" rx="1.5" {...s} />
      <rect x="9.5" y="4" width="5" height="11" rx="1.5" {...s} />
      <rect x="15.5" y="4" width="5" height="13" rx="1.5" {...s} />
    </Ni>
  );
}

export function NiUsers(props: IconProps) {
  return (
    <Ni {...props}>
      <circle cx="9" cy="8" r="2.75" {...s} />
      <path d="M4.5 18.5c.6-3 2.4-4.5 4.5-4.5s3.9 1.5 4.5 4.5" {...s} />
      <circle cx="16.5" cy="8.5" r="2.25" {...s} />
      <path d="M14 14c1.6-.7 3.2-.4 4.5 1.2.6.8 1 1.9 1.1 3.3" {...s} />
    </Ni>
  );
}

export function NiBot(props: IconProps) {
  return (
    <Ni {...props}>
      <rect x="5" y="7" width="14" height="11" rx="3" {...s} />
      <path d="M12 4.5v2.5" {...s} />
      <circle cx="12" cy="3.5" r="1.2" fill="currentColor" />
      <circle cx="9" cy="12" r="1.15" fill="currentColor" />
      <circle cx="15" cy="12" r="1.15" fill="currentColor" />
      <path d="M9.5 15.5h5" {...s} />
    </Ni>
  );
}

export function NiArrowRight(props: IconProps) {
  return (
    <Ni {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" {...s} />
    </Ni>
  );
}

export function NiHome(props: IconProps) {
  return (
    <Ni {...props}>
      <path d="M4.5 11.5 12 5l7.5 6.5" {...s} />
      <path d="M7 10.5V19h10v-8.5" {...s} />
      <path d="M10 19v-5h4v5" {...s} />
    </Ni>
  );
}

export function NiGrid(props: IconProps) {
  return (
    <Ni {...props}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" {...s} />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" {...s} />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" {...s} />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" {...s} />
    </Ni>
  );
}

export function NiSettings(props: IconProps) {
  return (
    <Ni {...props}>
      <circle cx="12" cy="12" r="3" {...s} />
      <path
        d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6"
        {...s}
      />
    </Ni>
  );
}

export function NiSparkles(props: IconProps) {
  return (
    <Ni {...props}>
      <path d="M12 3.5 13.4 9 19 10.5 13.4 12 12 17.5 10.6 12 5 10.5 10.6 9Z" {...s} />
      <path d="M18 14.5 18.6 16.8 21 17.5 18.6 18.2 18 20.5 17.4 18.2 15 17.5 17.4 16.8Z" {...s} />
    </Ni>
  );
}

export function NiPlus(props: IconProps) {
  return (
    <Ni {...props}>
      <path d="M12 5v14M5 12h14" {...s} />
    </Ni>
  );
}

export function NiChevronLeft(props: IconProps) {
  return (
    <Ni {...props}>
      <path d="M14.5 6 9 12l5.5 6" {...s} />
    </Ni>
  );
}

export function NiChevronRight(props: IconProps) {
  return (
    <Ni {...props}>
      <path d="M9.5 6 15 12l-5.5 6" {...s} />
    </Ni>
  );
}

export function NiLogout(props: IconProps) {
  return (
    <Ni {...props}>
      <path d="M10 5.5H7.5A2.5 2.5 0 005 8v8a2.5 2.5 0 002.5 2.5H10" {...s} />
      <path d="M13 12h7M17 8.5 20.5 12 17 15.5" {...s} />
    </Ni>
  );
}

export function NiBook(props: IconProps) {
  return (
    <Ni {...props}>
      <path d="M5 5.5A2.5 2.5 0 017.5 3H19v16.5H7.5A2.5 2.5 0 005 17V5.5z" {...s} />
      <path d="M5 17a2.5 2.5 0 012.5-2.5H19" {...s} />
    </Ni>
  );
}

export function NiZap(props: IconProps) {
  return (
    <Ni {...props}>
      <path d="M13 3 6.5 13.5H12L11 21l6.5-10.5H12L13 3z" {...s} />
    </Ni>
  );
}

export function NiX(props: IconProps) {
  return (
    <Ni {...props}>
      <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" {...s} />
    </Ni>
  );
}


export function NiCalendar(props: IconProps) {
  return (
    <Ni {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" {...s} />
      <path d="M7.5 3.5v4M16.5 3.5v4M3.5 10h17M7.5 14h2M14.5 14h2M7.5 17.5h2" {...s} />
    </Ni>
  );
}

export function NiMoreHorizontal(props: IconProps) {
  return (
    <Ni {...props}>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" />
    </Ni>
  );
}

export function NiMessage(props: IconProps) {
  return (
    <Ni {...props}>
      <path d="M6 4.5h12a2.5 2.5 0 0 1 2.5 2.5v9a2.5 2.5 0 0 1-2.5 2.5H9l-5.5 3V7A2.5 2.5 0 0 1 6 4.5Z" {...s} />
    </Ni>
  );
}

export function NiGlobe(props: IconProps) {
  return (
    <Ni {...props}>
      <circle cx="12" cy="12" r="8.5" {...s} />
      <ellipse cx="12" cy="12" rx="3.5" ry="8.5" {...s} />
      <path d="M3.5 12h17" {...s} />
    </Ni>
  );
}

export function NiPlug(props: IconProps) {
  return (
    <Ni {...props}>
      <path d="M8 3.5V8m8-4.5V8M6 8h12v3a6 6 0 0 1-12 0V8Zm6 9v3.5" {...s} />
    </Ni>
  );
}

export function NiClock(props: IconProps) {
  return (
    <Ni {...props}>
      <circle cx="12" cy="12" r="8.5" {...s} />
      <path d="M12 7v5l3.5 2" {...s} />
    </Ni>
  );
}

export function NiChevronDown(props: IconProps) {
  return (
    <Ni {...props}>
      <path d="m6 9.5 6 5.5 6-5.5" {...s} />
    </Ni>
  );
}

export function NiPin(props: IconProps) {
  return (
    <Ni {...props}>
      <path d="m9 4 9 9-3 1-2 4-7-7 4-2-1-5ZM9.5 14.5 4 20" {...s} />
    </Ni>
  );
}

export function NiPinOff(props: IconProps) {
  return (
    <Ni {...props}>
      <path d="m3.5 3.5 17 17M10 5l-1-1 9 9-3 1M7 10l-1 1 7 7 1-2M9.5 14.5 4 20" {...s} />
    </Ni>
  );
}
