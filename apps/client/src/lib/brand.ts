import i18n from "@/i18n";

export const BRAND = {
  name: "tabdo",
  domain: "tabdo.ai",
  url: "https://tabdo.ai",
  alternateDomain: "tabdo.dev",
} as const;

/** Live marketing copy — reads current i18n language. */
export const BRAND_COPY = {
  get category() {
    return i18n.t("marketing:brand.category");
  },
  get slogan() {
    return i18n.t("marketing:brand.slogan");
  },
  get description() {
    return i18n.t("marketing:brand.description");
  },
} as const;
