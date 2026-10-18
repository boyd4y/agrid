// Adapted from ehtisham-afzal/tiptap-shadcn @ 84e08b1f77ea4d0a80f5bcb498935ecee40aa95b (MIT).
// See packages/ui/third-party/tiptap-shadcn.LICENSE.
import { Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import { SearchAndReplace } from "./rich-text-search";
import Link from "@tiptap/extension-link";
// Paste may expose CSSOM rgb() values; persist only six-digit hex or inert null.
const documentColor = (value: string | null): string | null => {
  if (!value) return null;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(value);
  return rgb && rgb.slice(1).every(n => Number(n) <= 255) ? "#" + rgb.slice(1).map(n => Number(n).toString(16).padStart(2, "0")).join("") : null;
};
const SafeTextStyle = TextStyle.extend({ parseHTML() { return [{ tag: "span", getAttrs: element => documentColor(element.style.color) ? {} : false }]; } });
const SafeColor = Color.extend({ addGlobalAttributes() { return [{ types: this.options.types, attributes: { color: {
  default: null,
  parseHTML: element => documentColor(element.style.color),
  renderHTML: attrs => { const color = documentColor(attrs.color); return color ? { style: `color:${color}` } : {}; },
} } }]; } });
const SafeHighlight = Highlight.extend({ addAttributes() { return { color: {
  default: null,
  parseHTML: element => documentColor(element.getAttribute("data-color")) ?? documentColor(element.style.backgroundColor),
  renderHTML: attrs => { const color = documentColor(attrs.color); return color ? { "data-color": color, style: `background-color:${color};color:inherit` } : {}; },
} }; } });
const SafeLink = Link.extend({ addAttributes() { return { href: { default: null, parseHTML: element => element.getAttribute("href") } }; } });
const PrivateImage = Node.create({
  name: "image", group: "block", atom: true, draggable: true,
  addAttributes() { return { fileId: { default: null }, alt: { default: "" } }; },
  // External/pasted <img> never becomes an authorized private asset.
  parseHTML() { return []; },
  renderHTML({ node }) { return ["img", { "data-document-file": node.attrs.fileId, alt: node.attrs.alt }]; },
  addNodeView() { return ({ node }) => {
    const dom = document.createElement("figure"), image = document.createElement("img");
    dom.setAttribute("data-document-file", node.attrs.fileId); image.alt = node.attrs.alt; image.loading = "lazy"; dom.append(image);
    const update = () => { const source = dom.closest("[data-rich-text-editor]")?.querySelector<HTMLImageElement>(`[data-private-source="${node.attrs.fileId}"]`); if (source?.src && image.src !== source.src) image.src = source.src; };
    const observer = new MutationObserver(update); observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
    queueMicrotask(update);
    return { dom, ignoreMutation: () => true, destroy() { observer.disconnect(); } };
  }; },
});
export const createRichTextExtensions = (isAllowedUri: (url: string) => boolean) => [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }), SafeLink.configure({ openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: isAllowedUri, HTMLAttributes: { rel: "noopener noreferrer nofollow" } }), SafeTextStyle, SafeColor, SafeHighlight.configure({ multicolor: true }), TextAlign.configure({ types: ["heading", "paragraph"], defaultAlignment: null }), SearchAndReplace, PrivateImage];
