import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "./input";

const meta: Meta<typeof Input> = {
  title: "UI/Input",
  component: Input,
  args: { placeholder: "Enter a value…", "aria-label": "Value" },
};
export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {};
export const Small: Story = { args: { size: "sm" } };
export const Invalid: Story = { args: { "aria-invalid": true, defaultValue: "Invalid value" } };
