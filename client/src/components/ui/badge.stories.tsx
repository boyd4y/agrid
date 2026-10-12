import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "./badge";

const meta: Meta<typeof Badge> = {
  title: "UI/Badge",
  component: Badge,
  args: { children: "live" },
};
export default meta;
type Story = StoryObj<typeof Badge>;

export const Secondary: Story = {};
export const Success: Story = { args: { variant: "success" } };
export const Warning: Story = { args: { variant: "warning", children: "mock" } };
