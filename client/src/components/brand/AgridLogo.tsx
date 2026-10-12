import { cn } from "@/lib/utils";

/** Agrid wordmark + N1 mark (Notion-style open A + 2×2). */
export function AgridLogo({
  className,
  markClassName,
  showWordmark = true,
}: {
  className?: string;
  markClassName?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <img
        src="/agrid-mark.svg"
        alt=""
        width={32}
        height={32}
        className={cn("h-8 w-8 rounded-lg", markClassName)}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
          const sib = e.currentTarget.nextElementSibling as HTMLElement | null;
          if (sib) sib.classList.remove("hidden");
        }}
      />
      <svg
        viewBox="0 0 64 64"
        className={cn("hidden h-8 w-8 rounded-lg", markClassName)}
        aria-hidden
        data-agrid-fallback
      >
        <rect width="64" height="64" rx="14" fill="#FFFDF8" />
        <path
          fill="#464646"
          d="M 27.88 11.25 L 25.75 15.25 L 22.88 20.25 L 20.12 25.25 L 16.25 32.25 L 13.38 37.25 L 10.62 42.25 L 7.88 47.25 L 5.00 52.25 L 4.50 53.25 L 14.12 53.25 L 14.62 52.25 L 17.50 47.25 L 20.25 42.25 L 23.00 37.25 L 25.75 32.25 L 29.62 25.25 L 32.00 20.25 L 32.00 15.25 L 31.88 11.25 Z"
        />
        <path
          fill="#464646"
          d="M 32.12 11.25 L 32.25 15.25 L 32.25 20.25 L 34.50 25.25 L 38.38 32.25 L 41.12 37.25 L 44.00 42.25 L 46.75 47.25 L 49.50 52.25 L 50.00 53.25 L 59.75 53.25 L 59.12 52.25 L 56.38 47.25 L 53.62 42.25 L 50.75 37.25 L 48.00 32.25 L 44.12 25.25 L 41.38 20.25 L 38.50 15.25 L 36.25 11.25 Z"
        />
        <g fill="#ACCBE7">
          <rect x="25.1" y="37.7" width="6.5" height="6.5" rx="0.6" />
          <rect x="32.4" y="37.7" width="6.5" height="6.5" rx="0.6" />
          <rect x="25.1" y="44.9" width="6.5" height="6.5" rx="0.6" />
          <rect x="32.4" y="44.9" width="6.5" height="6.5" rx="0.6" />
        </g>
      </svg>
      {showWordmark ? <span>Agrid</span> : null}
    </span>
  );
}
