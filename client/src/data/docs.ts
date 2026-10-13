import { BRAND } from "@/lib/brand";
import i18n from "@/i18n";
import type { AppLocale } from "@/i18n";
import type { DocsBlock, DocsPage, DocsSection } from "./docs-content/types";
import { docsPages as enPages, docsSections as enSections } from "./docs-content/en";
import { docsPages as zhPages, docsSections as zhSections } from "./docs-content/zh-CN";

export type { DocsBlock, DocsPage, DocsSection };

function resolveLocale(locale?: string): AppLocale {
  const raw = locale ?? i18n.language ?? "zh-CN";
  return raw.startsWith("en") ? "en" : "zh-CN";
}

function catalog(locale?: string) {
  return resolveLocale(locale) === "en"
    ? { sections: enSections, pages: enPages }
    : { sections: zhSections, pages: zhPages };
}

/** @deprecated Prefer getDoc(slug, locale). Kept for callers that still import constants. */
export const docsSections = zhSections;
/** @deprecated Prefer getDoc / docsNav with locale. */
export const docsPages = zhPages;

export function getDoc(slug: string, locale?: string) {
  return catalog(locale).pages.find((p) => p.slug === slug);
}

export function listDocsPages(locale?: string) {
  return catalog(locale).pages;
}

export function docsNav(locale?: string) {
  const { sections, pages } = catalog(locale);
  return sections.map((s) => ({
    ...s,
    pages: pages.filter((p) => p.sectionId === s.id),
  }));
}

export function searchDocs(query: string, locale?: string): DocsPage[] {
  const { pages } = catalog(locale);
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (page: DocsPage) => {
    let s = 0;
    if (page.title.toLowerCase().includes(q)) s += 10;
    if (page.description.toLowerCase().includes(q)) s += 5;
    if (page.slug.toLowerCase().includes(q)) s += 3;
    for (const b of page.body) {
      if (b.type === "p" || b.type === "h2" || b.type === "h3" || b.type === "callout") {
        if (b.text.toLowerCase().includes(q)) s += 1;
      } else if (b.type === "ul" || b.type === "ol") {
        if (b.items.some((i) => i.toLowerCase().includes(q))) s += 1;
      } else if (b.type === "code") {
        if (b.code.toLowerCase().includes(q)) s += 1;
      } else if (b.type === "table") {
        if (
          b.headers.some((h) => h.toLowerCase().includes(q)) ||
          b.rows.some((r) => r.some((c) => c.toLowerCase().includes(q)))
        )
          s += 1;
      } else if (b.type === "cards") {
        if (
          b.items.some(
            (c) =>
              c.title.toLowerCase().includes(q) ||
              c.description.toLowerCase().includes(q),
          )
        )
          s += 1;
      }
    }
    return s;
  };
  return pages
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
}

/** Markdown-ish index for /docs/llms.txt generators */
export function docsLlmsLines(origin: string = BRAND.url, locale?: string): string[] {
  const lines = ["# tabdo", ""];
  for (const section of docsNav(locale)) {
    lines.push(`## ${section.title}`);
    for (const p of section.pages) {
      lines.push(`- [${p.title}](${origin}/docs/${p.slug}.md): ${p.description}`);
    }
    lines.push("");
  }
  return lines;
}
