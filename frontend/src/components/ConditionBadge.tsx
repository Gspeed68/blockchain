import type { Condition } from "../api/types";
import "./ConditionBadge.css";

// Status color mapped by meaning (good/warning/serious/critical), never
// color alone — every badge carries its own text label, per the project's
// dataviz accessibility rule ("status colors ship with an icon + label").
const STATUS: Record<Condition, { tone: string; label: string }> = {
  Sealed: { tone: "good", label: "Sealed" },
  OpenPourable: { tone: "neutral", label: "Open · pourable" },
  LowFill: { tone: "warning", label: "Low fill" },
  Empty: { tone: "neutral", label: "Empty" },
  Damaged: { tone: "critical", label: "Damaged" },
};

export function ConditionBadge({ condition, fillLevelPercent }: { condition: Condition; fillLevelPercent?: number }) {
  const info = STATUS[condition];
  return (
    <span className={`condition-badge condition-badge--${info.tone}`}>
      <span className="condition-badge__dot" aria-hidden="true" />
      {info.label}
      {typeof fillLevelPercent === "number" && condition !== "Sealed" && condition !== "Empty" && (
        <span className="condition-badge__fill"> · {Math.round(fillLevelPercent)}%</span>
      )}
    </span>
  );
}
