import type { Meta, StoryObj } from "@storybook/react";
import { useState, type ComponentProps } from "react";
import { Button } from "./button";
import { DeleteConfirmation } from "./delete-confirmation";

function ConfirmationExample(args: ComponentProps<typeof DeleteConfirmation>) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  return <div className="flex items-center gap-3"><Button variant="destructive" onClick={() => setOpen(true)}>Delete example</Button><output aria-label="Completed confirmations">Confirmed: {count}</output><DeleteConfirmation {...args} open={open} onOpenChange={setOpen} onConfirm={async () => { await args.onConfirm(); setCount((count) => count + 1); }} /></div>;
}

const meta: Meta<typeof DeleteConfirmation> = {
  title: "UI/DeleteConfirmation", component: DeleteConfirmation,
  args: { title: "Delete this example?", description: "This demonstration changes only its local confirmation counter.", onConfirm: async () => {} },
  render: (args) => <ConfirmationExample {...args} />,
};
export default meta;
type Story = StoryObj<typeof DeleteConfirmation>;

export const Default: Story = {};
export const Pending: Story = { args: { onConfirm: () => new Promise<void>((resolve) => setTimeout(resolve, 1500)) } };
export const Failure: Story = { args: { onConfirm: async () => { throw new Error("The example could not be deleted. Try again."); } } };
export const Localized: Story = { args: { title: "删除示例？", description: "本示例只更新本地确认次数。", labels: { cancel: "取消", deleting: "删除中…", confirmDelete: "确认删除", deleteFailedRetry: "删除失败，请重试" } } };
