import { Shapes, Smile, Palette, Check } from "lucide-react";
import { defaultBotAvatar, parseBotAvatar, serializeBotAvatar, type BotAvatarConfig } from "@tabdo/shared";
import { SHAPES, COLORS } from "@/lib/bloub/skins";
import { EXPRESSIONS } from "@/lib/bloub/expressions";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BotAvatar } from "./BotAvatar";
import { selectOptionStyle } from "@/lib/select-colors";

const shapeLabels = ["圆形", "卵石", "圆角方形", "胶囊", "三角形", "六边形", "云朵", "水滴"];
const expressionLabels = ["自然", "专注", "惊讶", "兴奋", "开心", "大笑", "生气", "难过", "害怕", "怀疑", "困惑", "好奇", "自信", "害羞", "淡定", "困倦"];
const colorLabels = ["墨色", "棕色", "红色", "橙色", "琥珀", "绿色", "青色", "蓝色", "紫色", "粉色", "灰色", "奶油色"];
export default function BotAvatarPicker({ image, onChange, disabled }: { image?: string | null; onChange: (image: string) => void; disabled: boolean }) {
  const config = parseBotAvatar(image) ?? defaultBotAvatar;
  const choose = (patch: Partial<BotAvatarConfig>) => onChange(serializeBotAvatar({ ...config, ...patch }));
  return <div className="@container/avatar-picker flex flex-col gap-4" data-testid="bot-avatar-picker">
    <div className="flex justify-center"><BotAvatar config={config} className="size-20" /></div>
    <Tabs defaultValue="shape"><TabsList className="w-full"><TabsTrigger value="shape" className="flex-1"><Shapes />形状</TabsTrigger><TabsTrigger value="expression" className="flex-1"><Smile />表情</TabsTrigger><TabsTrigger value="color" className="flex-1"><Palette />颜色</TabsTrigger></TabsList>
      <TabsContent value="shape"><div className="grid grid-cols-3 gap-2 @xs/avatar-picker:grid-cols-4">{SHAPES.map((shape, index) => <Button key={shape.id} type="button" variant={config.shape === shape.id ? "secondary" : "outline"} className="h-auto flex-col gap-1 p-2" disabled={disabled} aria-pressed={config.shape === shape.id} onClick={() => choose({ shape: shape.id })}><BotAvatar config={{ ...config, shape: shape.id }} className="size-12" /><span>{shapeLabels[index]}</span></Button>)}</div></TabsContent>
      <TabsContent value="expression"><div className="grid grid-cols-3 gap-2 @xs/avatar-picker:grid-cols-4">{EXPRESSIONS.map((expression, index) => <Button key={expression.id} type="button" variant={config.expression === expression.id ? "secondary" : "outline"} className="h-auto flex-col gap-1 p-2" disabled={disabled} aria-pressed={config.expression === expression.id} onClick={() => choose({ expression: expression.id })}><BotAvatar config={{ ...config, expression: expression.id }} className="size-10" /><span>{expressionLabels[index]}</span></Button>)}</div></TabsContent>
      <TabsContent value="color"><div className="grid grid-cols-3 gap-2 @xs/avatar-picker:grid-cols-4">{[{ id: "auto" as const, hex: "currentColor" }, ...COLORS].map((color, index) => <Button key={color.id} type="button" variant={config.color === color.id ? "secondary" : "outline"} className="h-auto flex-col gap-1 p-2" disabled={disabled} aria-pressed={config.color === color.id} onClick={() => choose({ color: color.id })}><span className="flex size-7 items-center justify-center rounded-full" style={{ backgroundColor: color.hex }}>{config.color === color.id && <Check aria-hidden style={{ color: color.id === "auto" ? "var(--background)" : selectOptionStyle(color.hex).color }} />}</span><span>{index ? colorLabels[index - 1] : "跟随主题"}</span></Button>)}</div></TabsContent>
    </Tabs>
  </div>;
}
