import type { Meta, StoryObj } from "@storybook/react";
import { RadioGroup, RadioGroupItem } from "./radio-group";
import { Label } from "./label";
const meta: Meta<typeof RadioGroup> = { title: "UI/RadioGroup", component: RadioGroup, render: args => <RadioGroup defaultValue="first" {...args}>{["first", "second"].map(value => <div key={value} className="flex items-center gap-2"><RadioGroupItem id={`radio-${value}`} value={value} /><Label htmlFor={`radio-${value}`}>{value}</Label></div>)}</RadioGroup> };
export default meta;
type Story = StoryObj<typeof RadioGroup>;
export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
