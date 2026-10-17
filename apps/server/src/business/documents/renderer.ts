import { documentContentSchema, type DocumentContent, type DocumentNode } from "@tabdo/shared";
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
export function documentImageIds(content: DocumentContent): string[] {
  const result = new Set<string>(), pending = [...content.content];
  while (pending.length) { const node = pending.pop()!; if (node.type === "image") result.add(String(node.attrs!.fileId)); pending.push(...node.content ?? []); }
  return [...result];
}
/** No HTML input and no runtime/editor dependency. Assets are deterministic relative paths.
 * A publisher must copy the explicitly returned private assets and keep this path mapping.
 */
export function renderDocumentHtml(value: DocumentContent): string {
  documentContentSchema.parse(value);
  const render = (node: DocumentNode): string => {
    const children = () => (node.content ?? []).map(render).join("");
    switch (node.type) {
      case "text": {
        let result = escape(node.text!);
        for (const mark of node.marks ?? []) {
          if (mark.type === "link") result = `<a href="${escape(mark.attrs.href)}" rel="noopener noreferrer nofollow">${result}</a>`;
          else { const tag = { bold: "strong", italic: "em", strike: "s", code: "code" }[mark.type]; result = `<${tag}>${result}</${tag}>`; }
        }
        return result;
      }
      case "heading": { const tag = `h${node.attrs!.level}`; return `<${tag}>${children()}</${tag}>`; }
      case "paragraph": return `<p>${children()}</p>`;
      case "bulletList": return `<ul>${children()}</ul>`;
      case "orderedList": return `<ol start="${node.attrs?.start ?? 1}">${children()}</ol>`;
      case "listItem": return `<li>${children()}</li>`;
      case "blockquote": return `<blockquote>${children()}</blockquote>`;
      case "codeBlock": return `<pre><code>${children()}</code></pre>`;
      case "hardBreak": return "<br>";
      case "horizontalRule": return "<hr>";
      case "image": return `<img src="document-assets/${node.attrs!.fileId}" alt="${escape(String(node.attrs!.alt))}" loading="lazy">`;
      default: throw new Error("Unsupported validated document node");
    }
  };
  return value.content.map(render).join("");
}
