export const botAvatarShapes = ["cercle", "galet", "squircle", "capsule", "triangle", "hexagone", "nuage", "goutte"] as const;
export const botAvatarColors = ["auto", "encre", "creme", "brun", "rouge", "orange", "ambre", "vert", "turquoise", "bleu", "violet", "rose", "gris"] as const;
export const botAvatarExpressions = ["neutre", "attentif", "surpris", "excite", "heureux", "hilare", "colere", "triste", "effraye", "mefiant", "confus", "curieux", "fier", "timide", "blase", "somnolent"] as const;
export type BotAvatarConfig = { shape: typeof botAvatarShapes[number]; color: typeof botAvatarColors[number]; expression: typeof botAvatarExpressions[number] };
export const defaultBotAvatar: BotAvatarConfig = { shape: "cercle", color: "auto", expression: "neutre" };
export function parseBotAvatar(value?: string | null): BotAvatarConfig | undefined {
  if (!value) return undefined;
  const [prefix, shape, color, expression, extra] = value.split(":");
  if (prefix !== "bloub" || extra !== undefined || !botAvatarShapes.some((v) => v === shape) || !botAvatarColors.some((v) => v === color) || !botAvatarExpressions.some((v) => v === expression)) return undefined;
  return { shape, color, expression } as BotAvatarConfig;
}
export function serializeBotAvatar(config: BotAvatarConfig) { return `bloub:${config.shape}:${config.color}:${config.expression}`; }
