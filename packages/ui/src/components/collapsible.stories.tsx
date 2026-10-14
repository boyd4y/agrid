import type { Meta, StoryObj } from "@storybook/react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";
import { Button } from "./button";
const meta: Meta<typeof Collapsible> = { title: "UI/Collapsible", component: Collapsible, render: args => <Collapsible {...args}><CollapsibleTrigger asChild><Button variant="outline">Details</Button></CollapsibleTrigger><CollapsibleContent className="py-3">Shared collapsible content</CollapsibleContent></Collapsible> };
export default meta;
type Story = StoryObj<typeof Collapsible>;
export const Default: Story = {};
export const Open: Story = { args: { defaultOpen: true } };
