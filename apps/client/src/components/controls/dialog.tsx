import { forwardRef, type ComponentProps, type ComponentRef } from "react";
import { useTranslation } from "react-i18next";
import { DialogContent as Primitive } from "@tabdo/ui/components/dialog";
export { Dialog, DialogTrigger, DialogPortal, DialogClose, DialogOverlay, DialogHeader, DialogTitle, DialogDescription } from "@tabdo/ui/components/dialog";
export const DialogContent = forwardRef<ComponentRef<typeof Primitive>, ComponentProps<typeof Primitive>>((props, ref) => {
  const { t } = useTranslation("common");
  return <Primitive ref={ref} closeLabel={t("close")} {...props} />;
});
DialogContent.displayName = "DialogContent";
