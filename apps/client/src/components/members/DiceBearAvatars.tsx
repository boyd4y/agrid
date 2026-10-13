import { useMemo, useState } from "react";
import { Avatar, Style } from "@dicebear/core";
import definition from "@dicebear/styles/notionists.json";
import croodlesDefinition from "@dicebear/styles/croodles.json";
import { RefreshCw, UserRound, Pencil } from "lucide-react";
import { Button } from "@tabdo/ui/components/button";
import { FieldDescription } from "@tabdo/ui/components/field";
import { Tabs, TabsList, TabsTrigger } from "@tabdo/ui/components/tabs";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

const notionists = new Style(definition);
const croodles = new Style(croodlesDefinition);

export async function rasterizeAvatar(source: string) {
  const picture = new Image(); picture.src = source;
  await picture.decode();
  const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(i18n.t("common:avatarGenFailed"));
  context.drawImage(picture, 0, 0, 256, 256);
  return canvas.toDataURL("image/webp", 0.9);
}

export default function DiceBearAvatars({ seed, onSelect, disabled }: { seed: string; onSelect: (source: string) => void; disabled: boolean }) {
  const { t } = useTranslation("common");
  const [batch, setBatch] = useState(0);
  const [style, setStyle] = useState("notionists");
  const options = useMemo(() => Array.from({ length: 18 }, (_, index) => new Avatar(style === "croodles" ? croodles : notionists, { seed: `${seed}:${batch}:${index}`, backgroundColor: ["ffffff"] }).toDataUri()), [seed, batch, style]);
  return <div className="flex flex-col gap-3" data-testid="dicebear-avatar-picker">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">{t("pickAvatar")}</h3><Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setBatch((value) => value + 1)}><RefreshCw data-icon="inline-start" />{t("refreshAvatars")}</Button></div>
    <Tabs value={style} onValueChange={setStyle}><TabsList className="w-full"><TabsTrigger value="notionists" className="flex-1" disabled={disabled}><UserRound />Notionists</TabsTrigger><TabsTrigger value="croodles" className="flex-1" disabled={disabled}><Pencil />Croodles</TabsTrigger></TabsList></Tabs>
    <div className="grid grid-cols-6 gap-2">
      {options.map((source, index) => <Button key={source} type="button" variant="outline" size="icon" className="aspect-square h-auto w-full max-w-12 overflow-hidden rounded-full p-0" disabled={disabled} aria-label={t("pickAvatarN", { n: index + 1 })} onClick={() => onSelect(source)}><img src={source} alt="" className="size-full object-cover" /></Button>)}
    </div>
    <FieldDescription>{style === "croodles" ? <><a href="https://vjy.me/" target="_blank" rel="noreferrer">Croodles / Vijay Verma</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> · DiceBear</> : "Notionists · DiceBear / Zoish · CC0"}</FieldDescription>
  </div>;
}
