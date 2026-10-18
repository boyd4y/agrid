// Adapted from upstream basic/components/toolbars/search-and-replace-toolbar.tsx (84e08b1, MIT).
import { useId, useState } from "react";
import { useEditorState } from "@tiptap/react";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { Input } from "@tabdo/ui/components/input";
import { Checkbox } from "@tabdo/ui/components/checkbox";
import { Field, FieldGroup, FieldLabel } from "@tabdo/ui/components/field";
import { Popover, PopoverContent, PopoverTrigger } from "@tabdo/ui/components/popover";
import { searchKey } from "@tabdo/ui/lib/rich-text-search";
import { useToolbar } from "./toolbar-provider";
export function SearchAndReplaceToolbar() {
  const { editor, labels, disabled } = useToolbar(), id = useId();
  const [open, setOpen] = useState(false);
  const state = useEditorState({ editor, selector: ({ editor }) => { const s = searchKey.getState(editor.state)!; return { term: s.term, replacement: s.replacement, caseSensitive: s.caseSensitive, index: s.index, count: s.results.length }; } });
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (!value) editor.commands.setSearchTerm(""); }}><PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-8" disabled={disabled} aria-label={labels.searchReplace} title={labels.searchReplace}><Search /></Button></PopoverTrigger>
    <PopoverContent aria-label={labels.searchReplace} align="end" className="w-80">
      <FieldGroup>
        <Field><FieldLabel htmlFor={`${id}-search`}>{labels.search}</FieldLabel><Input id={`${id}-search`} value={state.term} onChange={e => editor.commands.setSearchTerm(e.target.value)} /></Field>
        <div className="flex items-center gap-2"><output aria-live="polite">{state.count ? state.index + 1 : 0}/{state.count}</output><Button type="button" variant="ghost" size="icon" aria-label={labels.previousMatch} disabled={!state.count} onClick={() => editor.commands.selectPreviousResult()}><ArrowLeft /></Button><Button type="button" variant="ghost" size="icon" aria-label={labels.nextMatch} disabled={!state.count} onClick={() => editor.commands.selectNextResult()}><ArrowRight /></Button></div>
        <Field><FieldLabel htmlFor={`${id}-replacement`}>{labels.replaceWith}</FieldLabel><Input id={`${id}-replacement`} value={state.replacement} onChange={e => editor.commands.setReplaceTerm(e.target.value)} /></Field>
        <Field orientation="horizontal"><Checkbox id={`${id}-case`} checked={state.caseSensitive} onCheckedChange={value => editor.commands.setCaseSensitive(value === true)} /><FieldLabel htmlFor={`${id}-case`}>{labels.matchCase}</FieldLabel></Field>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" size="sm" disabled={disabled || !state.count} onClick={() => editor.commands.replaceSearchResult()}>{labels.replace}</Button><Button type="button" size="sm" disabled={disabled || !state.count} onClick={() => editor.commands.replaceAllSearchResults()}>{labels.replaceAll}</Button></div>
      </FieldGroup>
    </PopoverContent>
  </Popover>;
}
