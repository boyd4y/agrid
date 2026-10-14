import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { TimePicker, type TimePickerProps } from "./time-picker";
function Example(args: TimePickerProps) {
  const [value, setValue] = useState(args.value);
  return <div className="w-64"><TimePicker {...args} value={value} onChange={setValue} /></div>;
}
const meta: Meta<typeof TimePicker> = { title: "UI/TimePicker", component: TimePicker, args: { value: "09:00" }, render: args => <Example {...args} /> };
export default meta;
type Story = StoryObj<typeof TimePicker>;
export const Default: Story = {};
export const Localized: Story = { args: { labels: { hour: "小时", minute: "分钟" } } };
export const Disabled: Story = { args: { disabled: true } };
