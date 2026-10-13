import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { DataRefreshButton as Primitive } from "@tabdo/ui/components/data-refresh-button";
export function DataRefreshButton(props: ComponentProps<typeof Primitive>) {
  const { t } = useTranslation("common");
  return <Primitive label={t("refresh")} {...props} />;
}
