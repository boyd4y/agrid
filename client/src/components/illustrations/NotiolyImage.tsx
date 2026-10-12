type Props = {
  src: string;
  alt: string;
  className?: string;
};

/** Raster Notioly-quality art from /public/illustrations */
export function NotiolyImage({ src, alt, className = "" }: Props) {
  return (
    <img
      src={src}
      alt={alt}
      className={`h-auto w-full rounded-2xl object-cover ${className}`}
      loading="lazy"
      decoding="async"
    />
  );
}

export const NOTIOLY = {
  collaborate: "/illustrations/hero-collaborate.jpg",
  checklist: "/illustrations/feature-checklist.jpg",
  kanban: "/illustrations/feature-kanban.jpg",
} as const;
