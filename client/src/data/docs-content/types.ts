export type DocsSection = {
  id: string;
  title: string;
  description: string;
  audience?: "agents" | "humans" | "both" | "ref";
};

export type DocsPage = {
  slug: string;
  sectionId: string;
  title: string;
  description: string;
  body: DocsBlock[];
};

export type DocsBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "callout"; tone?: "info" | "warn"; text: string }
  | { type: "code"; lang?: string; code: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | {
      type: "cards";
      items: { title: string; description: string; href: string; badge?: string }[];
    };
