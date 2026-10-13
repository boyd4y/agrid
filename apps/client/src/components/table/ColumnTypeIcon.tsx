import { Paperclip, Type, Hash, List, Tags, Calendar, CheckSquare, User, FunctionSquare, Link2, Sigma } from "lucide-react";
import type { ColumnType } from "@/types/table";

const icons = {
  file: Paperclip, text: Type, number: Hash, select: List, multi_select: Tags, date: Calendar,
  checkbox: CheckSquare, person: User, formula: FunctionSquare, relation: Link2, rollup: Sigma,
} satisfies Record<ColumnType, typeof Type>;

/** The same icon in column headers, settings and field type pickers. */
export function ColumnTypeIcon({ type, className }: { type: ColumnType; className?: string }) {
  const Icon = icons[type];
  return <Icon className={className} aria-hidden />;
}
