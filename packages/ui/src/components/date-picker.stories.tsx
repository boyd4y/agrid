import type { Meta, StoryObj } from "@storybook/react";
import { useState, type ComponentProps } from "react";
import { zhCN } from "date-fns/locale";
import { DatePicker } from "./date-picker";

function DateExample(args: ComponentProps<typeof DatePicker>) {
  const [value, setValue] = useState(args.value);
  return <div className="flex flex-wrap items-center gap-3"><DatePicker {...args} value={value} onChange={setValue} /><output aria-label="Stored date" className="font-mono text-sm">{value ?? "No date selected"}</output></div>;
}

const meta: Meta<typeof DatePicker> = {
  title: "UI/DatePicker", component: DatePicker,
  args: { value: "2026-10-13" },
  render: (args) => <DateExample {...args} />,
};
export default meta;
type Story = StoryObj<typeof DatePicker>;

export const Default: Story = {};
export const FormSize: Story = { args: { size: "default" } };
export const Empty: Story = { args: { value: null } };
export const CustomFormat: Story = { args: { dateFormat: "MMM D, YYYY" } };
export const Localized: Story = { args: { locale: zhCN, labels: { pickDate: "选择日期", clear: "清空", empty: "空" } } };
