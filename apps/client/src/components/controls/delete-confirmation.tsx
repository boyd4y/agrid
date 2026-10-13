import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { DeleteConfirmation as Primitive } from "@tabdo/ui/components/delete-confirmation";

export function DeleteConfirmation(props: ComponentProps<typeof Primitive>) {
  const { t, i18n } = useTranslation("common");
  return <Primitive {...props} labels={{ cancel: t("cancel"), deleting: t("deleting"), confirmDelete: t("confirmDelete"), deleteFailedRetry: t("deleteFailedRetry"), ...props.labels }} />;
}
