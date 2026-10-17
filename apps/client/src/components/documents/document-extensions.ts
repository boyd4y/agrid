import { Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { safeDocumentLink } from "@tabdo/shared";
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
    const update = () => { const source = dom.closest("[data-document-root]")?.querySelector<HTMLImageElement>(`[data-private-source="${node.attrs.fileId}"]`); if (source?.src && image.src !== source.src) image.src = source.src; };
    const observer = new MutationObserver(update); observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
    queueMicrotask(update);
    return { dom, ignoreMutation: () => true, destroy() { observer.disconnect(); } };
  }; },
});
export const documentExtensions = [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false, underline: false }), SafeLink.configure({ openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: url => safeDocumentLink(url), HTMLAttributes: { rel: "noopener noreferrer nofollow" } }), PrivateImage];
