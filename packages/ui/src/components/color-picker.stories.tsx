import type { Meta, StoryObj } from "@storybook/react";
import { useState, type ComponentProps } from "react";
import { ColorPicker } from "./color-picker";

function ColorExample(args: ComponentProps<typeof ColorPicker>) {
  const [value, setValue] = useState(args.value);
  return <div className="flex items-center gap-3"><ColorPicker {...args} value={value} onChange={setValue} /><output aria-label="Selected color" className="font-mono text-sm">{value}</output></div>;
}

const meta: Meta<typeof ColorPicker> = {
  title: "UI/ColorPicker", component: ColorPicker,
  args: { value: "#3b82f6" },
  render: (args) => <ColorExample {...args} />,
};
export default meta;
type Story = StoryObj<typeof ColorPicker>;

export const Default: Story = {};
export const CustomPresets: Story = { args: { label: "Choose an accent", presets: [{ hex: "#1769b7", label: "Ocean" }, { hex: "#795096", label: "Orchid" }, { hex: "#167064", label: "Forest" }] } };
export const Localized: Story = { args: { labels: { pickColor: "选择颜色", colorPicker: "颜色选择器", colorPalette: "颜色面板", saturationBrightness: "饱和度和亮度", colorSaturation: "饱和度", colorBrightness: "亮度", colorHue: "色相", presetColors: "预设颜色", hexColor: "HEX 颜色", hexInvalid: "请输入有效的 HEX 颜色" }, presets: [{ hex: "#3b82f6", label: "蓝色" }, { hex: "#22c55e", label: "绿色" }] } };
