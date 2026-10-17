import calendarZh from "./locales/zh-CN/calendar.json";
import calendarEn from "./locales/en/calendar.json";
import sitesZh from "./locales/zh-CN/sites.json";
import sitesEn from "./locales/en/sites.json";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import iconsZh from "./locales/zh-CN/icons.json";
import iconsEn from "./locales/en/icons.json";

import commonZh from "./locales/zh-CN/common.json";
import errorsZh from "./locales/zh-CN/errors.json";
import appZh from "./locales/zh-CN/app.json";
import chatZh from "./locales/zh-CN/chat.json";
import docsZh from "./locales/zh-CN/docs.json";
import marketingZh from "./locales/zh-CN/marketing.json";
import authZh from "./locales/zh-CN/auth.json";
import filtersZh from "./locales/zh-CN/filters.json";
import tableZh from "./locales/zh-CN/table.json";
import formZh from "./locales/zh-CN/form.json";
import automationZh from "./locales/zh-CN/automation.json";
import reportsZh from "./locales/zh-CN/reports.json";
import integrationsZh from "./locales/zh-CN/integrations.json";
import agentsZh from "./locales/zh-CN/agents.json";

import commonEn from "./locales/en/common.json";
import errorsEn from "./locales/en/errors.json";
import appEn from "./locales/en/app.json";
import chatEn from "./locales/en/chat.json";
import docsEn from "./locales/en/docs.json";
import marketingEn from "./locales/en/marketing.json";
import authEn from "./locales/en/auth.json";
import filtersEn from "./locales/en/filters.json";
import tableEn from "./locales/en/table.json";
import formEn from "./locales/en/form.json";
import automationEn from "./locales/en/automation.json";
import reportsEn from "./locales/en/reports.json";
import integrationsEn from "./locales/en/integrations.json";
import agentsEn from "./locales/en/agents.json";

export const LOCALE_STORAGE_KEY = "tabdo.locale";
export const LEGACY_LOCALE_KEYS = ["agrid.locale"] as const;
export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

function readStoredLocale(): AppLocale {
  if (typeof window === "undefined") return "zh-CN";
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (raw === "en" || raw === "zh-CN") return raw;
    for (const key of LEGACY_LOCALE_KEYS) {
      const legacy = window.localStorage.getItem(key);
      if (legacy === "en" || legacy === "zh-CN") {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, legacy);
        window.localStorage.removeItem(key);
        return legacy;
      }
      if (legacy === "zh" || legacy === "zh_CN") {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
        window.localStorage.removeItem(key);
        return "zh-CN";
      }
    }
  } catch {
    /* ignore */
  }
  return "zh-CN";
}

export function persistLocale(locale: AppLocale) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
  }
}

export function setAppLocale(locale: AppLocale) {
  persistLocale(locale);
  return i18n.changeLanguage(locale);
}

const initial = readStoredLocale();

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": {
      sites: sitesZh,
      calendar: calendarZh,
      icons: iconsZh,
      common: commonZh,
      errors: errorsZh,
      app: appZh,
      chat: chatZh,
      docs: docsZh,
      marketing: marketingZh,
      auth: authZh,
      table: tableZh,
      filters: filtersZh,
      form: formZh,
      automation: automationZh,
      reports: reportsZh,
      agents: agentsZh,
      integrations: integrationsZh,
    },
    en: {
      sites: sitesEn,
      calendar: calendarEn,
      icons: iconsEn,
      common: commonEn,
      errors: errorsEn,
      app: appEn,
      chat: chatEn,
      docs: docsEn,
      marketing: marketingEn,
      auth: authEn,
      table: tableEn,
      filters: filtersEn,
      form: formEn,
      automation: automationEn,
      reports: reportsEn,
      agents: agentsEn,
      integrations: integrationsEn,
    },
  },
  lng: initial,
  fallbackLng: "zh-CN",
  defaultNS: "common",
  ns: ["sites", "icons", "common", "errors", "app", "chat", "docs", "marketing", "auth", "table", "filters", "form", "automation", "reports", "agents", "integrations"],
  interpolation: { escapeValue: false },
  returnNull: false,
});

persistLocale(initial);

export default i18n;
