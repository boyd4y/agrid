import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState, type ComponentProps } from "react";
import { Button } from "./button";
import { SearchInput } from "./search-input";

function ControlledExample(args: ComponentProps<typeof SearchInput>) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  return <div className="flex max-w-sm flex-col gap-3">
    <SearchInput {...args} ref={ref} value={value} onChange={event => setValue(event.target.value)} />
    <output aria-label="Search value">{value}</output>
    <Button variant="outline" onClick={() => { setValue(""); ref.current?.focus(); }}>Clear and focus</Button>
  </div>;
}

const meta: Meta<typeof SearchInput> = {
  title: "UI/SearchInput",
  component: SearchInput,
  args: { "aria-label": "Search tables", placeholder: "Search tables", containerClassName: "w-full max-w-sm" },
};
export default meta;
type Story = StoryObj<typeof SearchInput>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Controlled: Story = { render: args => <ControlledExample {...args} /> };
export const Localized: Story = { args: { "aria-label": "搜索表格", placeholder: "搜索表格" } };
