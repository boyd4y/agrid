import type { Meta, StoryObj } from "@storybook/react";
import { useState, type ComponentProps } from "react";
import { DateTimePicker } from "./date-time-picker";
function Example(args: ComponentProps<typeof DateTimePicker>) {
  const [value, setValue] = useState(args.value);
  return <div className="w-96"><DateTimePicker {...args} value={value} onChange={setValue} /><output>{value}</output></div>;
}
const meta: Meta<typeof DateTimePicker> = { title: "UI/DateTimePicker", component: DateTimePicker, args: { value: "2026-10-14T10:30:00.000Z" }, render: args => <Example {...args} /> };
export default meta;
type Story = StoryObj<typeof DateTimePicker>;
export const Default: Story = {};
export const Empty: Story = { args: { value: null } };
