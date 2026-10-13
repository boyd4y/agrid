import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./dialog";

const meta: Meta<typeof DialogContent> = {
  title: "UI/Dialog", component: DialogContent,
  render: (args) => <Dialog><DialogTrigger asChild><Button variant="outline">Open dialog</Button></DialogTrigger><DialogContent {...args}><DialogHeader><DialogTitle>Accessible dialog</DialogTitle><DialogDescription>This example includes a title and description, and inherits the toolbar theme.</DialogDescription></DialogHeader><p className="text-sm">Use Escape or the close button to dismiss.</p></DialogContent></Dialog>,
};
export default meta;
type Story = StoryObj<typeof DialogContent>;

export const Default: Story = {};
export const LocalizedClose: Story = { args: { closeLabel: "关闭" } };
