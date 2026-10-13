import { parseBotAvatar } from "@tabdo/shared";
import { BotAvatar } from "@/components/agents/BotAvatar";
import { Avatar, AvatarFallback, AvatarImage } from "@tabdo/ui/components/avatar";
import { cn } from "@/lib/utils";
import i18n from "@/i18n";

export function MemberAvatar({ name, image, kind = "human", className }: {
  name: string; image?: string | null; kind?: string; className?: string;
}) {
  return <Avatar className={cn("size-10", className)}>
    {image && !parseBotAvatar(image) && <AvatarImage src={image} alt={i18n.t("common:avatarOf", { name })} className="object-cover" />}
    <AvatarFallback>{kind === "agent" ? <BotAvatar config={parseBotAvatar(image)} label={i18n.t("common:avatarOf", { name })} className="size-full" /> : name.trim().slice(0, 1).toUpperCase() || "?"}</AvatarFallback>
  </Avatar>;
}
