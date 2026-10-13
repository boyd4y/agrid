import { useEffect } from "react";
import { BRAND, BRAND_COPY } from "@/lib/brand";

export type SeoProps = {
  title: string;
  description?: string;
  path?: string;
  type?: "website" | "article";
  image?: string;
  publishedTime?: string;
  tags?: string[];
  noindex?: boolean;
};

const SITE = BRAND.name;
const ORIGIN = BRAND.url;

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
}

/** Client-side SEO tags for marketing pages (title, description, OG, Twitter). */
export function SeoHead({
  title,
  description = BRAND_COPY.description,
  path = "/",
  type = "website",
  image = "/tabdo-mark.svg",
  publishedTime,
  tags,
  noindex,
}: SeoProps) {
  useEffect(() => {
    const fullTitle = title.includes(SITE) ? title : `${title} · ${SITE}`;
    document.title = fullTitle;
    const url = `${ORIGIN}${path}`;
    const absImage = image.startsWith("http") ? image : `${ORIGIN}${image}`;

    upsertMeta("name", "description", description);
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", fullTitle);
    upsertMeta("name", "twitter:description", description);
    upsertMeta("name", "twitter:image", absImage);
    upsertMeta("property", "og:site_name", SITE);
    upsertMeta("property", "og:title", fullTitle);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:type", type);
    upsertMeta("property", "og:url", url);
    upsertMeta("property", "og:image", absImage);
    if (publishedTime) upsertMeta("property", "article:published_time", publishedTime);
    if (tags) {
      document.head
        .querySelectorAll('meta[property="article:tag"]')
        .forEach((n) => n.remove());
      for (const t of tags) {
        const el = document.createElement("meta");
        el.setAttribute("property", "article:tag");
        el.content = t;
        document.head.appendChild(el);
      }
    }
    upsertMeta("name", "robots", noindex ? "noindex,nofollow" : "index,follow");
    upsertLink("canonical", url);
  }, [title, description, path, type, image, publishedTime, tags, noindex]);

  return null;
}
