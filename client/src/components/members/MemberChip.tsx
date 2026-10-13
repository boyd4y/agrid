import { MemberAvatar } from "./MemberAvatar";

/** One geometry for a person or bot in table cells and board properties. */
export function MemberChip({ name, kind, image }: {
  name: string; kind?: string; image?: string | null;
}) {
  return <span className="inline-flex h-6 max-w-full items-center gap-1.5 rounded bg-muted px-1.5 align-middle text-xs font-medium text-foreground" data-member-chip data-member-kind={kind === "agent" ? "agent" : "human"} title={name}>
    <MemberAvatar name={name} kind={kind} image={image} className="size-4 [&>span]:text-[10px]" />
    <span className="min-w-0 truncate leading-4">{name}</span>
  </span>;
}
