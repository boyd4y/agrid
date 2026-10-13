import type { Meta, StoryObj } from "@storybook/react";
import { useState, type ComponentProps } from "react";
import { DataRefreshButton } from "./data-refresh-button";

function RefreshExample(args: ComponentProps<typeof DataRefreshButton>) {
  const [count, setCount] = useState(0);
  return <div className="flex items-center gap-3"><DataRefreshButton {...args} onRefresh={() => setCount((count) => count + 1)} /><output aria-label="Refresh count">Refreshes: {count}</output></div>;
}

const meta: Meta<typeof DataRefreshButton> = { title: "UI/DataRefreshButton", component: DataRefreshButton, render: (args) => <RefreshExample {...args} /> };
export default meta;
type Story = StoryObj<typeof DataRefreshButton>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Localized: Story = { args: { label: "刷新" } };
