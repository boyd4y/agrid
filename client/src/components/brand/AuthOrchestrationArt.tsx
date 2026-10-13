import { useId } from "react";

/** Brand diagram, rather than a simulation of a running agent or product UI. */
export function AuthOrchestrationArt() {
  const id = useId();
  const titleId = `${id}-title`;
  const glowId = `${id}-glow`;

  return (
    <svg
      viewBox="0 0 640 370"
      role="img"
      aria-labelledby={titleId}
      className="w-full overflow-visible"
      data-auth-orchestration
    >
      <title id={titleId}>
        将零散的想法，通过 tabdo AI 组织成资料与信息、计划与步骤、进展与结果。
      </title>
      <defs>
        <radialGradient id={glowId}>
          <stop offset="0" stopColor="var(--primary)" stopOpacity=".12" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="320" cy="192" rx="180" ry="135" fill={`url(#${glowId})`} />

      <g fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeOpacity=".38">
        <path d="M320 79V133" />
        <path d="M320 208V244" />
        <path d="M320 244H132Q112 244 112 264V274" />
        <path d="M320 244V274" />
        <path d="M320 244H508Q528 244 528 264V274" />
      </g>
      <g fill="var(--primary)">
        <circle cx="320" cy="110" r="3" />
        <circle cx="112" cy="274" r="3" />
        <circle cx="320" cy="274" r="3" />
        <circle cx="528" cy="274" r="3" />
      </g>

      <rect x="144" y="13" width="352" height="66" rx="14" fill="var(--background)" stroke="var(--border)" />
      <text x="167" y="37" fill="var(--muted-foreground)" fontSize="11">一个想法</text>
      <text x="167" y="60" fill="var(--foreground)" fontSize="16" fontWeight="500">把零散的想法，整理成计划</text>
      <g transform="translate(459 40)" fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m0-8 2.5 5.5L8 0 2.5 2.5 0 8l-2.5-5.5L-8 0l5.5-2.5Z" />
      </g>

      <rect x="283" y="133" width="74" height="74" rx="21" fill="var(--background)" stroke="var(--primary)" strokeOpacity=".5" />
      <image href="/brand/tabdo-mark-ink.svg" x="299" y="148" width="42" height="44" className="dark:hidden" />
      <image href="/brand/tabdo-mark-white.svg" x="299" y="148" width="42" height="44" className="hidden dark:block" />
      <rect x="283" y="220" width="74" height="20" rx="10" fill="var(--muted)" />
      <text x="320" y="234" textAnchor="middle" fill="var(--muted-foreground)" fontSize="11">AI 动手</text>

      <g fill="var(--background)" stroke="var(--border)">
        <rect x="24" y="280" width="176" height="66" rx="12" />
        <rect x="232" y="280" width="176" height="66" rx="12" />
        <rect x="440" y="280" width="176" height="66" rx="12" />
      </g>
      <g fill="none" stroke="var(--primary)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="43" y="300" width="22" height="17" rx="3" />
        <path d="M43 306h22M51 306v11" />
        <rect x="251" y="299" width="7" height="7" rx="1.5" />
        <rect x="266" y="309" width="7" height="7" rx="1.5" />
        <path d="M258 302h12v7M254 306v7h12" />
        <path d="M459 319v-19M459 319h24M465 314v-6M473 314v-13M481 314v-9" />
      </g>
      <g fill="var(--foreground)" fontSize="14" fontWeight="500">
        <text x="76" y="310">资料与信息</text>
        <text x="284" y="310">计划与步骤</text>
        <text x="492" y="310">进展与结果</text>
      </g>
      <g fill="var(--muted-foreground)" fontSize="10">
        <text x="76" y="330">收集 · 整理 · 关联</text>
        <text x="284" y="330">拆解 · 安排 · 推进</text>
        <text x="492" y="330">查看 · 记录 · 调整</text>
      </g>
    </svg>
  );
}
