import { Shapes, Smile, Palette, Check } from "lucide-react";
import { defaultBotAvatar, parseBotAvatar, serializeBotAvatar, type BotAvatarConfig } from "@tabdo/shared";
import { SHAPES, COLORS } from "@/lib/bloub/skins";
import { EXPRESSIONS } from "@/lib/bloub/expressions";
import { Button } from "@tabdo/ui/components/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@tabdo/ui/components/tabs";
import { BotAvatar } from "./BotAvatar";
import { selectOptionStyle } from "@/lib/select-colors";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

const shapeLabels = i18n.t("agents:shapes", { returnObjects: true }) as string[];
const expressionLabels = i18n.t("agents:expressions", { returnObjects: true }) as string[];
const colorLabels = i18n.t("agents:colors", { returnObjects: true }) as string[];
export default function BotAvatarPicker({ image, onChange, disabled }: { image?: string | null; onChange: (image: string) => void; disabled: boolean }) {
  const { t } = useTranslation("agents");
  const config = parseBotAvatar(image) ?? defaultBotAvatar;
  const choose = (patch: Partial<BotAvatarConfig>) => onChange(serializeBotAvatar({ ...config, ...patch }));
  return <div className="@container/avatar-picker flex flex-col gap-4" data-testid="bot-avatar-picker">
    <div className="flex justify-center"><BotAvatar config={config} className="size-20" /></div>
    <Tabs defaultValue="shape"><TabsList className="w-full"><TabsTrigger value="shape" className="flex-1"><Shapes />{t("shape")}</TabsTrigger><TabsTrigger value="expression" className="flex-1"><Smile />{t("expression")}</TabsTrigger><TabsTrigger value="color" className="flex-1"><Palette />{t("color")}</TabsTrigger></TabsList>
      <TabsContent value="shape"><div className="grid grid-cols-3 gap-2 @xs/avatar-picker:grid-cols-4">{SHAPES.map((shape, index) => <Button key={shape.id} type="button" variant={config.shape === shape.id ? "secondary" : "outline"} className="h-auto flex-col gap-1 p-2" disabled={disabled} aria-pressed={config.shape === shape.id} onClick={() => choose({ shape: shape.id })}><BotAvatar config={{ ...config, shape: shape.id }} className="size-12" /><span>{shapeLabels[index]}</span></Button>)}</div></TabsContent>
      <TabsContent value="expression"><div className="grid grid-cols-3 gap-2 @xs/avatar-picker:grid-cols-4">{EXPRESSIONS.map((expression, index) => <Button key={expression.id} type="button" variant={config.expression === expression.id ? "secondary" : "outline"} className="h-auto flex-col gap-1 p-2" disabled={disabled} aria-pressed={config.expression === expression.id} onClick={() => choose({ expression: expression.id })}><BotAvatar config={{ ...config, expression: expression.id }} className="size-10" /><span>{expressionLabels[index]}</span></Button>)}</div></TabsContent>
      <TabsContent value="color"><div className="grid grid-cols-3 gap-2 @xs/avatar-picker:grid-cols-4">{[{ id: "auto" as const, hex: "currentColor" }, ...COLORS].map((color, index) => <Button key={color.id} type="button" variant={config.color === color.id ? "secondary" : "outline"} className="h-auto flex-col gap-1 p-2" disabled={disabled} aria-pressed={config.color === color.id} onClick={() => choose({ color: color.id })}><span className="flex size-7 items-center justify-center rounded-full" style={{ backgroundColor: color.hex }}>{config.color === color.id && <Check aria-hidden style={{ color: color.id === "auto" ? "var(--background)" : selectOptionStyle(color.hex).color }} />}</span><span>{index ? colorLabels[index - 1] : t("followTheme")}</span></Button>)}</div></TabsContent>
    </Tabs>
  </div>;
}
