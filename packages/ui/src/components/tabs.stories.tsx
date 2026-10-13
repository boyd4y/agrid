import type { Meta, StoryObj } from "@storybook/react";
import { User, Wrench } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { cn } from "@tabdo/ui/lib/utils";

function TabsExample({ variant = "default", orientation = "horizontal" }: { variant?: "default" | "line"; orientation?: "horizontal" | "vertical" }) {
  const vertical = orientation === "vertical";
  return <Tabs defaultValue="profile" orientation={orientation} className={cn("w-full max-w-lg", vertical && "flex-row gap-6")}>
    <TabsList variant={variant} className={cn(vertical && "h-auto w-44 shrink-0 flex-col items-stretch")}>
      <TabsTrigger value="profile" className={cn(vertical && "justify-start")}><User />Profile</TabsTrigger>
      <TabsTrigger value="tools" className={cn(vertical && "justify-start")}><Wrench />Tools</TabsTrigger>
    </TabsList>
    <TabsContent value="profile" className="p-3">Profile settings</TabsContent>
    <TabsContent value="tools" className="p-3">Available tools</TabsContent>
  </Tabs>;
}

const meta: Meta<typeof TabsExample> = { title: "UI/Tabs", component: TabsExample };
export default meta;
type Story = StoryObj<typeof TabsExample>;
export const Default: Story = {};
export const Line: Story = { args: { variant: "line" } };
export const VerticalLine: Story = { args: { variant: "line", orientation: "vertical" } };
