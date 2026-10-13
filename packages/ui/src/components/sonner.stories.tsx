import type { Meta, StoryObj } from "@storybook/react";
import { toast } from "sonner";
import { Button } from "./button";
import { Toaster } from "./sonner";

const meta: Meta<typeof Toaster> = {
  title: "UI/Sonner", component: Toaster,
  render: (args, context) => <div className="flex flex-wrap gap-2"><Toaster theme={context.globals.theme === "dark" ? "dark" : "light"} {...args} /><Button onClick={() => toast.success("Saved successfully")}>Success toast</Button><Button variant="outline" onClick={() => toast.error("Could not save", { description: "This is a standalone example." })}>Error toast</Button><Button variant="outline" onClick={() => toast.info("已更新", { description: "提示文本由调用方提供。" })}>Localized toast</Button></div>,
};
export default meta;
type Story = StoryObj<typeof Toaster>;

export const Default: Story = {};
export const BottomLeft: Story = { args: { position: "bottom-left" } };
