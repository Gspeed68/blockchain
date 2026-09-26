import type { ItemStatus } from "../api/types";
import "./StatusBadge.css";

// Status color mapped by meaning (good/warning/serious/critical), never
// color alone — every badge carries its own text label.
const STATUS: Record<ItemStatus, { tone: string; label: string }> = {
  Registered: { tone: "neutral", label: "Registered" },
  InTransit: { tone: "warning", label: "In transit" },
  AtCustodian: { tone: "good", label: "At custodian" },
  Delivered: { tone: "good", label: "Delivered" },
  Damaged: { tone: "serious", label: "Damaged" },
  Lost: { tone: "critical", label: "Lost" },
};

export function StatusBadge({ status }: { status: ItemStatus }) {
  const info = STATUS[status];
  return (
    <span className={`status-badge status-badge--${info.tone}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      {info.label}
    </span>
  );
}
