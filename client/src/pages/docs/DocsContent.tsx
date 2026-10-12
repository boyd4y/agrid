import { Link } from "react-router-dom";
import type { DocsBlock } from "@/data/docs";
import { cn } from "@/lib/utils";

export function DocsContent({ blocks }: { blocks: DocsBlock[] }) {
  return (
    <div className="space-y-5 text-[15px] leading-relaxed text-foreground">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "p":
            return (
              <p key={i} className="text-foreground/90">
                {b.text}
              </p>
            );
          case "h2":
            return (
              <h2
                key={i}
                className="scroll-mt-24 pt-4 text-xl font-semibold tracking-tight"
              >
                {b.text}
              </h2>
            );
          case "h3":
            return (
              <h3 key={i} className="scroll-mt-24 pt-2 text-base font-semibold">
                {b.text}
              </h3>
            );
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1.5 pl-5 text-foreground/90">
                {b.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="list-decimal space-y-1.5 pl-5 text-foreground/90">
                {b.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ol>
            );
          case "callout":
            return (
              <aside
                key={i}
                className={cn(
                  "rounded-xl border px-4 py-3 text-sm",
                  b.tone === "warn"
                    ? "border-warning/30 bg-warning/10 text-foreground"
                    : "border-primary/30 bg-primary/10 text-foreground"
                )}
              >
                {b.text}
              </aside>
            );
          case "code":
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-xl border border-border bg-muted p-4 text-[12.5px] leading-relaxed text-foreground"
              >
                <code>{b.code}</code>
              </pre>
            );
          case "cards":
            return (
              <div key={i} className="grid gap-3 sm:grid-cols-2">
                {b.items.map((card) => (
                  <Link
                    key={card.href}
                    to={card.href}
                    className="group rounded-2xl border border-border bg-background p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                  >
                    {card.badge ? (
                      <span className="mb-2 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {card.badge}
                      </span>
                    ) : null}
                    <div className="text-base font-semibold group-hover:text-primary">
                      {card.title}
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {card.description}
                    </p>
                  </Link>
                ))}
              </div>
            );
          case "table":
            return (
              <div
                key={i}
                className="overflow-x-auto rounded-xl border border-border"
              >
                <table className="w-full min-w-[420px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="bg-muted">
                      {b.headers.map((h) => (
                        <th
                          key={h}
                          className="border-b border-border px-3 py-2 font-medium"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, ri) => (
                      <tr key={ri} className="odd:bg-background even:bg-muted/40">
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            className="border-b border-border px-3 py-2 align-top text-foreground/90"
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
