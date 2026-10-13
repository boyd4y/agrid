import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { ColorPicker as Primitive } from "@tabdo/ui/components/color-picker";
import { SELECT_COLOR_NAMES, SELECT_COLOR_PALETTE, selectOptionStyle } from "@/lib/select-colors";

export function ColorPicker(props: ComponentProps<typeof Primitive>) {
  const { t } = useTranslation("common");
  return <Primitive {...props} value={selectOptionStyle(props.value).background}
    presets={props.presets ?? SELECT_COLOR_PALETTE.map(({ token, hex }) => ({ hex, label: SELECT_COLOR_NAMES[token] }))}
    labels={{ pickColor: t("pickColor"), colorPicker: t("colorPicker"), colorPalette: t("colorPalette"),
      saturationBrightness: t("saturationBrightness"), colorSaturation: t("colorSaturation"), colorBrightness: t("colorBrightness"),
      colorHue: t("colorHue"), presetColors: t("presetColors"), hexColor: t("hexColor"), hexInvalid: t("hexInvalid"), ...props.labels }} />;
}
