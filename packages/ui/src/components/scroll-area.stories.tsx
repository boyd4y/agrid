import type { Meta, StoryObj } from "@storybook/react";
import { ScrollArea, ScrollBar } from "./scroll-area";
import { Button } from "./button";
function Example({ language = "en" }: { language?: "en" | "zh-CN" }) {
  return <ScrollArea type="always" className="w-72 max-w-full rounded-md border p-2"><div className="flex w-max gap-2 pb-2">{Array.from({ length: 12 }, (_, index) => <Button type="button" key={index} variant="outline">{language === "en" ? "Action" : "操作"} {index + 1}</Button>)}</div><ScrollBar orientation="horizontal" /></ScrollArea>;
}
const meta: Meta<typeof Example> = { title: "UI/ScrollArea", component: Example };
export default meta;
type Story = StoryObj<typeof meta>;
export const Horizontal: Story = { args: { language: "en" } };
export const Chinese: Story = { args: { language: "zh-CN" } };
