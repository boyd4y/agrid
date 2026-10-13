/** Shared soft shadow filters for Notion-style SVGs */
export function SoftShadowDefs({ prefix = "ns" }: { prefix?: string }) {
  return (
    <defs>
      <filter id={`${prefix}-soft`} x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="8" stdDeviation="12" floodColor="#37352F" floodOpacity="0.08" />
      </filter>
      <filter id={`${prefix}-soft2`} x="-25%" y="-25%" width="150%" height="150%">
        <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#37352F" floodOpacity="0.07" />
      </filter>
      <filter id={`${prefix}-float`} x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="10" stdDeviation="14" floodColor="#37352F" floodOpacity="0.1" />
      </filter>
    </defs>
  );
}
