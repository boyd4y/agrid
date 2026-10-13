import { lazy, Suspense, useId, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2, Smile, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { MemberAvatar } from "./MemberAvatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
const DiceBearAvatars = lazy(() => import("./DiceBearAvatars"));
const BotAvatarPicker = lazy(() => import("@/components/agents/BotAvatarPicker"));

async function prepareAvatar(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("请选择 PNG、JPEG 或 WebP 图片");
  if (file.size > 5 * 1024 * 1024) throw new Error("原图不能超过 5 MB");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法读取这张图片，请换一张重试");
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
    const data = canvas.toDataURL("image/webp", 0.85);
    if (data.length > 349_576) throw new Error("图片处理后仍过大，请换一张重试");
    return data;
  } finally { bitmap.close(); }
}

/** Selection stays in the parent draft; upload never silently saves a form. */
export function AvatarPicker({ name, image, kind = "human", onChange, disabled, onProcessingChange }: {
  name: string; image?: string | null; kind?: string; onChange: (image: string | null) => void;
  disabled?: boolean; onProcessingChange?: (processing: boolean) => void;
}) {
  const id = useId(), input = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false), [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const [open, setOpen] = useState(false);
  return <Field>
    <FieldLabel htmlFor={kind === "agent" ? undefined : id}>头像</FieldLabel>
    <div className="flex flex-wrap items-center gap-3">
      <MemberAvatar name={name} image={image} kind={kind} className="size-14" />
      <Popover open={open} onOpenChange={(next) => { if (!processing) setOpen(next); }}>
        <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" disabled={disabled || processing}>{kind === "agent" ? <Bot data-icon="inline-start" /> : <Smile data-icon="inline-start" />}{kind === "agent" ? "配置 bot 头像" : "选择头像"}</Button></PopoverTrigger>
        <PopoverContent className="w-96 max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto" align="start" aria-label={kind === "agent" ? "配置 bot 头像" : "选择成员头像"}>
          <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">加载头像…</p>}>
            {kind === "agent" ? <BotAvatarPicker image={image} onChange={onChange} disabled={Boolean(disabled)} /> : <DiceBearAvatars seed={name || "tabdo"} disabled={Boolean(disabled || processing)} onSelect={async (source) => {
              setError(null); setProcessing(true); onProcessingChange?.(true);
              try { const { rasterizeAvatar } = await import("./DiceBearAvatars"); onChange(await rasterizeAvatar(source)); setOpen(false); }
              catch (e) { setError(e instanceof Error ? e.message : "无法生成头像"); }
              finally { setProcessing(false); onProcessingChange?.(false); }
            }} />}
          </Suspense>
        </PopoverContent>
      </Popover>
      {kind !== "agent" && <><input id={id} ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={disabled || processing}
        onChange={async (event) => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file) return;
          const operation = ++version.current;
          setError(null); setProcessing(true); onProcessingChange?.(true);
          try { const data = await prepareAvatar(file); if (version.current === operation) onChange(data); }
          catch (e) { if (version.current === operation) setError(e instanceof Error ? e.message : "无法读取图片"); }
          finally { if (version.current === operation) { setProcessing(false); onProcessingChange?.(false); } }
        }} />
      <Button type="button" variant="outline" size="sm" disabled={disabled || processing} onClick={() => input.current?.click()}>
        {processing ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <ImagePlus data-icon="inline-start" />}{processing ? "处理图片…" : image ? "更换头像" : "上传头像"}
      </Button></>}
      {image && <Button type="button" variant="ghost" size="sm" disabled={disabled || processing} onClick={() => { setError(null); onChange(null); }}><Trash2 data-icon="inline-start" />{kind === "agent" ? "重置" : "移除"}</Button>}
    </div>
    <FieldDescription>{kind === "agent" ? "选择形状、表情和颜色，保存后生效。" : "离线生成头像，或上传 PNG、JPEG、WebP 图片（最大 5 MB）。"}</FieldDescription>
    {error && <FieldError role="alert">{error}</FieldError>}
  </Field>;
}
