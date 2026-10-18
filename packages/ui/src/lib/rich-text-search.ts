// Adapted from upstream basic/components/extensions/search-and-replace.tsx
// ehtisham-afzal/tiptap-shadcn @ 84e08b1 (MIT), see third-party/tiptap-shadcn.LICENSE.
import { Extension, type Range, type CommandProps } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type SearchState = { term: string; replacement: string; caseSensitive: boolean; index: number; results: Range[]; decorations: DecorationSet };
export const searchKey = new PluginKey<SearchState>("searchAndReplace");
const empty: SearchState = { term: "", replacement: "", caseSensitive: false, index: 0, results: [], decorations: DecorationSet.empty };
// Search a whole textblock so a match may cross bold/link/textStyle boundaries.
export function searchRanges(doc: Node, term: string, caseSensitive: boolean): Range[] {
  const ranges: Range[] = [];
  if (!term) return ranges;
  const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "gu" : "gui");
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    // Use a one-character separator for inline atoms/hard breaks to preserve PM offsets.
    const text = node.textBetween(0, node.content.size, "\n", "\ufffc");
    for (const match of text.matchAll(regex)) ranges.push({ from: pos + 1 + match.index!, to: pos + 1 + match.index! + match[0].length });
    return false;
  });
  return ranges;
}
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    searchAndReplace: {
      setSearchTerm(term: string): ReturnType;
      setReplaceTerm(replacement: string): ReturnType;
      setCaseSensitive(caseSensitive: boolean): ReturnType;
      selectNextResult(): ReturnType;
      selectPreviousResult(): ReturnType;
      replaceSearchResult(): ReturnType;
      replaceAllSearchResults(): ReturnType;
    };
  }
}
export const SearchAndReplace = Extension.create({
  name: "searchAndReplace",
  addCommands() {
    const update = (patch: Partial<SearchState>) => ({ tr, dispatch }: CommandProps) => {
      if (dispatch) tr.setMeta(searchKey, patch).setMeta("addToHistory", false);
      return true;
    };
    const navigate = (step: number) => ({ state, tr, dispatch }: CommandProps) => {
      const current = searchKey.getState(state)!;
      if (!current.results.length) return false;
      const index = (current.index + step + current.results.length) % current.results.length;
      if (dispatch) tr.setMeta(searchKey, { index }).setMeta("addToHistory", false);
      return true;
    };
    return {
      setSearchTerm: term => update({ term, index: 0 }),
      setReplaceTerm: replacement => update({ replacement }),
      setCaseSensitive: caseSensitive => update({ caseSensitive, index: 0 }),
      selectNextResult: () => navigate(1), selectPreviousResult: () => navigate(-1),
      replaceSearchResult: () => ({ state, tr, dispatch }) => {
        const current = searchKey.getState(state)!, result = current.results[current.index];
        if (!result) return false;
        if (dispatch) tr.insertText(current.replacement, result.from, result.to);
        return true;
      },
      replaceAllSearchResults: () => ({ state, tr, dispatch }) => {
        const current = searchKey.getState(state)!;
        if (!current.results.length) return false;
        if (dispatch) for (const result of [...current.results].reverse()) tr.insertText(current.replacement, result.from, result.to);
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    return [new Plugin<SearchState>({ key: searchKey, state: {
      init: () => empty,
      apply(tr, previous) {
        const patch = tr.getMeta(searchKey) as Partial<SearchState> | undefined;
        if (!tr.docChanged && !patch) return previous;
        const next = { ...previous, ...patch };
        next.results = searchRanges(tr.doc, next.term, next.caseSensitive);
        next.index = Math.min(next.index, Math.max(0, next.results.length - 1));
        next.decorations = DecorationSet.create(tr.doc, next.results.map(({ from, to }, index) => Decoration.inline(from, to, { class: index === next.index ? "rich-text-search-selected" : "rich-text-search-result" })));
        return next;
      },
    }, props: { decorations: state => searchKey.getState(state)?.decorations }, view: () => ({ update(view, prev) {
      const current = searchKey.getState(view.state)!, old = searchKey.getState(prev)!;
      if (current.index === old.index && current.term === old.term) return;
      const result = current.results[current.index];
      if (result) { const found = view.domAtPos(result.from).node; (found.nodeType === 1 ? found as Element : found.parentElement)?.scrollIntoView({ block: "nearest" }); }
    } }) })];
  },
});
