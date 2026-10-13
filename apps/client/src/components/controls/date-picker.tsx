import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { enUS, zhCN } from "date-fns/locale";
import { DatePicker as Primitive } from "@tabdo/ui/components/date-picker";

export function DatePicker(props: ComponentProps<typeof Primitive>) {
  const { t, i18n } = useTranslation("common");
  return <Primitive locale={i18n.language.startsWith("zh") ? zhCN : enUS} {...props} labels={{ pickDate: t("pickDate"), clear: t("clear"), empty: t("empty"), ...props.labels }} />;
}
