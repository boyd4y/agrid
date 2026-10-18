import type { Meta, StoryObj } from "@storybook/react";
import { useState, type ComponentProps } from "react";
import { DataRefreshButton } from "./data-refresh-button";
import { Button } from "./button";

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

function FormExample() {
  const [refreshes, setRefreshes] = useState(0);
  const [submissions, setSubmissions] = useState(0);
  return <form noValidate className="flex items-center gap-3" onSubmit={event => { event.preventDefault(); setSubmissions(count => count + 1); }}>
    <DataRefreshButton onRefresh={() => setRefreshes(count => count + 1)} />
    <Button type="submit">Submit</Button>
    <output aria-label="Refresh count">{refreshes}</output>
    <output aria-label="Submit count">{submissions}</output>
  </form>;
}

export const InsideForm: Story = { render: () => <FormExample /> };
