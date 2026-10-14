import type { Meta, StoryObj } from "@storybook/react";
import { Slider } from "./slider";
const meta: Meta<typeof Slider> = { title: "UI/Slider", component: Slider, args: { defaultValue: [35], max: 100, 'aria-label': 'Value' }, decorators: [Story => <div className="w-64"><Story /></div>] };
export default meta;
type Story = StoryObj<typeof Slider>;
export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
