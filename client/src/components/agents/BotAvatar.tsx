import { useId, useMemo } from "react";
import { defaultBotAvatar, type BotAvatarConfig } from "@tabdo/shared";
import { BotEngine } from "@/lib/bloub/engine";
import { EXPRESSION_BY_ID } from "@/lib/bloub/expressions";
import { COLOR_BY_ID, SHAPE_BY_ID } from "@/lib/bloub/skins";
import { RAYON } from "@/lib/bloub/repere";
import { selectOptionStyle } from "@/lib/select-colors";

/** React renderer for bloub's upstream engine; static avatars do not run animation clocks. */
export function BotAvatar({ config = defaultBotAvatar, label = "智能体头像", className }: { config?: BotAvatarConfig; label?: string; className?: string }) {
  const mask = `bloub-${useId().replace(/:/g, "")}`;
  const frame = useMemo(() => new BotEngine(RAYON, "idle", SHAPE_BY_ID.get(config.shape)?.radii, EXPRESSION_BY_ID.get(config.expression)).sample(0), [config.shape, config.expression]);
  const ink = config.color === "auto" ? "currentColor" : COLOR_BY_ID.get(config.color)?.hex ?? "currentColor";
  // Extreme fixed palette colors need a contrasting paper in either theme;
  // otherwise both the silhouette and the transparent eye cutouts disappear.
  const paper = ["creme", "encre"].includes(config.color) ? selectOptionStyle(ink).color : null;
  return <svg viewBox="-128 -128 256 256" role="img" aria-label={label} className={className} data-bot-avatar={config.shape}>
    <defs><mask id={mask} maskUnits="userSpaceOnUse" x="-128" y="-128" width="256" height="256">
      <path d={frame.bodyPath} fill="#fff" />
      {frame.eyes.map((eye, index) => <path key={index} d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill="#000" />)}
    </mask></defs>
    {paper && <circle r="128" fill={paper} data-bot-paper />}
    <path d={frame.bodyPath} fill={ink} mask={`url(#${mask})`} opacity={frame.bodyAlpha} />
  </svg>;
}
