import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

/** OpenAI / Codex mark */
export function OpenAILogo({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={cn("size-3.5 shrink-0", className)}
      {...props}
    >
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.985 5.985 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.76a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.373v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.409-.672zm2.01-3.023l-.141-.085-4.778-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  );
}

/** Anthropic / Claude mark */
export function AnthropicLogo({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={cn("size-3.5 shrink-0", className)}
      {...props}
    >
      <path d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0h3.767L16.906 20.48h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm4.132 9.959L8.344 7.649 6.001 13.48h4.7z" />
    </svg>
  );
}

/**
 * Pi brand mark — exact asset at apps/client/public/brand/pi-logo.svg
 */
export function PiLogo({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 800 800"
      aria-hidden
      className={cn("size-3.5 shrink-0", className)}
      {...props}
    >
      <path
        fill="#F09082"
        d="M165.29 165.29H517.36V400H400V282.65H165.29Z"
      />
      <path
        fill="#4D9ABF"
        d="M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z"
      />
      <path fill="#F1BE58" d="M517.36 400H634.72V634.72H517.36Z" />
    </svg>
  );
}

export type HarnessLogoId = "codex" | "claude" | "pi";
export type ProviderLogoId = "openai" | "anthropic" | "pi";

export function HarnessLogo({
  id,
  className,
}: {
  id: HarnessLogoId | string;
  className?: string;
}) {
  if (id === "codex") return <OpenAILogo className={className} />;
  if (id === "claude") return <AnthropicLogo className={className} />;
  if (id === "pi") return <PiLogo className={className} />;
  return null;
}

export function ProviderLogo({
  id,
  className,
}: {
  id: ProviderLogoId | string;
  className?: string;
}) {
  if (id === "openai") return <OpenAILogo className={className} />;
  if (id === "anthropic") return <AnthropicLogo className={className} />;
  if (id === "pi") return <PiLogo className={className} />;
  return null;
}
