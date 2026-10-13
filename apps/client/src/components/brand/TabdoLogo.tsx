import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

/** User-provided logo kit; variants follow the application's .dark theme. */
export function TabdoLogo({
  className,
  markClassName,
  showWordmark = true,
}: {
  className?: string;
  markClassName?: string;
  showWordmark?: boolean;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-2 text-foreground", className)}
      role="img"
      aria-label={BRAND.name}
    >
      <span
        className={cn("h-8 w-8 shrink-0", markClassName)}
        aria-hidden="true"
        data-tabdo-mark
      >
        <img
          src="/brand/tabdo-mark-ink.svg"
          alt=""
          width={96}
          height={100}
          className="block h-full w-full object-contain dark:hidden"
        />
        <img
          src="/brand/tabdo-mark-white.svg"
          alt=""
          width={96}
          height={100}
          className="hidden h-full w-full object-contain dark:block"
        />
      </span>
      {showWordmark && (
        <svg viewBox="80 10 187 48" className="h-4 w-auto" aria-hidden="true" data-tabdo-wordmark>
          <path
            fill="currentColor"
            d="M87 13H94V25H107V32H94V43C94 45.2 95.8 47 98 47H107V54H98C91.9 54 87 49.1 87 43V32H80V25H87Z"
          />
          <g fill="none" stroke="currentColor" strokeWidth="7">
            <circle cx="128" cy="39" r="12" /><path d="M140 25.5V54" />
            <circle cx="168" cy="39" r="12" /><path d="M156 12V54" />
            <circle cx="208" cy="39" r="12" /><path d="M220 12V54" />
            <circle cx="248" cy="39" r="12" />
          </g>
        </svg>
      )}
    </span>
  );
}
