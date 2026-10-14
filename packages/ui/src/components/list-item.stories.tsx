import type { Meta, StoryObj } from "@storybook/react";
import { Trash2 } from "lucide-react";
import { Button } from "./button";
import { ListItem } from "./list-item";

function ListExample() {
  return <ul className="flex max-w-lg flex-col gap-3">{["Inbox connection", "Notification webhook"].map(name => <ListItem key={name} className="flex items-center gap-3"><button className="absolute inset-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Edit ${name}`} /><div className="pointer-events-none min-w-0 flex-1"><p className="font-medium">{name}</p><p className="text-sm text-muted-foreground">Hover the row or focus an action.</p></div><Button variant="destructive-ghost" size="icon" className="relative" aria-label={`Delete ${name}`}><Trash2 data-icon="inline-start" /></Button></ListItem>)}</ul>;
}
const meta: Meta<typeof ListExample> = { title: "UI/List item", component: ListExample };
export default meta;
type Story = StoryObj<typeof ListExample>;
export const Default: Story = {};
