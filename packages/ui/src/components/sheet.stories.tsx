import type { Meta, StoryObj } from "@storybook/react";
import { X } from "lucide-react";
import { Button } from "./button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "./sheet";

function SheetExample({ modal = true }: { modal?: boolean }) {
  return <Sheet modal={modal}>
    <SheetTrigger asChild><Button variant="outline">Open sheet</Button></SheetTrigger>
    <SheetContent>
      <SheetHeader>
        <div className="flex items-center justify-between gap-3">
          <SheetTitle className="font-semibold">Activity</SheetTitle>
          <SheetClose asChild><Button variant="ghost" size="icon" aria-label="Close"><X /></Button></SheetClose>
        </div>
        <SheetDescription className="text-sm text-muted-foreground">Recent activity for this item.</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">No activity yet.</div>
    </SheetContent>
  </Sheet>;
}

const meta: Meta<typeof SheetExample> = { title: "UI/Sheet", component: SheetExample };
export default meta;
type Story = StoryObj<typeof SheetExample>;
export const Default: Story = {};
export const Nonmodal: Story = { args: { modal: false } };
