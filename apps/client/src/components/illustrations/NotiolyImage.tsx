import { cn } from "@/lib/utils";

type Props = {
  src: string;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
};

/** Original transparent Notioly Free Pack SVGs; dark styling follows root .dark. */
export function NotiolyImage({ src, alt, className, loading = "lazy" }: Props) {
  return (
    <img
      src={src}
      alt={alt}
      width={520}
      height={520}
      className={cn("h-auto w-full object-contain dark:invert dark:opacity-85", className)}
      loading={loading}
      decoding="async"
    />
  );
}

export const NOTIOLY = {
  fastInternet: "/illustrations/notioly/fast-internet.svg",
  planning: "/illustrations/notioly/planning-a-trip.svg",
  collaborate: "/illustrations/notioly/affiliate-program.svg",
  painting: "/illustrations/notioly/painting.svg",
  chill: "/illustrations/notioly/chill-time.svg",
} as const;
