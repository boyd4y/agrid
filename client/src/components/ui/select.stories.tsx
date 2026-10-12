import type { Meta, StoryObj } from "@storybook/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

const meta: Meta = {
  title: "UI/Select",
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <Select defaultValue="codex">
      <SelectTrigger className="w-48">
        <SelectValue placeholder="Harness" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="codex">Codex</SelectItem>
        <SelectItem value="claude">Claude</SelectItem>
        <SelectItem value="pi">Pi</SelectItem>
      </SelectContent>
    </Select>
  ),
};

export const Small: StoryObj = {
  render: () => (
    <Select defaultValue="and">
      <SelectTrigger size="sm" className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="and">且 AND</SelectItem>
        <SelectItem value="or">或 OR</SelectItem>
      </SelectContent>
    </Select>
  ),
};
