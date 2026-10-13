import { parseBotAvatar } from "@tabdo/shared";
import { BotAvatar } from "@/components/agents/BotAvatar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function MemberAvatar({ name, image, kind = "human", className }: {
  name: string; image?: string | null; kind?: string; className?: string;
}) {
  return <Avatar className={cn("size-10", className)}>
    {image && !parseBotAvatar(image) && <AvatarImage src={image} alt={`${name}的头像`} className="object-cover" />}
    <AvatarFallback>{kind === "agent" ? <BotAvatar config={parseBotAvatar(image)} label={`${name}的头像`} className="size-full" /> : name.trim().slice(0, 1).toUpperCase() || "?"}</AvatarFallback>
  </Avatar>;
}
