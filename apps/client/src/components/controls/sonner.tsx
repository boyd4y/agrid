import type { ComponentProps } from "react";
import { Toaster as Primitive } from "@tabdo/ui/components/sonner";
import { useTheme } from "@/components/theme/theme-provider";
export function Toaster(props: ComponentProps<typeof Primitive>) {
  const { resolved } = useTheme();
  return <Primitive theme={resolved} {...props} />;
}
