import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { CodeEditor, type CodeEditorProps } from "./code-editor";
function Example(args: CodeEditorProps) { const [value, setValue] = React.useState(args.value); return <CodeEditor {...args} value={value} onChange={setValue} />; }
const meta: Meta<typeof CodeEditor> = { title: "UI/CodeEditor", component: CodeEditor, render: args => <Example {...args} /> };
export default meta;
type Story = StoryObj<typeof CodeEditor>;
export const Markdown: Story = { args: { filename: "SKILL.md", value: "---\nname: table\ndescription: Work with records\n---\n\n# Table\n\nUse **batch operations** for several records.\n", "aria-label": "Skill document" } };
export const Python: Story = { args: { filename: "scripts/check.py", value: "import json\n\ndef check(records):\n    return len(records) > 0\n\nprint(check([]))\n" } };
export const ReadOnly: Story = { args: { ...Python.args, readOnly: true } };
export const Json: Story = { args: { filename: "config.json", value: '{\n  "enabled": true,\n  "limit": 100\n}\n' } };
export const TypeScript: Story = { args: { filename: "scripts/index.ts", value: "export function count(rows: string[]): number {\n  return rows.length;\n}\n" } };
export const Yaml: Story = { args: { filename: "config.yaml", value: "name: table\nenabled: true\nfields:\n  - title\n  - owner\n" } };
